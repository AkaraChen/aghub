use crate::claude::types::PluginManifest;
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tempfile::{Builder, TempDir};
use tokio::process::Command;

const GITHUB_BRANCHES: [&str; 2] = ["main", "master"];
// External git commands should fail fast instead of hanging plugin flows.
const GIT_COMMAND_TIMEOUT: Duration = Duration::from_secs(60);

pub(crate) fn find_plugin_manifest_path(plugin_dir: &Path) -> Option<PathBuf> {
	let possible_paths = [
		plugin_dir.join(".claude-plugin/plugin.json"),
		plugin_dir.join(".plugin/plugin.json"),
		plugin_dir.join("plugin.json"),
	];

	for path in &possible_paths {
		if path.exists() {
			return Some(path.clone());
		}
	}

	None
}

pub(crate) fn resolve_plugin_dir(
	workspace_dir: &Path,
	candidates: &[PathBuf],
) -> Option<PathBuf> {
	for candidate in candidates {
		let plugin_dir = if candidate.as_os_str().is_empty() {
			workspace_dir.to_path_buf()
		} else {
			workspace_dir.join(candidate)
		};

		if find_plugin_manifest_path(&plugin_dir).is_some() {
			return Some(plugin_dir);
		}
	}

	None
}

pub(crate) fn resolve_plugin_dir_with_wrappers(
	workspace_dir: &Path,
	candidates: &[PathBuf],
) -> Option<PathBuf> {
	if let Some(path) = resolve_plugin_dir(workspace_dir, candidates) {
		return Some(path);
	}

	let entries = std::fs::read_dir(workspace_dir).ok()?;
	for entry in entries.flatten() {
		let path = entry.path();
		if !path.is_dir() {
			continue;
		}

		if let Some(candidate) = resolve_plugin_dir(&path, candidates) {
			return Some(candidate);
		}
	}

	None
}

pub(crate) fn local_plugin_candidates(name: &str) -> Vec<PathBuf> {
	vec![PathBuf::from(name), PathBuf::new()]
}

pub(crate) fn remote_plugin_candidates(name: &str) -> Vec<PathBuf> {
	vec![PathBuf::new(), PathBuf::from(name)]
}

pub(crate) fn temp_dir(prefix: &str) -> Result<TempDir> {
	Builder::new()
		.prefix(prefix)
		.tempdir()
		.context("Failed to create temporary directory")
}

pub(crate) async fn git_output(
	args: &[&str],
	current_dir: Option<&Path>,
	context: &str,
) -> Result<std::process::Output> {
	let context = context.to_string();
	let mut command = Command::new("git");
	command.args(args);
	if let Some(path) = current_dir {
		command.current_dir(path);
	}

	tokio::time::timeout(GIT_COMMAND_TIMEOUT, command.output())
		.await
		.with_context(|| format!("{context} timed out"))?
		.context(context)
}

pub(crate) async fn git_ok(
	args: &[&str],
	current_dir: Option<&Path>,
	context: &str,
	failure: &str,
) -> Result<std::process::Output> {
	let output = git_output(args, current_dir, context).await?;
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr);
		anyhow::bail!("{failure}: {}", stderr);
	}

	Ok(output)
}

pub(crate) async fn git_clone(
	source: &str,
	target: &Path,
	context: &str,
) -> Result<()> {
	let context = context.to_string();
	let output = tokio::time::timeout(
		GIT_COMMAND_TIMEOUT,
		Command::new("git")
			.args(["clone", "--depth", "1", source])
			.arg(target)
			.output(),
	)
	.await
	.with_context(|| format!("{context} timed out"))?
	.context(context)?;
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr);
		anyhow::bail!("Git clone failed: {}", stderr);
	}

	Ok(())
}

pub(crate) fn is_git_repository(path: &Path) -> bool {
	path.join(".git").exists()
}

pub(crate) fn repository_archive_urls(
	url: &str,
	revision: Option<&str>,
) -> Vec<String> {
	let normalized_url = normalize_repository_url(url);

	if let Some(revision) = revision.filter(|value| !value.is_empty()) {
		if normalized_url.contains("github.com") {
			let clean_url = normalized_url
				.trim_end_matches('/')
				.trim_end_matches(".git");
			return vec![format!("{clean_url}/tarball/{revision}")];
		}

		return vec![normalized_url];
	}

	if normalized_url.contains("github.com") {
		let clean_url = normalized_url
			.trim_end_matches('/')
			.trim_end_matches(".git");
		return vec![
			format!("{clean_url}/tarball/refs/heads/main"),
			format!("{clean_url}/tarball/refs/heads/master"),
		];
	}

	vec![normalized_url]
}

