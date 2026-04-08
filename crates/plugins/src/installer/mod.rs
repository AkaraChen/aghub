//! Plugin installer - standalone implementation without Claude CLI dependency

pub mod git;
pub mod registry;

use crate::claude::{
	settings::{ClaudeSettings, InstallScope},
	types::InstalledPluginInfo,
	ClaudePluginManager,
};
use crate::PluginId;
use anyhow::{Context, Result};
use chrono::Utc;
use std::path::PathBuf;

use self::registry::{
	local_source_remote_fallback, normalize_repository_url, GitHubRegistry,
	PluginRegistry,
};
use crate::discovery::{MarketplaceConfig, MarketplaceSource};

/// Plugin installer that manages installation without Claude CLI
pub struct PluginInstaller {
	/// Cache root directory (~/.claude/plugins/cache)
	cache_root: PathBuf,
	/// Marketplace root directory
	marketplace_root: PathBuf,
	/// HTTP client for downloads
	client: reqwest::Client,
}

impl PluginInstaller {
	fn marketplace_path_for(&self, marketplace: &str) -> PathBuf {
		self.marketplace_root
			.parent()
			.unwrap_or(&self.marketplace_root)
			.join(marketplace)
	}

	fn common_marketplace_subdirs() -> Vec<String> {
		vec!["plugins/".to_string(), "external_plugins/".to_string()]
	}

	fn marketplace_registry(
		&self,
		marketplace: &str,
	) -> Result<registry::MarketplaceRegistry> {
		if marketplace == "claude-plugins-official" {
			return registry::MarketplaceRegistry::new_official().context(
				"Official marketplace not found. Please clone it first: git clone https://github.com/anthropics/claude-plugins-official ~/.claude/plugins/marketplaces/claude-plugins-official",
			);
		}

		let marketplace_path = self.marketplace_path_for(marketplace);
		let marketplace_json =
			marketplace_path.join(".claude-plugin/marketplace.json");
		if !marketplace_json.exists() {
			anyhow::bail!("Marketplace '{}' not found", marketplace);
		}

		Ok(registry::MarketplaceRegistry::new(
			marketplace_path,
			Self::common_marketplace_subdirs(),
		))
	}

	fn is_marketplace_source(&self, source: &str) -> bool {
		self.marketplace_path_for(source)
			.join(".claude-plugin/marketplace.json")
			.exists()
	}

	/// Create a new plugin installer
	pub fn new() -> Result<Self> {
		let home = dirs::home_dir().context("Cannot find home directory")?;
		let cache_root = home.join(".claude/plugins/cache");
		let marketplace_root =
			home.join(".claude/plugins/marketplaces/claude-plugins-official");

		let client = reqwest::Client::builder()
			.timeout(std::time::Duration::from_secs(60))
			.build()?;

		Ok(Self {
			cache_root,
			marketplace_root,
			client,
		})
	}

	/// Create installer with custom cache root (for testing)
	pub fn with_roots(
		cache_root: PathBuf,
		marketplace_root: PathBuf,
	) -> Result<Self> {
		let client = reqwest::Client::builder()
			.timeout(std::time::Duration::from_secs(60))
			.build()?;

		Ok(Self {
			cache_root,
			marketplace_root,
			client,
		})
	}

	/// Check if a plugin is installed for the given scope
	pub async fn is_installed(
		&self,
		id: &PluginId,
		scope: InstallScope,
	) -> bool {
		let manager = match ClaudePluginManager::new() {
			Ok(m) => m,
			Err(_) => return false,
		};

		if let Some(plugin) = manager.get_plugin(id) {
			let scope_str = scope.to_string();
			return plugin.scopes.iter().any(|s| s.scope == scope_str);
		}

		false
	}

