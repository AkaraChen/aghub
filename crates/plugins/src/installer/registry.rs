use super::git::GitBasedInstaller;
use crate::claude::types::PluginManifest;
use anyhow::{Context, Result};
use async_trait::async_trait;
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

async fn fetch_github_commit(
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
	git_installer: &GitBasedInstaller,
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

pub use super::marketplace::MarketplaceRegistry;

#[async_trait]
pub trait PluginRegistry: Send + Sync {
	async fn fetch_manifest(&self, name: &str) -> Result<PluginManifest>;

	async fn install(
		&self,
		name: &str,
		target_dir: &Path,
	) -> Result<Option<String>>;

	async fn get_latest_version(
		&self,
		name: &str,
	) -> Result<Option<(String, Option<String>)>>;
}

pub struct GitHubRegistry {
	client: reqwest::Client,
	owner: String,
	repo: String,
	subdir: Option<String>,
	git_installer: GitBasedInstaller,
}

impl GitHubRegistry {
	pub fn new(
		client: reqwest::Client,
		owner: &str,
		repo: &str,
		subdir: Option<String>,
	) -> Result<Self> {
		Ok(Self {
			client,
			owner: owner.to_string(),
			repo: repo.to_string(),
			subdir,
			git_installer: GitBasedInstaller::new()?,
		})
	}

	fn plugin_candidates(&self, name: &str) -> Vec<PathBuf> {
		match &self.subdir {
			Some(sub) => vec![PathBuf::from(format!("{}{}", sub, name))],
			None => remote_plugin_candidates(name),
		}
	}
}

#[async_trait]
impl PluginRegistry for GitHubRegistry {
	async fn fetch_manifest(&self, name: &str) -> Result<PluginManifest> {
		if let Some(manifest) = fetch_github_raw_manifest(
			&self.client,
			&self.owner,
			&self.repo,
			&manifest_candidate_paths(&self.plugin_candidates(name)),
		)
		.await
		{
			return Ok(manifest);
		}

		anyhow::bail!(
			"Plugin manifest not found: {} (tried main and master branches with multiple paths)",
			name
		)
	}

	async fn install(
		&self,
		name: &str,
		target_dir: &Path,
	) -> Result<Option<String>> {
		let url = format!("https://github.com/{}/{}", self.owner, self.repo);
		let temp_dir =
			temp_dir(&format!("aghub-plugin-install-{}-", self.repo))?;

		let commit = extract_repository_archive(
			&self.git_installer,
			&url,
			temp_dir.path(),
		)
		.await?;

		let source_dir = match resolve_plugin_dir_with_wrappers(
			temp_dir.path(),
			&self.plugin_candidates(name),
		) {
			Some(path) => path,
			None => anyhow::bail!(
				"Plugin directory not found in repository for '{}'",
				name
			),
		};

		copy_dir_all(&source_dir, target_dir).await?;
		Ok(Some(commit))
	}

	async fn get_latest_version(
		&self,
		_name: &str,
	) -> Result<Option<(String, Option<String>)>> {
		fetch_github_commit(&self.client, &self.owner, &self.repo).await
	}
}

pub struct LocalRegistry {
	base_path: std::path::PathBuf,
}

impl LocalRegistry {
	pub fn new(base_path: std::path::PathBuf) -> Self {
		Self { base_path }
	}
}

#[async_trait]
impl PluginRegistry for LocalRegistry {
	async fn fetch_manifest(&self, name: &str) -> Result<PluginManifest> {
		let plugin_dir =
			resolve_plugin_dir(&self.base_path, &local_plugin_candidates(name))
				.ok_or_else(|| {
					anyhow::anyhow!(
						"plugin.json not found in local plugin: {}",
						name
					)
				})?;
		read_plugin_manifest(&plugin_dir).await
	}

	async fn install(
		&self,
		name: &str,
		target_dir: &Path,
	) -> Result<Option<String>> {
		let source_dir =
			resolve_plugin_dir(&self.base_path, &local_plugin_candidates(name))
				.ok_or_else(|| {
					anyhow::anyhow!(
						"Local plugin directory not found for '{}'",
						name
					)
				})?;

		copy_dir_all(&source_dir, target_dir).await?;
		Ok(None)
	}

	async fn get_latest_version(
		&self,
		_name: &str,
	) -> Result<Option<(String, Option<String>)>> {
		Ok(Some(("local".to_string(), None)))
	}
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

	#[tokio::test]
	async fn test_local_registry_supports_plugin_root_base_path() {
		let temp_dir = temp_dir("aghub-local-registry-").unwrap();
		let plugin_dir = temp_dir.path().join("demo-plugin");
		let install_dir = temp_dir.path().join("installed");
		let manifest_dir = plugin_dir.join(".claude-plugin");

		std::fs::create_dir_all(&manifest_dir).unwrap();
		std::fs::write(
			manifest_dir.join("plugin.json"),
			r#"{"name":"demo-plugin","description":"test","author":{"name":"A"}}"#,
		)
		.unwrap();

		let registry = LocalRegistry::new(plugin_dir.clone());
		let manifest = registry.fetch_manifest("demo-plugin").await.unwrap();
		assert_eq!(manifest.name, "demo-plugin");

		registry.install("demo-plugin", &install_dir).await.unwrap();
		assert!(install_dir.join(".claude-plugin/plugin.json").exists());
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
