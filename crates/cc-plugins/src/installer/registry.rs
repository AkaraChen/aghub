use crate::claude::types::PluginManifest;
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tempfile::{Builder, TempDir};
use tokio::process::Command;

pub use super::marketplace::MarketplaceRegistry;

const GITHUB_BRANCHES: [&str; 2] = ["main", "master"];
// External git commands should fail fast instead of hanging plugin flows.
const GIT_COMMAND_TIMEOUT: Duration = Duration::from_secs(60);

// ── Path helpers ──

pub(crate) fn find_plugin_manifest_path(plugin_dir: &Path) -> Option<PathBuf> {
	crate::MANIFEST_CANDIDATE_PATHS
		.iter()
		.map(|name| plugin_dir.join(name))
		.find(|path| path.exists())
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

pub(crate) fn remote_plugin_candidates(name: &str) -> Vec<PathBuf> {
	vec![PathBuf::new(), PathBuf::from(name)]
}

pub(crate) fn temp_dir(prefix: &str) -> Result<TempDir> {
	Builder::new()
		.prefix(prefix)
		.tempdir()
		.context("Failed to create temporary directory")
}

// ── Git helpers ──

pub(crate) async fn git_output(
	args: &[&str],
	current_dir: Option<&Path>,
	context: &str,
) -> Result<std::process::Output> {
	let context = context.to_string();
	let mut command = Command::new("git");
	command.args(args);
	#[cfg(windows)]
	command.creation_flags(crate::CREATE_NO_WINDOW);
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
	let mut command = Command::new("git");
	command.args(["clone", "--depth", "1", source]).arg(target);
	#[cfg(windows)]
	command.creation_flags(crate::CREATE_NO_WINDOW);
	let output = tokio::time::timeout(GIT_COMMAND_TIMEOUT, command.output())
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

// ── Repository archive ──

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
	if let Ok(resolved) = aghub_git::resolve_remote_source(url) {
		return resolved
			.source_url
			.trim_end_matches('/')
			.trim_end_matches(".git")
			.to_string();
	}
	url.trim_end_matches('/')
		.trim_end_matches(".git")
		.to_string()
}

// ── Manifest fetching ──

async fn fetch_manifest_from_url(
	client: &reqwest::Client,
	url: &str,
) -> Option<PluginManifest> {
	let response = match client.get(url).send().await {
		Ok(r) => r,
		Err(e) => {
			log::debug!("Failed to fetch manifest from {url}: {e}");
			return None;
		}
	};
	if !response.status().is_success() {
		log::debug!("Manifest fetch returned {} for {url}", response.status());
		return None;
	}
	match response.json::<PluginManifest>().await {
		Ok(m) => Some(m),
		Err(e) => {
			log::debug!("Failed to parse manifest from {url}: {e}");
			None
		}
	}
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
		for name in crate::MANIFEST_CANDIDATE_PATHS {
			if prefix.is_empty() {
				paths.push((*name).to_string());
			} else {
				paths.push(format!("{prefix}/{name}"));
			}
		}
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
	revision: Option<&str>,
) -> Result<String> {
	let mut last_error = None;

	for tarball_url in repository_archive_urls(url, revision) {
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

#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::json;
	use std::path::{Path, PathBuf};

	fn write_manifest(path: &Path, value: serde_json::Value) {
		std::fs::create_dir_all(path.parent().unwrap()).unwrap();
		std::fs::write(path, serde_json::to_string_pretty(&value).unwrap())
			.unwrap();
	}

	fn demo_manifest(name: &str) -> serde_json::Value {
		json!({
			"name": name,
			"description": "test",
			"author": { "name": "A" },
		})
	}

	#[test]
	fn test_resolve_plugin_dir_variants() {
		let cases = [
			(
				"root",
				PathBuf::new(),
				vec![PathBuf::from("demo-plugin"), PathBuf::new()],
				false,
			),
			(
				"subdir",
				PathBuf::from("demo-plugin"),
				vec![PathBuf::from("demo-plugin"), PathBuf::new()],
				false,
			),
			(
				"wrapper",
				PathBuf::from("repo-wrapper/plugins/demo-plugin"),
				vec![PathBuf::from("plugins/demo-plugin")],
				true,
			),
		];

		for (name, manifest_dir, candidates, use_wrappers) in cases {
			let temp_dir =
				temp_dir(&format!("aghub-remote-registry-{name}-")).unwrap();
			let plugin_dir = temp_dir.path().join(manifest_dir);
			write_manifest(
				&plugin_dir.join(".claude-plugin/plugin.json"),
				demo_manifest("demo-plugin"),
			);

			let resolved = if use_wrappers {
				resolve_plugin_dir_with_wrappers(temp_dir.path(), &candidates)
			} else {
				resolve_plugin_dir(temp_dir.path(), &candidates)
			}
			.unwrap();
			assert_eq!(resolved, plugin_dir);
		}
	}

	#[test]
	fn test_normalize_repository_url_supports_repo_shorthand() {
		assert_eq!(
			normalize_repository_url("railwayapp/railway-skills"),
			"https://github.com/railwayapp/railway-skills"
		);
	}
}