	/// Install a plugin
	pub async fn install(
		&self,
		id: &PluginId,
		scope: InstallScope,
	) -> Result<InstalledPluginInfo> {
		// Check if already installed for this scope
		let manager = ClaudePluginManager::new()?;
		let existing = manager.get_plugin(id);

		if let Some(plugin) = existing {
			// Check if this scope is already installed
			let scope_str = scope.to_string();
			if plugin.scopes.iter().any(|s| s.scope == scope_str) {
				anyhow::bail!(
					"Plugin '{}' is already installed for scope '{}'",
					id,
					scope
				);
			}
		}

		// Resolve the actual source for marketplace plugins and get appropriate registry
		let (registry, resolved_source, is_remote) =
			if self.is_marketplace_source(&id.source) {
				let (source, remote) = self
					.resolve_marketplace_source(&id.source, &id.name)
					.await?;
				let reg = self.marketplace_registry(&id.source)?;
				(Box::new(reg) as Box<dyn PluginRegistry>, source, remote)
			} else {
				let reg = self.get_registry(&id.source)?;
				(reg, id.source.clone(), id.source.starts_with("http"))
			};

		// Fetch manifest first to verify plugin exists
		let manifest = registry.fetch_manifest(&id.name).await?;

		// Determine target directory
		let source_dir = if is_remote {
			// Hash the URL for directory name
			format!("{:x}", md5::compute(&resolved_source))
		} else {
			// Local source - use the source name
			id.source.clone()
		};

		// Get latest version/commit
		let version_info = registry.get_latest_version(&id.name).await?;
		let (version, commit_sha) = match version_info {
			Some((ver, sha)) => (ver, sha),
			None => ("latest".to_string(), None),
		};

		// Target directory: ~/.claude/plugins/cache/<source>/<name>/<version>/
		let target_dir = self
			.cache_root
			.join(&source_dir)
			.join(&id.name)
			.join(&version);

		// Download and install
		let actual_commit = registry.install(&id.name, &target_dir).await?;

		// Build the install info
		let install_info = InstalledPluginInfo {
			scope: scope.to_string(),
			install_path: target_dir.to_string_lossy().to_string(),
			version: manifest
				.version
				.clone()
				.unwrap_or_else(|| version.clone()),
			installed_at: Utc::now().to_rfc3339(),
			last_updated: Utc::now().to_rfc3339(),
			git_commit_sha: actual_commit.or(commit_sha),
		};

		// Update installed_plugins.json
		Self::update_installed_manifest(id, install_info.clone())?;

		// Auto-enable plugin (default behavior)
		ClaudeSettings::update(|settings| {
			settings.set_enabled(id, true);
		})?;

		Ok(install_info)
	}

	/// Uninstall a plugin
	pub async fn uninstall(
		&self,
		id: &PluginId,
		scope: InstallScope,
		keep_data: bool,
	) -> Result<()> {
		let manager = ClaudePluginManager::new()?;

		// Get plugin info before removing
		let plugin = manager
			.get_plugin(id)
			.ok_or_else(|| anyhow::anyhow!("Plugin '{}' not found", id))?;

		let scope_str = scope.to_string();
		let scope_info = plugin
			.scopes
			.iter()
			.find(|s| s.scope == scope_str)
			.ok_or_else(|| {
				anyhow::anyhow!(
					"Plugin '{}' is not installed for scope '{}'",
					id,
					scope
				)
			})?;

		// Remove from installed_plugins.json
		Self::remove_from_manifest(id, &scope_str)?;

		// Remove files unless keep_data
		if !keep_data {
			let install_path = PathBuf::from(&scope_info.install_path);
			if install_path.exists() {
				tokio::fs::remove_dir_all(&install_path).await?;
			}

			// Clean up empty parent directories
			self.cleanup_empty_dirs(&install_path).await?;
		}

		// Check if this was the last scope - if so, disable plugin
		let remaining_scopes: Vec<_> = plugin
			.scopes
			.iter()
			.filter(|s| s.scope != scope_str)
			.collect();

		if remaining_scopes.is_empty() {
			ClaudeSettings::update(|settings| {
				settings.set_enabled(id, false);
			})?;
		}

		Ok(())
	}

