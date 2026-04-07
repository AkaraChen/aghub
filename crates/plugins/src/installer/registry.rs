//! Plugin registry abstraction for different plugin sources

use super::git::GitBasedInstaller;
use crate::claude::types::PluginManifest;
use crate::discovery::{
	MarketplaceConfig, MarketplacePlugin, MarketplaceSource,
};
use anyhow::{Context, Result};
use async_trait::async_trait;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const OFFICIAL_MARKETPLACE_REPO: &str =
	"https://github.com/anthropics/claude-plugins-official.git";

fn find_plugin_manifest_path(plugin_dir: &Path) -> Option<PathBuf> {
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

fn resolve_plugin_dir(
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

fn local_plugin_candidates(name: &str) -> Vec<PathBuf> {
	vec![PathBuf::from(name), PathBuf::new()]
}

fn remote_plugin_candidates(name: &str) -> Vec<PathBuf> {
	vec![PathBuf::new(), PathBuf::from(name)]
}

fn unique_suffix() -> String {
	let nanos = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.unwrap_or_default()
		.as_nanos();
	format!("{}-{nanos}", std::process::id())
}

fn is_git_repository(path: &Path) -> bool {
	path.join(".git").exists()
}

fn repository_tarball_urls(url: &str) -> Vec<String> {
	if url.contains("github.com") {
		let clean_url = url.trim_end_matches('/').trim_end_matches(".git");
		return vec![
			format!("{clean_url}/tarball/refs/heads/main"),
			format!("{clean_url}/tarball/refs/heads/master"),
		];
	}

	vec![url.to_string()]
}

async fn extract_repository_archive(
	git_installer: &GitBasedInstaller,
	url: &str,
	target_dir: &Path,
) -> Result<String> {
	let mut last_error = None;

	for tarball_url in repository_tarball_urls(url) {
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

/// Registry for fetching plugins
#[async_trait]
pub trait PluginRegistry: Send + Sync {
	/// Fetch plugin manifest
	async fn fetch_manifest(&self, name: &str) -> Result<PluginManifest>;

	/// Install plugin to target directory
	/// Returns the actual commit SHA of what was installed
	async fn install(
		&self,
		name: &str,
		target_dir: &Path,
	) -> Result<Option<String>>;

	/// Get latest version info (version string, optional commit SHA)
	async fn get_latest_version(
		&self,
		name: &str,
	) -> Result<Option<(String, Option<String>)>>;
}

/// GitHub-based registry (for claude-plugins-official and third-party)
pub struct GitHubRegistry {
	client: reqwest::Client,
	owner: String,
	repo: String,
	/// Optional subdirectory within the repo (e.g., "plugins/" for official)
	subdir: Option<String>,
	/// Git-based installer for downloads
	git_installer: GitBasedInstaller,
}

impl GitHubRegistry {
	pub fn new(
		client: reqwest::Client,
		owner: &str,
		repo: &str,
		subdir: Option<String>,
	) -> Self {
		Self {
			client,
			owner: owner.to_string(),
			repo: repo.to_string(),
			subdir,
			git_installer: GitBasedInstaller::new(),
		}
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
		let mut paths_to_try = Vec::new();

		if let Some(sub) = &self.subdir {
			paths_to_try.push(format!("{}{}/plugin.json", sub, name));
		} else {
			// Standalone repo: try common paths and the name subdir
			paths_to_try.push(".claude-plugin/plugin.json".to_string());
			paths_to_try.push(".plugin/plugin.json".to_string());
			paths_to_try.push("plugin.json".to_string());
			paths_to_try.push(format!("{}/.claude-plugin/plugin.json", name));
			paths_to_try.push(format!("{}/.plugin/plugin.json", name));
			paths_to_try.push(format!("{}/plugin.json", name));
		}

		for path in &paths_to_try {
			// Try main branch first
			let url = format!(
				"https://raw.githubusercontent.com/{}/{}/main/{}",
				self.owner, self.repo, path
			);

			if let Ok(response) = self.client.get(&url).send().await {
				if response.status().is_success() {
					if let Ok(manifest) = response.json().await {
						return Ok(manifest);
					}
				}
			}

			// Try master branch
			let url = format!(
				"https://raw.githubusercontent.com/{}/{}/master/{}",
				self.owner, self.repo, path
			);

			if let Ok(response) = self.client.get(&url).send().await {
				if response.status().is_success() {
					if let Ok(manifest) = response.json().await {
						return Ok(manifest);
					}
				}
			}
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
		let temp_dir = std::env::temp_dir().join(format!(
			"aghub-plugin-install-{}-{}",
			self.repo,
			std::process::id()
		));

		if temp_dir.exists() {
			tokio::fs::remove_dir_all(&temp_dir).await.ok();
		}

		let commit = match extract_repository_archive(
			&self.git_installer,
			&url,
			&temp_dir,
		)
		.await
		{
			Ok(commit) => commit,
			Err(error) => {
				tokio::fs::remove_dir_all(&temp_dir).await.ok();
				return Err(error);
			}
		};

		let source_dir = match resolve_plugin_dir(
			&temp_dir,
			&self.plugin_candidates(name),
		) {
			Some(path) => path,
			None => {
				tokio::fs::remove_dir_all(&temp_dir).await.ok();
				anyhow::bail!(
					"Plugin directory not found in repository for '{}'",
					name
				);
			}
		};

		let copy_result = copy_dir_all(&source_dir, target_dir).await;
		tokio::fs::remove_dir_all(&temp_dir).await.ok();
		copy_result.map(|_| Some(commit))
	}

	async fn get_latest_version(
		&self,
		_name: &str,
	) -> Result<Option<(String, Option<String>)>> {
		// For GitHub-based plugins, we fetch the latest commit SHA
		// This could be optimized by caching
		let url = format!(
			"https://api.github.com/repos/{}/{}/commits/main",
			self.owner, self.repo
		);

		let response = self.client.get(&url).send().await;

		if let Ok(resp) = response {
			if resp.status().is_success() {
				if let Ok(json) = resp.json::<serde_json::Value>().await {
					if let Some(sha) = json.get("sha").and_then(|s| s.as_str())
					{
						let short_sha = &sha[..8.min(sha.len())];
						return Ok(Some((
							short_sha.to_string(),
							Some(sha.to_string()),
						)));
					}
				}
			}
		}

		// Try master
		let url = format!(
			"https://api.github.com/repos/{}/{}/commits/master",
			self.owner, self.repo
		);

		let response = self.client.get(&url).send().await?;

		if response.status().is_success() {
			let json: serde_json::Value = response.json().await?;
			if let Some(sha) = json.get("sha").and_then(|s| s.as_str()) {
				let short_sha = &sha[..8.min(sha.len())];
				return Ok(Some((
					short_sha.to_string(),
					Some(sha.to_string()),
				)));
			}
		}

		Ok(None)
	}
}

/// Local filesystem registry (for local development)
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
		let manifest_path =
			find_plugin_manifest_path(&plugin_dir).ok_or_else(|| {
				anyhow::anyhow!(
					"plugin.json not found in local plugin: {}",
					name
				)
			})?;
		let content = tokio::fs::read_to_string(&manifest_path).await?;
		let manifest: PluginManifest = serde_json::from_str(&content)?;
		Ok(manifest)
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

		// Copy directory recursively
		copy_dir_all(&source_dir, target_dir).await?;

		// Local plugins don't have a commit SHA
		Ok(None)
	}

	async fn get_latest_version(
		&self,
		_name: &str,
	) -> Result<Option<(String, Option<String>)>> {
		// Local plugins are always "local" version
		Ok(Some(("local".to_string(), None)))
	}
}

/// Marketplace registry that reads from local git clone and supports remote plugins
pub struct MarketplaceRegistry {
	/// Path to the local marketplace clone (e.g., ~/.claude/plugins/marketplaces/claude-plugins-official)
	marketplace_path: PathBuf,
	/// Subdirectories containing plugins (e.g., ["plugins/", "external_plugins/"])
	plugins_subdirs: Vec<String>,
	/// Upstream repository used to refresh snapshot-style marketplaces
	upstream_repo: Option<String>,
	/// HTTP client for fetching remote plugins
	client: reqwest::Client,
	/// Git-based installer for remote plugins
	git_installer: GitBasedInstaller,
}

impl MarketplaceRegistry {
	pub fn new(
		marketplace_path: PathBuf,
		plugins_subdirs: Vec<String>,
	) -> Self {
		Self::new_with_upstream(marketplace_path, plugins_subdirs, None)
	}

	pub fn new_with_upstream(
		marketplace_path: PathBuf,
		plugins_subdirs: Vec<String>,
		upstream_repo: Option<String>,
	) -> Self {
		let client = reqwest::Client::builder()
			.timeout(std::time::Duration::from_secs(60))
			.build()
			.unwrap_or_default();

		Self {
			marketplace_path,
			plugins_subdirs,
			upstream_repo,
			client,
			git_installer: GitBasedInstaller::new(),
		}
	}

	/// Create with default official marketplace directories
	pub fn new_official() -> anyhow::Result<Self> {
		let marketplace_path = dirs::home_dir()
			.ok_or_else(|| anyhow::anyhow!("Cannot find home directory"))?
			.join(".claude/plugins/marketplaces/claude-plugins-official");

		let client = reqwest::Client::builder()
			.timeout(std::time::Duration::from_secs(60))
			.build()?;

		Ok(Self {
			marketplace_path,
			plugins_subdirs: vec![
				"plugins/".to_string(),
				"external_plugins/".to_string(),
			],
			upstream_repo: Some(OFFICIAL_MARKETPLACE_REPO.to_string()),
			client,
			git_installer: GitBasedInstaller::new(),
		})
	}

	/// Load marketplace configuration from marketplace.json
	async fn load_marketplace_config(&self) -> Result<MarketplaceConfig> {
		let marketplace_json = self
			.marketplace_path
			.join(".claude-plugin/marketplace.json");

		if !marketplace_json.exists() {
			anyhow::bail!(
				"Marketplace configuration not found at {:?}",
				marketplace_json
			);
		}

		let content = tokio::fs::read_to_string(&marketplace_json).await?;
		let config: MarketplaceConfig = serde_json::from_str(&content)?;
		Ok(config)
	}

	/// Find plugin definition in marketplace.json
	async fn find_plugin_def(
		&self,
		name: &str,
	) -> Result<Option<MarketplacePlugin>> {
		let config = self.load_marketplace_config().await?;
		Ok(config.plugins.into_iter().find(|p| p.name == name))
	}

	/// Get the plugin source directory (searches all subdirs)
	fn plugin_source_dir(&self, name: &str) -> Option<PathBuf> {
		for subdir in &self.plugins_subdirs {
			let path = self.marketplace_path.join(subdir).join(name);
			if path.exists() {
				return Some(path);
			}
		}
		None
	}

	/// List all available plugins from the local marketplace
	pub fn list_plugins(&self) -> Result<Vec<(String, PathBuf)>> {
		let mut plugins = Vec::new();

		for subdir in &self.plugins_subdirs {
			let plugins_dir = self.marketplace_path.join(subdir);

			if !plugins_dir.exists() {
				continue;
			}

			let entries = std::fs::read_dir(&plugins_dir)?;

			for entry in entries {
				let entry = entry?;
				let path = entry.path();

				if path.is_dir() {
					// Check if it has a valid plugin.json
					if find_plugin_manifest_path(&path).is_some() {
						if let Some(name) =
							path.file_name().and_then(|n| n.to_str())
						{
							plugins.push((name.to_string(), path));
						}
					}
				}
			}
		}

		plugins.sort_by(|a, b| a.0.cmp(&b.0));
		Ok(plugins)
	}

	/// Update the marketplace by pulling latest changes
	pub async fn update(&self) -> Result<()> {
		use tokio::process::Command;

		if !self.marketplace_path.exists() {
			return self.clone_marketplace().await;
		}

		if is_git_repository(&self.marketplace_path) {
			let output = Command::new("git")
				.args(["pull"])
				.current_dir(&self.marketplace_path)
				.output()
				.await
				.context("Failed to execute git pull")?;

			if !output.status.success() {
				let stderr = String::from_utf8_lossy(&output.stderr);
				anyhow::bail!("Git pull failed: {}", stderr);
			}

			log::info!("Marketplace updated successfully");
			return Ok(());
		}

		log::info!(
			"Marketplace at {:?} is a snapshot, refreshing from upstream clone",
			self.marketplace_path
		);
		self.replace_snapshot_from_upstream().await?;

		log::info!("Marketplace updated successfully");
		Ok(())
	}

	async fn clone_marketplace(&self) -> Result<()> {
		use tokio::process::Command;

		let upstream_repo = self.upstream_repo.as_deref().ok_or_else(|| {
			anyhow::anyhow!(
				"Marketplace directory not found and no upstream repo is configured: {:?}",
				self.marketplace_path
			)
		})?;

		let parent_dir = self.marketplace_path.parent().ok_or_else(|| {
			anyhow::anyhow!(
				"Invalid marketplace path: {:?}",
				self.marketplace_path
			)
		})?;

		tokio::fs::create_dir_all(parent_dir).await?;

		let output = Command::new("git")
			.args(["clone", "--depth", "1", upstream_repo])
			.arg(&self.marketplace_path)
			.output()
			.await
			.context("Failed to execute git clone")?;

		if !output.status.success() {
			let stderr = String::from_utf8_lossy(&output.stderr);
			anyhow::bail!("Git clone failed: {}", stderr);
		}

		Ok(())
	}

	async fn replace_snapshot_from_upstream(&self) -> Result<()> {
		use tokio::process::Command;

		let upstream_repo = self.upstream_repo.as_deref().ok_or_else(|| {
			anyhow::anyhow!(
				"Marketplace snapshot cannot be refreshed without an upstream repo"
			)
		})?;

		let parent_dir = self.marketplace_path.parent().ok_or_else(|| {
			anyhow::anyhow!(
				"Invalid marketplace path: {:?}",
				self.marketplace_path
			)
		})?;
		tokio::fs::create_dir_all(parent_dir).await?;

		let name = self
			.marketplace_path
			.file_name()
			.and_then(|value| value.to_str())
			.unwrap_or("marketplace");
		let suffix = unique_suffix();
		let clone_path = parent_dir.join(format!(".{name}-clone-{suffix}"));
		let backup_path = parent_dir.join(format!(".{name}-backup-{suffix}"));

		if clone_path.exists() {
			tokio::fs::remove_dir_all(&clone_path).await.ok();
		}
		if backup_path.exists() {
			tokio::fs::remove_dir_all(&backup_path).await.ok();
		}

		let clone_output = Command::new("git")
			.args(["clone", "--depth", "1", upstream_repo])
			.arg(&clone_path)
			.output()
			.await
			.context("Failed to execute git clone for marketplace refresh")?;

		if !clone_output.status.success() {
			let stderr = String::from_utf8_lossy(&clone_output.stderr);
			tokio::fs::remove_dir_all(&clone_path).await.ok();
			anyhow::bail!("Git clone failed: {}", stderr);
		}

		tokio::fs::rename(&self.marketplace_path, &backup_path)
			.await
			.with_context(|| {
				format!(
					"Failed to move existing marketplace out of the way: {:?}",
					self.marketplace_path
				)
			})?;

		if let Err(error) =
			tokio::fs::rename(&clone_path, &self.marketplace_path).await
		{
			let restore_result =
				tokio::fs::rename(&backup_path, &self.marketplace_path).await;
			tokio::fs::remove_dir_all(&clone_path).await.ok();
			match restore_result {
				Ok(_) => {
					return Err(error).with_context(|| {
						"Failed to replace marketplace snapshot".to_string()
					});
				}
				Err(restore_error) => {
					return Err(error).context(format!(
						"Failed to replace marketplace snapshot, and restore also failed: {restore_error}"
					));
				}
			}
		}

		tokio::fs::remove_dir_all(&backup_path).await.ok();
		Ok(())
	}
}

#[async_trait]
impl PluginRegistry for MarketplaceRegistry {
	async fn fetch_manifest(&self, name: &str) -> Result<PluginManifest> {
		// First, try to find the plugin in marketplace.json
		if let Some(plugin_def) = self.find_plugin_def(name).await? {
			match &plugin_def.source {
				// Local source - read from filesystem
				MarketplaceSource::Local(path) => {
					let plugin_dir = self
						.marketplace_path
						.join(path.trim_start_matches("./"));
					let manifest_path = find_plugin_manifest_path(&plugin_dir)
						.ok_or_else(|| {
							anyhow::anyhow!(
								"plugin.json not found for local plugin: {}",
								name
							)
						})?;
					let content =
						tokio::fs::read_to_string(&manifest_path).await?;
					let manifest: PluginManifest =
						serde_json::from_str(&content)?;
					return Ok(manifest);
				}
				// Remote URL - fetch from git repository
				MarketplaceSource::Url { url, .. } => {
					return self.fetch_remote_manifest(url, name).await;
				}
				// GitHub source - fetch from GitHub
				MarketplaceSource::GitHub { repo, .. } => {
					let url = if repo.starts_with("https://") {
						repo.clone()
					} else {
						format!("https://github.com/{}", repo)
					};
					return self.fetch_remote_manifest(&url, name).await;
				}
				// Git subdirectory - treat as URL
				MarketplaceSource::GitSubdir { url, .. } => {
					return self.fetch_remote_manifest(url, name).await;
				}
				// NPM - not supported
				MarketplaceSource::Npm { package, .. } => {
					anyhow::bail!(
						"NPM package source not yet supported: {}",
						package
					);
				}
			}
		}

		// Fallback: try to find in local plugins directories (for backward compatibility)
		if let Some(plugin_dir) = self.plugin_source_dir(name) {
			let manifest_path = find_plugin_manifest_path(&plugin_dir)
				.ok_or_else(|| {
					anyhow::anyhow!("plugin.json not found for: {}", name)
				})?;
			let content = tokio::fs::read_to_string(&manifest_path).await?;
			let manifest: PluginManifest = serde_json::from_str(&content)?;
			return Ok(manifest);
		}

		anyhow::bail!("Plugin not found in marketplace: {}", name)
	}

	async fn install(
		&self,
		name: &str,
		target_dir: &Path,
	) -> Result<Option<String>> {
		// First, try to find the plugin in marketplace.json
		if let Some(plugin_def) = self.find_plugin_def(name).await? {
			match &plugin_def.source {
				// Local source - copy from filesystem
				MarketplaceSource::Local(path) => {
					let source_dir = self
						.marketplace_path
						.join(path.trim_start_matches("./"));
					if !source_dir.exists() {
						anyhow::bail!(
							"Local plugin directory not found: {}",
							source_dir.display()
						);
					}
					copy_dir_all(&source_dir, target_dir).await?;
					let commit =
						self.get_marketplace_commit().await.ok().flatten();
					return Ok(commit);
				}
				// Remote URL - download from git
				MarketplaceSource::Url { url, .. } => {
					return self.install_remote(url, name, target_dir).await;
				}
				// GitHub source - download from GitHub
				MarketplaceSource::GitHub { repo, .. } => {
					let url = if repo.starts_with("https://") {
						repo.clone()
					} else {
						format!("https://github.com/{}", repo)
					};
					return self.install_remote(&url, name, target_dir).await;
				}
				// Git subdirectory
				MarketplaceSource::GitSubdir {
					url, path: subdir, ..
				} => {
					return self
						.install_remote_subdir(url, subdir, target_dir)
						.await;
				}
				// NPM - not supported
				MarketplaceSource::Npm { package, .. } => {
					anyhow::bail!(
						"NPM package source not yet supported: {}",
						package
					);
				}
			}
		}

		// Fallback: try to find in local plugins directories
		if let Some(source_dir) = self.plugin_source_dir(name) {
			copy_dir_all(&source_dir, target_dir).await?;
			let commit = self.get_marketplace_commit().await.ok().flatten();
			return Ok(commit);
		}

		anyhow::bail!("Plugin not found in marketplace: {}", name)
	}

	async fn get_latest_version(
		&self,
		name: &str,
	) -> Result<Option<(String, Option<String>)>> {
		// First, try to find the plugin in marketplace.json
		if let Some(plugin_def) = self.find_plugin_def(name).await? {
			// Get commit SHA based on source type first
			let commit = match &plugin_def.source {
				MarketplaceSource::Local(_) => {
					self.get_marketplace_commit().await.ok().flatten()
				}
				MarketplaceSource::Url { sha, .. } => sha.clone(),
				MarketplaceSource::GitHub { sha, .. } => sha.clone(),
				MarketplaceSource::GitSubdir { sha, .. } => sha.clone(),
				MarketplaceSource::Npm { .. } => None,
			};

			// Use version from marketplace.json if available
			// Otherwise try to fetch from remote manifest for remote plugins
			let version = if let Some(v) = plugin_def.version {
				v
			} else {
				// For remote plugins, fetch manifest to get version
				match &plugin_def.source {
					MarketplaceSource::Url { url, .. } => {
						if let Ok(manifest) =
							self.fetch_remote_manifest(url, name).await
						{
							manifest
								.version
								.unwrap_or_else(|| "latest".to_string())
						} else {
							"latest".to_string()
						}
					}
					MarketplaceSource::GitHub { repo, .. } => {
						let url = if repo.starts_with("https://") {
							repo.clone()
						} else {
							format!("https://github.com/{}", repo)
						};
						if let Ok(manifest) =
							self.fetch_remote_manifest(&url, name).await
						{
							manifest
								.version
								.unwrap_or_else(|| "latest".to_string())
						} else {
							"latest".to_string()
						}
					}
					MarketplaceSource::GitSubdir { url, .. } => {
						if let Ok(manifest) =
							self.fetch_remote_manifest(url, name).await
						{
							manifest
								.version
								.unwrap_or_else(|| "latest".to_string())
						} else {
							"latest".to_string()
						}
					}
					_ => "latest".to_string(),
				}
			};

			return Ok(Some((version, commit)));
		}

		// Fallback: try to find in local plugins directories
		if self.plugin_source_dir(name).is_some() {
			let manifest = self.read_manifest(name).await?;
			let version = manifest
				.and_then(|m| m.version)
				.unwrap_or_else(|| "latest".to_string());
			let commit = self.get_marketplace_commit().await.ok().flatten();
			return Ok(Some((version, commit)));
		}

		Ok(None)
	}
}

impl MarketplaceRegistry {
	/// Fetch manifest from remote git repository
	async fn fetch_remote_manifest(
		&self,
		url: &str,
		name: &str,
	) -> Result<PluginManifest> {
		// Try to fetch from raw GitHub content first
		if let Some(manifest) =
			self.try_fetch_github_raw_manifest(url, name).await
		{
			return Ok(manifest);
		}

		// Fallback: download tarball and extract manifest
		self.fetch_manifest_from_tarball(url, name).await
	}

	/// Try to fetch manifest from raw.githubusercontent.com
	async fn try_fetch_github_raw_manifest(
		&self,
		url: &str,
		name: &str,
	) -> Option<PluginManifest> {
		if !url.contains("github.com") {
			return None;
		}

		let parts: Vec<_> = url.trim_end_matches('/').split('/').collect();
		let owner = parts.get(parts.len().checked_sub(2)?)?;
		let repo = parts.last()?.trim_end_matches(".git");

		// Try common manifest locations
		let paths = [
			".claude-plugin/plugin.json",
			".plugin/plugin.json",
			"plugin.json",
			&format!("{}/.claude-plugin/plugin.json", name),
			&format!("{}/.plugin/plugin.json", name),
			&format!("{}/plugin.json", name),
		];

		for path in &paths {
			// Try main branch
			let raw_url = format!(
				"https://raw.githubusercontent.com/{}/{}/main/{}",
				owner, repo, path
			);
			if let Some(manifest) = self.fetch_manifest_from_url(&raw_url).await
			{
				return Some(manifest);
			}

			// Try master branch
			let raw_url = format!(
				"https://raw.githubusercontent.com/{}/{}/master/{}",
				owner, repo, path
			);
			if let Some(manifest) = self.fetch_manifest_from_url(&raw_url).await
			{
				return Some(manifest);
			}
		}

		None
	}

	/// Fetch manifest from a specific URL
	async fn fetch_manifest_from_url(
		&self,
		url: &str,
	) -> Option<PluginManifest> {
		let response = self.client.get(url).send().await.ok()?;
		if !response.status().is_success() {
			return None;
		}
		response.json::<PluginManifest>().await.ok()
	}

	/// Download tarball and extract manifest
	async fn fetch_manifest_from_tarball(
		&self,
		url: &str,
		name: &str,
	) -> Result<PluginManifest> {
		let temp_dir = std::env::temp_dir().join(format!(
			"aghub-plugin-manifest-{}-{}",
			name,
			std::process::id()
		));

		// Clean up temp dir if it exists
		if temp_dir.exists() {
			tokio::fs::remove_dir_all(&temp_dir).await.ok();
		}

		if let Err(e) =
			extract_repository_archive(&self.git_installer, url, &temp_dir)
				.await
		{
			tokio::fs::remove_dir_all(&temp_dir).await.ok();
			anyhow::bail!("Failed to download remote plugin manifest: {}", e);
		}

		let plugin_dir =
			resolve_plugin_dir(&temp_dir, &remote_plugin_candidates(name))
				.ok_or_else(|| {
					anyhow::anyhow!(
						"plugin root not found in remote repository"
					)
				})?;

		// Find and read manifest
		let manifest = self.find_manifest_in_dir(&plugin_dir).await;

		// Clean up temp dir
		tokio::fs::remove_dir_all(&temp_dir).await.ok();

		manifest.map_err(|e| {
			anyhow::anyhow!(
				"plugin.json not found in remote plugin '{}': {}",
				name,
				e
			)
		})
	}

	/// Find manifest in a directory by trying common paths
	async fn find_manifest_in_dir(&self, dir: &Path) -> Result<PluginManifest> {
		if let Some(path) = find_plugin_manifest_path(dir) {
			let content = tokio::fs::read_to_string(path).await?;
			return serde_json::from_str(&content).map_err(|e| {
				anyhow::anyhow!("Failed to parse plugin.json: {}", e)
			});
		}

		anyhow::bail!("plugin.json not found in directory: {:?}", dir)
	}

	/// Install plugin from remote git repository
	async fn install_remote(
		&self,
		url: &str,
		name: &str,
		target_dir: &Path,
	) -> Result<Option<String>> {
		log::info!("Installing remote plugin from {} to {:?}", url, target_dir);
		let temp_dir = std::env::temp_dir().join(format!(
			"aghub-plugin-install-{}-{}",
			name,
			std::process::id()
		));

		if temp_dir.exists() {
			tokio::fs::remove_dir_all(&temp_dir).await.ok();
		}

		let commit = match extract_repository_archive(
			&self.git_installer,
			url,
			&temp_dir,
		)
		.await
		{
			Ok(commit) => commit,
			Err(error) => {
				tokio::fs::remove_dir_all(&temp_dir).await.ok();
				return Err(anyhow::anyhow!(
					"Failed to install remote plugin '{}': {}",
					name,
					error
				));
			}
		};

		let source_dir = match resolve_plugin_dir(
			&temp_dir,
			&remote_plugin_candidates(name),
		) {
			Some(path) => path,
			None => {
				// Fallback: scan immediate subdirectories for a manifest.
				// Some repos extract with an extra prefix directory that
				// `remote_plugin_candidates` doesn't anticipate.
				let mut found = None;
				if let Ok(mut entries) = tokio::fs::read_dir(&temp_dir).await {
					while let Ok(Some(entry)) = entries.next_entry().await {
						let p = entry.path();
						if p.is_dir() && find_plugin_manifest_path(&p).is_some()
						{
							log::info!(
								"Fallback found plugin manifest in {:?}",
								p
							);
							found = Some(p);
							break;
						}
					}
				}
				match found {
					Some(path) => path,
					None => {
						// Log directory contents for diagnostics
						let contents: Vec<_> = std::fs::read_dir(&temp_dir)
							.map(|rd| {
								rd.filter_map(|e| e.ok())
									.map(|e| format!("{:?}", e.file_name()))
									.collect()
							})
							.unwrap_or_default();
						log::error!(
							"Plugin manifest not found for '{}'. \
							 temp_dir={:?}, contents={:?}",
							name,
							temp_dir,
							contents
						);
						tokio::fs::remove_dir_all(&temp_dir).await.ok();
						anyhow::bail!(
							"Plugin directory not found in remote \
							 repository for '{}'",
							name
						);
					}
				}
			}
		};

		let copy_result = copy_dir_all(&source_dir, target_dir).await;
		tokio::fs::remove_dir_all(&temp_dir).await.ok();
		copy_result.map(|_| Some(commit))
	}

	/// Install plugin from remote git repository subdirectory
	async fn install_remote_subdir(
		&self,
		url: &str,
		subdir: &str,
		target_dir: &Path,
	) -> Result<Option<String>> {
		log::info!(
			"Installing remote plugin from {}/{} to {:?}",
			url,
			subdir,
			target_dir
		);

		// Download entire repo to temp dir, then copy subdirectory
		let temp_dir = std::env::temp_dir().join(format!(
			"aghub-plugin-temp-{}-{}",
			subdir.replace('/', "_"),
			std::process::id()
		));

		// Clean up temp dir if it exists
		if temp_dir.exists() {
			tokio::fs::remove_dir_all(&temp_dir).await.ok();
		}

		// Download and extract entire repo
		let commit = match extract_repository_archive(
			&self.git_installer,
			url,
			&temp_dir,
		)
		.await
		{
			Ok(c) => c,
			Err(e) => {
				tokio::fs::remove_dir_all(&temp_dir).await.ok();
				anyhow::bail!(
					"Failed to install remote plugin subdirectory: {}",
					e
				);
			}
		};

		// Find the subdirectory in the extracted content
		let candidates = vec![PathBuf::from(subdir.trim_matches('/'))];
		let source_dir = match resolve_plugin_dir(&temp_dir, &candidates) {
			Some(path) => path,
			None => {
				tokio::fs::remove_dir_all(&temp_dir).await.ok();
				anyhow::bail!(
					"Subdirectory '{}' not found in remote repository",
					subdir
				);
			}
		};
		if !source_dir.exists() {
			tokio::fs::remove_dir_all(&temp_dir).await.ok();
			anyhow::bail!(
				"Subdirectory '{}' not found in remote repository",
				subdir
			);
		}

		// Copy subdirectory to target
		let copy_result = copy_dir_all(&source_dir, target_dir).await;

		// Clean up temp dir
		tokio::fs::remove_dir_all(&temp_dir).await.ok();

		copy_result.map(|_| Some(commit))
	}

	/// Read plugin manifest from local marketplace
	async fn read_manifest(
		&self,
		name: &str,
	) -> Result<Option<PluginManifest>> {
		let plugin_dir = match self.plugin_source_dir(name) {
			Some(p) => p,
			None => return Ok(None),
		};

		let manifest_path = match find_plugin_manifest_path(&plugin_dir) {
			Some(p) => p,
			None => return Ok(None),
		};

		let content = tokio::fs::read_to_string(&manifest_path).await?;
		let manifest: PluginManifest = serde_json::from_str(&content)?;

		Ok(Some(manifest))
	}

	/// Get the current commit SHA of the marketplace repo
	async fn get_marketplace_commit(&self) -> Result<Option<String>> {
		use tokio::process::Command;

		let output = Command::new("git")
			.args(["rev-parse", "HEAD"])
			.current_dir(&self.marketplace_path)
			.output()
			.await
			.context("Failed to get marketplace commit")?;

		if output.status.success() {
			let commit =
				String::from_utf8_lossy(&output.stdout).trim().to_string();
			return Ok(Some(commit));
		}

		Ok(None)
	}
}

/// Copy directory recursively
async fn copy_dir_all(src: &Path, dst: &Path) -> Result<()> {
	tokio::fs::create_dir_all(dst).await?;

	let mut entries = tokio::fs::read_dir(src).await?;

	while let Some(entry) = entries.next_entry().await? {
		let src_path = entry.path();
		let dst_path = dst.join(entry.file_name());

		// Skip .git directory
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
	use std::time::{SystemTime, UNIX_EPOCH};

	fn make_temp_dir(prefix: &str) -> PathBuf {
		let unique = SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.unwrap()
			.as_nanos();
		let path = std::env::temp_dir().join(format!("{prefix}-{unique}"));
		std::fs::create_dir_all(&path).unwrap();
		path
	}

	#[tokio::test]
	async fn test_local_registry_supports_plugin_root_base_path() {
		let temp_dir = make_temp_dir("aghub-local-registry");
		let plugin_dir = temp_dir.join("demo-plugin");
		let install_dir = temp_dir.join("installed");
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

		std::fs::remove_dir_all(&temp_dir).unwrap();
	}

	#[test]
	fn test_resolve_plugin_dir_finds_repo_root_manifest() {
		let temp_dir = make_temp_dir("aghub-remote-registry-root");
		let manifest_dir = temp_dir.join(".claude-plugin");
		std::fs::create_dir_all(&manifest_dir).unwrap();
		std::fs::write(
			manifest_dir.join("plugin.json"),
			r#"{"name":"demo-plugin","description":"test","author":{"name":"A"}}"#,
		)
		.unwrap();

		let resolved = resolve_plugin_dir(
			&temp_dir,
			&remote_plugin_candidates("demo-plugin"),
		)
		.unwrap();
		assert_eq!(resolved, temp_dir);

		std::fs::remove_dir_all(&resolved).unwrap();
	}

	#[test]
	fn test_resolve_plugin_dir_finds_named_subdirectory_manifest() {
		let temp_dir = make_temp_dir("aghub-remote-registry-subdir");
		let plugin_dir = temp_dir.join("demo-plugin");
		let manifest_dir = plugin_dir.join(".claude-plugin");
		std::fs::create_dir_all(&manifest_dir).unwrap();
		std::fs::write(
			manifest_dir.join("plugin.json"),
			r#"{"name":"demo-plugin","description":"test","author":{"name":"A"}}"#,
		)
		.unwrap();

		let resolved = resolve_plugin_dir(
			&temp_dir,
			&remote_plugin_candidates("demo-plugin"),
		)
		.unwrap();
		assert_eq!(resolved, plugin_dir);

		std::fs::remove_dir_all(&temp_dir).unwrap();
	}

	#[tokio::test]
	async fn test_update_replaces_snapshot_marketplace_from_upstream_repo() {
		let source_dir = make_temp_dir("aghub-marketplace-source");
		std::fs::create_dir_all(source_dir.join(".claude-plugin")).unwrap();
		std::fs::create_dir_all(source_dir.join("plugins/demo")).unwrap();
		std::fs::write(
			source_dir.join(".claude-plugin/marketplace.json"),
			r#"{"name":"claude-plugins-official","description":"test","owner":{"name":"A"},"plugins":[]}"#,
		)
		.unwrap();
		std::fs::write(source_dir.join("README.md"), "fresh").unwrap();

		let init_status = std::process::Command::new("git")
			.args(["init"])
			.current_dir(&source_dir)
			.status()
			.unwrap();
		assert!(init_status.success());

		let add_status = std::process::Command::new("git")
			.args(["add", "."])
			.current_dir(&source_dir)
			.status()
			.unwrap();
		assert!(add_status.success());

		let commit_status = std::process::Command::new("git")
			.args([
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@example.com",
				"commit",
				"-m",
				"init",
			])
			.current_dir(&source_dir)
			.status()
			.unwrap();
		assert!(commit_status.success());

		let snapshot_dir = make_temp_dir("aghub-marketplace-snapshot");
		std::fs::create_dir_all(snapshot_dir.join(".claude-plugin")).unwrap();
		std::fs::write(
			snapshot_dir.join(".claude-plugin/marketplace.json"),
			r#"{"name":"claude-plugins-official","description":"old","owner":{"name":"A"},"plugins":[]}"#,
		)
		.unwrap();
		std::fs::write(snapshot_dir.join("README.md"), "stale").unwrap();

		let registry = MarketplaceRegistry::new_with_upstream(
			snapshot_dir.clone(),
			vec!["plugins/".to_string()],
			Some(source_dir.display().to_string()),
		);

		registry.update().await.unwrap();

		assert!(snapshot_dir.join(".git").exists());
		assert_eq!(
			std::fs::read_to_string(snapshot_dir.join("README.md")).unwrap(),
			"fresh"
		);

		std::fs::remove_dir_all(&source_dir).unwrap();
		std::fs::remove_dir_all(&snapshot_dir).unwrap();
	}
}