pub(crate) fn normalize_repository_url(url: &str) -> String {
	let trimmed = url.trim_end_matches('/').trim_end_matches(".git");

	if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
		return trimmed.to_string();
	}

	if let Some(path) = trimmed.strip_prefix("git@github.com:") {
		return format!("https://github.com/{path}");
	}

	if trimmed.contains('/') && !trimmed.contains("://") {
		return format!("https://github.com/{trimmed}");
	}

	trimmed.to_string()
}

async fn fetch_manifest_from_url(
	client: &reqwest::Client,
	url: &str,
) -> Option<PluginManifest> {
	let response = client.get(url).send().await.ok()?;
	if !response.status().is_success() {
		return None;
	}
	response.json::<PluginManifest>().await.ok()
}

pub(crate) async fn fetch_github_raw_manifest(
	client: &reqwest::Client,
	owner: &str,
	repo: &str,
	paths: &[String],
) -> Option<PluginManifest> {
	for branch in GITHUB_BRANCHES {
		for path in paths {
			let raw_url = format!(
				"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"
			);
			if let Some(manifest) =
				fetch_manifest_from_url(client, &raw_url).await
			{
				return Some(manifest);
			}
		}
	}

	None
}

pub(crate) async fn fetch_github_commit(
	client: &reqwest::Client,
	owner: &str,
	repo: &str,
) -> Result<Option<(String, Option<String>)>> {
	for branch in GITHUB_BRANCHES {
		let url = format!(
			"https://api.github.com/repos/{owner}/{repo}/commits/{branch}"
		);
		let response = client.get(&url).send().await?;
		if !response.status().is_success() {
			continue;
		}

		let json: serde_json::Value = response.json().await?;
		if let Some(sha) = json.get("sha").and_then(|value| value.as_str()) {
			return Ok(Some((
				sha[..8.min(sha.len())].to_string(),
				Some(sha.to_string()),
			)));
		}
	}

	Ok(None)
}

pub(crate) async fn read_plugin_manifest(dir: &Path) -> Result<PluginManifest> {
	let path = find_plugin_manifest_path(dir)
		.ok_or_else(|| anyhow::anyhow!("plugin.json not found in {:?}", dir))?;
	let content = tokio::fs::read_to_string(path).await?;
	serde_json::from_str(&content).map_err(|error| {
		anyhow::anyhow!("Failed to parse plugin.json: {error}")
	})
}

pub(crate) fn manifest_candidate_paths(candidates: &[PathBuf]) -> Vec<String> {
	let mut paths = Vec::new();

	for candidate in candidates {
		let prefix = candidate.to_string_lossy();
		if prefix.is_empty() {
			paths.push(".claude-plugin/plugin.json".to_string());
			paths.push(".plugin/plugin.json".to_string());
			paths.push("plugin.json".to_string());
			continue;
		}

		paths.push(format!("{prefix}/.claude-plugin/plugin.json"));
		paths.push(format!("{prefix}/.plugin/plugin.json"));
		paths.push(format!("{prefix}/plugin.json"));
	}

	paths
}

pub(crate) fn first_manifest_dir(root: &Path) -> Option<PathBuf> {
	std::fs::read_dir(root)
		.ok()?
		.filter_map(|entry| entry.ok().map(|value| value.path()))
		.find(|path| path.is_dir() && find_plugin_manifest_path(path).is_some())
}

pub(crate) async fn extract_repository_archive(
	git_installer: &crate::installer::git::GitBasedInstaller,
	url: &str,
	target_dir: &Path,
) -> Result<String> {
	let mut last_error = None;

	for tarball_url in repository_archive_urls(url, None) {
		match git_installer
			.download_and_extract(&tarball_url, "", target_dir)
			.await
		{
			Ok(commit) => return Ok(commit),
			Err(error) => last_error = Some((tarball_url, error)),
		}
	}

	if let Some((tarball_url, error)) = last_error {
		anyhow::bail!(
			"Failed to download repository archive from {}: {}",
			tarball_url,
			error
		);
	}

	anyhow::bail!("No repository archive URL available for {}", url);
}

pub(crate) async fn copy_dir_all(src: &Path, dst: &Path) -> Result<()> {
	tokio::fs::create_dir_all(dst).await?;

	let mut entries = tokio::fs::read_dir(src).await?;

	while let Some(entry) = entries.next_entry().await? {
		let src_path = entry.path();
		let dst_path = dst.join(entry.file_name());

		if src_path.is_dir()
			&& src_path.file_name() == Some(std::ffi::OsStr::new(".git"))
		{
			continue;
		}

		if src_path.is_dir() {
			Box::pin(copy_dir_all(&src_path, &dst_path)).await?;
		} else {
			tokio::fs::copy(&src_path, &dst_path).await?;
		}
	}

	Ok(())
}