	/// Update a plugin
	pub async fn update(
		&self,
		id: &PluginId,
		scope: InstallScope,
	) -> Result<InstalledPluginInfo> {
		// Check if update is available
		let update_info = self.check_update(id).await?;

		if update_info.is_none() {
			anyhow::bail!("Plugin '{}' is already up to date", id);
		}

		// Uninstall old version (keeping config data)
		self.uninstall(id, scope, true).await?;

		// Install new version
		self.install(id, scope).await
	}

	/// Check if update is available
	pub async fn check_update(
		&self,
		id: &PluginId,
	) -> Result<Option<(String, Option<String>)>> {
		let manager = ClaudePluginManager::new()?;

		let plugin = manager
			.get_plugin(id)
			.ok_or_else(|| anyhow::anyhow!("Plugin '{}' not found", id))?;

		let registry = self.get_registry(&id.source)?;

		// Get latest version from registry
		let latest = registry.get_latest_version(&id.name).await?;

		if let Some((latest_ver, latest_sha)) = latest {
			let current_ver = &plugin.version;

			// Compare versions
			// If versions are semantic, compare them properly
			// Otherwise compare commit SHAs
			let needs_update = if Self::is_semantic_version(current_ver)
				&& Self::is_semantic_version(&latest_ver)
			{
				Self::compare_versions(&latest_ver, current_ver) > 0
			} else {
				// Compare commit SHAs
				match &latest_sha {
					Some(new) => new != &plugin.commit_hash,
					None => latest_ver != *current_ver,
				}
			};

			if needs_update {
				return Ok(Some((latest_ver, latest_sha)));
			}
		}

		Ok(None)
	}

	/// Get registry for a plugin source
	fn get_registry(
		&self,
		source: &str,
	) -> anyhow::Result<Box<dyn PluginRegistry>> {
		match source {
			source if self.is_marketplace_source(source) => {
				Ok(Box::new(self.marketplace_registry(source)?))
			}
			url if url.starts_with("http") => {
				// Parse GitHub URL: https://github.com/owner/repo
				let parts: Vec<_> =
					url.trim_end_matches('/').split('/').collect();
				if parts.len() >= 2 {
					let owner = parts[parts.len() - 2];
					let repo = parts[parts.len() - 1].trim_end_matches(".git");
					Ok(Box::new(GitHubRegistry::new(
						self.client.clone(),
						owner,
						repo,
						None,
					)))
				} else {
					anyhow::bail!("Invalid GitHub URL: {}", url)
				}
			}
			path => {
				Ok(Box::new(registry::LocalRegistry::new(PathBuf::from(path))))
			}
		}
	}

	/// Resolve the actual source for a plugin from marketplace.json
	/// Returns (actual_source, is_remote) where actual_source is the source string
	/// and is_remote indicates if it needs to be fetched from remote
	async fn resolve_marketplace_source(
		&self,
		marketplace: &str,
		plugin_name: &str,
	) -> anyhow::Result<(String, bool)> {
		let marketplace_path = self.marketplace_path_for(marketplace);

		let marketplace_json =
			marketplace_path.join(".claude-plugin/marketplace.json");

		if !marketplace_json.exists() {
			anyhow::bail!("Marketplace configuration not found");
		}

		let content = tokio::fs::read_to_string(&marketplace_json).await?;
		let config: MarketplaceConfig = serde_json::from_str(&content)?;

		// Find the plugin in marketplace.json
		for plugin in config.plugins {
			if plugin.name == plugin_name {
				return match &plugin.source {
					// Local source - check if it exists locally
					MarketplaceSource::Local(path) => {
						let full_path = marketplace_path
							.join(path.trim_start_matches("./"));
						if full_path.exists() {
							Ok((full_path.to_string_lossy().to_string(), false))
						} else if let Some((repo_url, subdir)) =
							local_source_remote_fallback(&plugin, path)
						{
							Ok((format!("{repo_url}#{subdir}"), true))
						} else {
							// Local path doesn't exist, treat as needing download
							// This shouldn't happen for local sources, but handle gracefully
							anyhow::bail!(
								"Local plugin path not found: {}",
								full_path.display()
							);
						}
					}
					// Remote URL source - return the URL
					MarketplaceSource::Url { url, .. } => {
						Ok((normalize_repository_url(url), true))
					}
					// GitHub source - construct GitHub URL
					MarketplaceSource::GitHub { repo, .. } => {
						Ok((normalize_repository_url(repo), true))
					}
					// Git subdirectory - return the URL
					MarketplaceSource::GitSubdir { url, path, .. } => {
						let url = normalize_repository_url(url);
						let subdir = path.trim_matches('/');
						Ok((format!("{url}#{subdir}"), true))
					}
					// NPM source - not supported yet
					MarketplaceSource::Npm { package, .. } => {
						anyhow::bail!(
							"NPM package source not yet supported: {}",
							package
						);
					}
				};
			}
		}

		anyhow::bail!("Plugin '{}' not found in marketplace", plugin_name)
	}

