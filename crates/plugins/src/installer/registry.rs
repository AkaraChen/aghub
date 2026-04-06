//! Plugin registry abstraction for different plugin sources

use super::git::GitBasedInstaller;
use crate::claude::types::PluginManifest;
use crate::discovery::{
	MarketplaceConfig, MarketplacePlugin, MarketplaceSource,
};
use anyhow::{Context, Result};
use async_trait::async_trait;
use std::path::{Path, PathBuf};

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

	/// Get the path to a plugin within the repo
	fn plugin_path(&self, name: &str) -> String {
		match &self.subdir {
			Some(sub) => format!("{}{}", sub, name),
			None => name.to_string(),
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
		let path = self.plugin_path(name);

		// Download tarball from GitHub
		let url = format!(
			"https://github.com/{}/{}/tarball/refs/heads/main",
			self.owner, self.repo
		);

		let result = self
			.git_installer
			.download_and_extract(&url, &path, target_dir)
			.await;

		if result.is_ok() {
			// Try to get commit SHA
			return Ok(self
				.git_installer
				.get_commit_sha(&url)
				.await
				.ok()
				.flatten());
		}

		// Try master branch
		let url = format!(
			"https://github.com/{}/{}/tarball/refs/heads/master",
			self.owner, self.repo
		);

		let commit = self
			.git_installer
			.download_and_extract(&url, &path, target_dir)
			.await?;

		Ok(Some(commit))
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
		let plugin_dir = self.base_path.join(name);

		// Try multiple manifest locations
		let possible_paths = [
			plugin_dir.join(".claude-plugin/plugin.json"),
			plugin_dir.join(".plugin/plugin.json"),
			plugin_dir.join("plugin.json"),
		];

		for path in &possible_paths {
			if path.exists() {
				let content = tokio::fs::read_to_string(path).await?;
				let manifest: PluginManifest = serde_json::from_str(&content)?;
				return Ok(manifest);
			}
		}

		anyhow::bail!("plugin.json not found in local plugin: {}", name)
	}

	async fn install(
		&self,
		name: &str,
		target_dir: &Path,
	) -> Result<Option<String>> {
		let source_dir = self.base_path.join(name);

		if !source_dir.exists() {
			anyhow::bail!("Local plugin directory not found: {:?}", source_dir);
		}

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
		let client = reqwest::Client::builder()
			.timeout(std::time::Duration::from_secs(60))
			.build()
			.unwrap_or_default();

		Self {
			marketplace_path,
			plugins_subdirs,
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

	/// Find plugin.json in various locations (like Claude CLI)
	fn find_manifest_path(plugin_dir: &Path) -> Option<PathBuf> {
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
					if Self::find_manifest_path(&path).is_some() {
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
			anyhow::bail!(
				"Marketplace directory not found: {:?}",
				self.marketplace_path
			);
		}

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
					let manifest_path = Self::find_manifest_path(&plugin_dir)
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
			let manifest_path = Self::find_manifest_path(&plugin_dir)
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

		// Download and extract
		let result = self
			.git_installer
			.download_and_extract(url, name, &temp_dir)
			.await;

		if let Err(e) = result {
			tokio::fs::remove_dir_all(&temp_dir).await.ok();
			anyhow::bail!("Failed to download remote plugin manifest: {}", e);
		}

		// Find and read manifest
		let manifest = self.find_manifest_in_dir(&temp_dir).await;

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
		let paths = [
			dir.join(".claude-plugin/plugin.json"),
			dir.join(".plugin/plugin.json"),
			dir.join("plugin.json"),
		];

		for path in &paths {
			if path.exists() {
				let content = tokio::fs::read_to_string(path).await?;
				return serde_json::from_str(&content).map_err(|e| {
					anyhow::anyhow!("Failed to parse plugin.json: {}", e)
				});
			}
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

		let commit = self
			.git_installer
			.download_and_extract(url, name, target_dir)
			.await
			.map_err(|e| {
				anyhow::anyhow!(
					"Failed to install remote plugin '{}': {}",
					name,
					e
				)
			})?;

		Ok(Some(commit))
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
		let commit = match self
			.git_installer
			.download_and_extract(url, "", &temp_dir)
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
		let source_dir = temp_dir.join(subdir);
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

		let manifest_path = match Self::find_manifest_path(&plugin_dir) {
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

	#[tokio::test]
	async fn test_fetch_remote_manifest_superpowers() {
		// Create a MarketplaceRegistry with test configuration
		let registry = MarketplaceRegistry::new(
			std::path::PathBuf::from("/tmp/test-marketplace"),
			vec!["plugins/".to_string(), "external_plugins/".to_string()],
		);

		// Test fetching superpowers manifest from GitHub (with .git suffix)
		let url = "https://github.com/obra/superpowers.git";
		let result = registry.fetch_remote_manifest(url, "superpowers").await;

		match &result {
			Ok(manifest) => {
				assert_eq!(manifest.name, "superpowers");
				assert!(manifest.version.is_some());
			}
			Err(e) => {
				panic!("Should successfully fetch superpowers manifest: {}", e);
			}
		}
	}
}