	/// Update installed_plugins.json with new installation
	fn update_installed_manifest(
		id: &PluginId,
		info: InstalledPluginInfo,
	) -> Result<()> {
		use crate::claude::types::InstalledPluginsManifest;

		let manifest_path = dirs::home_dir()
			.context("Cannot find home directory")?
			.join(".claude/plugins/installed_plugins.json");

		let plugin_id_str = id.to_string();
		InstalledPluginsManifest::update(&manifest_path, |manifest| {
			manifest
				.plugins
				.entry(plugin_id_str)
				.or_default()
				.push(info);
		})
	}

	/// Remove installation from manifest
	fn remove_from_manifest(id: &PluginId, scope: &str) -> Result<()> {
		use crate::claude::types::InstalledPluginsManifest;

		let manifest_path = dirs::home_dir()
			.context("Cannot find home directory")?
			.join(".claude/plugins/installed_plugins.json");

		let plugin_id_str = id.to_string();
		InstalledPluginsManifest::update(&manifest_path, |manifest| {
			if let Some(installations) =
				manifest.plugins.get_mut(&plugin_id_str)
			{
				installations.retain(|i| i.scope != scope);

				if installations.is_empty() {
					manifest.plugins.remove(&plugin_id_str);
				}
			}
		})
	}

	/// Clean up empty parent directories after uninstall
	async fn cleanup_empty_dirs(
		&self,
		install_path: &std::path::Path,
	) -> Result<()> {
		let mut current = install_path.parent();

		while let Some(dir) = current {
			// Stop at cache root
			if dir == self.cache_root {
				break;
			}

			if dir.exists() {
				let is_empty = tokio::fs::read_dir(dir)
					.await?
					.next_entry()
					.await?
					.is_none();

				if is_empty {
					tokio::fs::remove_dir(dir).await.ok();
				} else {
					break;
				}
			}

			current = dir.parent();
		}

		Ok(())
	}

	/// Check if version string looks like semantic version
	fn is_semantic_version(ver: &str) -> bool {
		// Simple check: starts with digit and contains at least one dot
		ver.chars()
			.next()
			.map(|c| c.is_ascii_digit())
			.unwrap_or(false)
			&& ver.contains('.')
	}

	/// Compare semantic versions using semver crate
	fn compare_versions(a: &str, b: &str) -> i32 {
		// Strip build metadata (everything after '+') as per SemVer spec
		let a_clean = a.split('+').next().unwrap_or(a);
		let b_clean = b.split('+').next().unwrap_or(b);

		// Try to parse as semver first
		match (
			semver::Version::parse(a_clean),
			semver::Version::parse(b_clean),
		) {
			(Ok(a_ver), Ok(b_ver)) => match a_ver.cmp(&b_ver) {
				std::cmp::Ordering::Less => -1,
				std::cmp::Ordering::Equal => 0,
				std::cmp::Ordering::Greater => 1,
			},
			// Fallback: simple numeric comparison
			_ => {
				let parse = |s: &str| {
					s.split('.')
						.filter_map(|p| p.parse::<u32>().ok())
						.collect::<Vec<_>>()
				};

				let a_parts = parse(a);
				let b_parts = parse(b);

				for (a_part, b_part) in a_parts.iter().zip(b_parts.iter()) {
					match a_part.cmp(b_part) {
						std::cmp::Ordering::Less => return -1,
						std::cmp::Ordering::Greater => return 1,
						std::cmp::Ordering::Equal => continue,
					}
				}

				a_parts.len().cmp(&b_parts.len()) as i32
			}
		}
	}
}

impl Default for PluginInstaller {
	fn default() -> Self {
		Self::new().expect("Failed to create PluginInstaller")
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_compare_versions() {
		// Basic semver comparisons
		assert_eq!(PluginInstaller::compare_versions("1.0.0", "1.0.0"), 0);
		assert_eq!(PluginInstaller::compare_versions("1.1.0", "1.0.0"), 1);
		assert_eq!(PluginInstaller::compare_versions("1.0.0", "1.1.0"), -1);
		assert_eq!(PluginInstaller::compare_versions("2.0.0", "1.9.9"), 1);

		// Semver with pre-release
		assert_eq!(
			PluginInstaller::compare_versions("1.0.0-alpha", "1.0.0"),
			-1
		);
		assert_eq!(
			PluginInstaller::compare_versions("1.0.0-beta", "1.0.0-alpha"),
			1
		);

		// Build metadata (should be ignored in comparison)
		assert_eq!(
			PluginInstaller::compare_versions("1.0.0+build1", "1.0.0+build2"),
			0
		);

		// Fallback for non-semver strings
		assert_eq!(PluginInstaller::compare_versions("1.0", "1.0.0"), -1);
		assert_eq!(PluginInstaller::compare_versions("abc", "def"), 0); // Both fail to parse
	}

	#[test]
	fn test_is_semantic_version() {
		assert!(PluginInstaller::is_semantic_version("1.0.0"));
		assert!(PluginInstaller::is_semantic_version("2.1.0-beta"));
		assert!(!PluginInstaller::is_semantic_version("abc123"));
		assert!(!PluginInstaller::is_semantic_version("latest"));
	}

	#[tokio::test]
	async fn test_resolve_marketplace_source_local() {
		let temp_root = std::env::temp_dir()
			.join(format!("aghub-mod-test-{}", std::process::id()));
		if temp_root.exists() {
			std::fs::remove_dir_all(&temp_root).unwrap();
		}
		std::fs::create_dir_all(&temp_root).unwrap();
		let marketplace_dir = temp_root.join("claude-plugins-official");

		let plugin_dir = marketplace_dir.join("plugins/test-plugin");
		std::fs::create_dir_all(&plugin_dir).unwrap();
		std::fs::create_dir_all(marketplace_dir.join(".claude-plugin"))
			.unwrap();

		std::fs::write(
			marketplace_dir.join(".claude-plugin/marketplace.json"),
			r#"{
				"name": "test-marketplace",
				"description": "test",
				"owner": { "name": "owner" },
				"plugins": [
					{
						"name": "test-plugin",
						"description": "desc",
						"source": "./plugins/test-plugin"
					}
				]
			}"#,
		)
		.unwrap();

		let installer = PluginInstaller::with_roots(
			temp_root.join("cache"),
			marketplace_dir.clone(),
		)
		.unwrap();

		let (source, is_remote) = installer
			.resolve_marketplace_source(
				"claude-plugins-official",
				"test-plugin",
			)
			.await
			.unwrap();

		assert_eq!(
			source,
			marketplace_dir
				.join("plugins/test-plugin")
				.to_string_lossy()
				.to_string()
		);
		assert!(!is_remote);

		std::fs::remove_dir_all(&temp_root).unwrap();
	}

	#[tokio::test]
	async fn test_resolve_marketplace_source_github() {
		let temp_root = std::env::temp_dir()
			.join(format!("aghub-mod-test-git-{}", std::process::id()));
		let marketplace_dir = temp_root.join("claude-plugins-official");
		std::fs::create_dir_all(marketplace_dir.join(".claude-plugin"))
			.unwrap();

		std::fs::write(
			marketplace_dir.join(".claude-plugin/marketplace.json"),
			r#"{
				"name": "test-marketplace",
				"description": "test",
				"owner": { "name": "owner" },
				"plugins": [
					{
						"name": "test-github",
						"description": "desc",
						"source": {
							"source": "github",
							"repo": "owner/repo"
						}
					}
				]
			}"#,
		)
		.unwrap();

		let installer = PluginInstaller::with_roots(
			temp_root.join("cache"),
			marketplace_dir,
		)
		.unwrap();

		let (source, is_remote) = installer
			.resolve_marketplace_source(
				"claude-plugins-official",
				"test-github",
			)
			.await
			.unwrap();

		assert_eq!(source, "https://github.com/owner/repo");
		assert!(is_remote);

		std::fs::remove_dir_all(&temp_root).unwrap();
	}

	#[tokio::test]
	async fn test_resolve_marketplace_source_local_fallback_remote() {
		let temp_root = std::env::temp_dir().join(format!(
			"aghub-mod-test-local-fallback-{}",
			std::process::id()
		));
		let marketplace_dir = temp_root.join("claude-plugins-official");
		std::fs::create_dir_all(marketplace_dir.join(".claude-plugin"))
			.unwrap();

		std::fs::write(
			marketplace_dir.join(".claude-plugin/marketplace.json"),
			r#"{
				"name": "test-marketplace",
				"description": "test",
				"owner": { "name": "owner" },
				"plugins": [
					{
						"name": "autofix-bot",
						"description": "desc",
						"homepage": "https://github.com/anthropics/claude-plugins-public/tree/main/external_plugins/autofix-bot",
						"source": "./external_plugins/autofix-bot"
					}
				]
			}"#,
		)
		.unwrap();

		let installer = PluginInstaller::with_roots(
			temp_root.join("cache"),
			marketplace_dir,
		)
		.unwrap();

		let (source, is_remote) = installer
			.resolve_marketplace_source(
				"claude-plugins-official",
				"autofix-bot",
			)
			.await
			.unwrap();

		assert_eq!(
			source,
			"https://github.com/anthropics/claude-plugins-public#external_plugins/autofix-bot"
		);
		assert!(is_remote);

		std::fs::remove_dir_all(&temp_root).unwrap();
	}

	#[tokio::test]
	async fn test_resolve_marketplace_source_for_custom_marketplace_root() {
		let temp_root = std::env::temp_dir().join(format!(
			"aghub-mod-test-custom-marketplace-{}",
			std::process::id()
		));
		let marketplaces_dir = temp_root.join("marketplaces");
		let marketplace_dir = marketplaces_dir.join("impeccable");
		std::fs::create_dir_all(marketplace_dir.join(".claude-plugin"))
			.unwrap();

		std::fs::write(
			marketplace_dir.join(".claude-plugin/marketplace.json"),
			r#"{
				"name": "impeccable",
				"description": "test",
				"owner": { "name": "owner" },
				"plugins": [
					{
						"name": "impeccable",
						"description": "desc",
						"version": "1.5.1",
						"source": "./"
					}
				]
			}"#,
		)
		.unwrap();
		std::fs::write(
			marketplace_dir.join(".claude-plugin/plugin.json"),
			r#"{"name":"impeccable","description":"test","author":{"name":"A"}}"#,
		)
		.unwrap();

		let installer = PluginInstaller::with_roots(
			temp_root.join("cache"),
			marketplaces_dir.join("claude-plugins-official"),
		)
		.unwrap();

		assert!(installer.is_marketplace_source("impeccable"));

		let (source, is_remote) = installer
			.resolve_marketplace_source("impeccable", "impeccable")
			.await
			.unwrap();

		assert_eq!(PathBuf::from(source), marketplace_dir);
		assert!(!is_remote);

		std::fs::remove_dir_all(&temp_root).unwrap();
	}
}
