//! Plugin market management
//!
//! Provides listing and search functionality for available plugins
//! using local marketplace clones (like Claude CLI), avoiding GitHub API rate limits.

pub mod cache;

use crate::claude::ClaudePluginManager;
use anyhow::{Context, Result};
use cache::{CachedPlugin, MarketCache};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Default marketplace name
pub const DEFAULT_MARKETPLACE: &str = "claude-plugins-official";

/// Plugin market manager
pub struct PluginMarket {
	/// Cache for market listings
	cache: MarketCache,
	/// Marketplace registry for reading local clone
	registry: MarketplaceRegistry,
}

/// Market plugin information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketPlugin {
	pub id: String,
	pub name: String,
	pub description: String,
	pub version: String,
	pub author: String,
	pub github_url: String,
	pub installs: u64,
	pub installed: bool,
	pub enabled: Option<bool>,
}

/// Local marketplace registry
pub struct MarketplaceRegistry {
	/// Path to the local marketplace clone
	marketplace_path: PathBuf,
	/// Subdirectories containing plugins (e.g., ["plugins/", "external_plugins/"])
	plugins_subdirs: Vec<String>,
}

impl MarketplaceRegistry {
	/// Create a new marketplace registry for the default official marketplace
	pub fn new_official() -> Result<Self> {
		let marketplace_path = dirs::home_dir()
			.ok_or_else(|| anyhow::anyhow!("Cannot find home directory"))?
			.join(".claude/plugins/marketplaces/claude-plugins-official");

		Ok(Self {
			marketplace_path,
			plugins_subdirs: vec![
				"plugins/".to_string(),
				"external_plugins/".to_string(),
			],
		})
	}

	/// Create with custom path and subdirectories
	pub fn new(
		marketplace_path: PathBuf,
		plugins_subdirs: Vec<String>,
	) -> Self {
		Self {
			marketplace_path,
			plugins_subdirs,
		}
	}

	/// Get the plugin directory (searches all subdirs)
	fn plugin_dir(&self, name: &str) -> Option<PathBuf> {
		for subdir in &self.plugins_subdirs {
			let path = self.marketplace_path.join(subdir).join(name);
			if path.exists() {
				return Some(path);
			}
		}
		None
	}

	/// Find plugin.json in various locations (Claude CLI compatible)
	fn find_manifest_path(plugin_dir: &std::path::Path) -> Option<PathBuf> {
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

	/// Check if marketplace is cloned locally
	pub fn is_available(&self) -> bool {
		self.marketplace_path.exists()
	}

	/// Clone the marketplace from GitHub
	pub async fn clone(&self) -> Result<()> {
		use tokio::process::Command;

		let parent_dir = self
			.marketplace_path
			.parent()
			.ok_or_else(|| anyhow::anyhow!("Invalid marketplace path"))?;

		std::fs::create_dir_all(parent_dir)?;

		log::info!("Cloning marketplace from GitHub...");

		let output = Command::new("git")
			.args([
				"clone",
				"--depth",
				"1",
				"https://github.com/anthropics/claude-plugins-official.git",
			])
			.arg(&self.marketplace_path)
			.output()
			.await
			.context("Failed to execute git clone")?;

		if !output.status.success() {
			let stderr = String::from_utf8_lossy(&output.stderr);
			anyhow::bail!("Git clone failed: {}", stderr);
		}

		log::info!("Marketplace cloned successfully");
		Ok(())
	}

	/// Update the marketplace by pulling latest changes
	pub async fn update(&self) -> Result<()> {
		use tokio::process::Command;

		if !self.marketplace_path.exists() {
			return self.clone().await;
		}

		log::info!("Updating marketplace...");

		let output = Command::new("git")
			.args(["pull", "--depth", "1"])
			.current_dir(&self.marketplace_path)
			.output()
			.await
			.context("Failed to execute git pull")?;

		if !output.status.success() {
			let stderr = String::from_utf8_lossy(&output.stderr);
			// Don't fail on "already up to date" or other non-errors
			log::warn!("Git pull output: {}", stderr);
		}

		log::info!("Marketplace updated");
		Ok(())
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

	/// Read plugin manifest
	pub fn read_manifest(
		&self,
		name: &str,
	) -> Result<Option<PluginManifestFromFile>> {
		let plugin_dir = match self.plugin_dir(name) {
			Some(p) => p,
			None => return Ok(None),
		};

		let manifest_path = match Self::find_manifest_path(&plugin_dir) {
			Some(p) => p,
			None => return Ok(None),
		};

		let content = std::fs::read_to_string(&manifest_path)?;
		let manifest: PluginManifestFromFile = serde_json::from_str(&content)?;

		Ok(Some(manifest))
	}

	/// Get current git commit SHA
	pub fn get_commit(&self) -> Result<Option<String>> {
		use std::process::Command;

		let output = Command::new("git")
			.args(["rev-parse", "HEAD"])
			.current_dir(&self.marketplace_path)
			.output()
			.context("Failed to get git commit")?;

		if output.status.success() {
			let commit =
				String::from_utf8_lossy(&output.stdout).trim().to_string();
			return Ok(Some(commit));
		}

		Ok(None)
	}
}

/// Plugin manifest structure from file
#[derive(Debug, Deserialize)]
pub struct PluginManifestFromFile {
	pub name: String,
	pub version: Option<String>,
	pub description: String,
	pub author: PluginAuthor,
	pub homepage: Option<String>,
	pub repository: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PluginAuthor {
	pub name: String,
	pub email: Option<String>,
}

impl PluginMarket {
	/// Create a new market manager
	pub fn new() -> Result<Self> {
		let cache = MarketCache::load()?;
		let registry = MarketplaceRegistry::new_official()?;

		Ok(Self { cache, registry })
	}

	/// List available plugins (with caching)
	pub async fn list_plugins(
		&mut self,
		mut force_refresh: bool,
	) -> Result<Vec<MarketPlugin>> {
		// Check if marketplace is available, clone if not
		if !self.registry.is_available() {
			log::info!("Marketplace not found, cloning...");
			self.registry.clone().await?;
			force_refresh = true; // Force refresh after clone
		}

		// Check if we can use cache
		if !force_refresh
			&& self.cache.is_valid()
			&& !self.cache.list().is_empty()
		{
			log::info!("Using cached plugin market data");
			return self.build_market_list().await;
		}

		// Refresh from local marketplace
		log::info!("Refreshing plugin list from local marketplace");
		self.registry.update().await?;
		self.refresh_from_marketplace().await?;

		self.build_market_list().await
	}

	/// Force refresh the cache
	pub async fn refresh(&mut self) -> Result<Vec<MarketPlugin>> {
		self.list_plugins(true).await
	}

	/// Refresh cache from local marketplace
	async fn refresh_from_marketplace(&mut self) -> Result<()> {
		let plugins = self.registry.list_plugins()?;

		log::info!("Found {} plugins in local marketplace", plugins.len());

		// Clear old cache
		self.cache.clear();

		// Get commit for version info
		let commit = self.registry.get_commit().ok().flatten();

		// Read each plugin manifest
		for (name, _path) in plugins {
			match self.registry.read_manifest(&name) {
				Ok(Some(manifest)) => {
					let github_url = format!(
                        "https://github.com/anthropics/claude-plugins-official/tree/main/plugins/{}",
                        name
                    );

					let cached = CachedPlugin {
						id: format!("{}@{}", name, DEFAULT_MARKETPLACE),
						name: manifest.name,
						description: manifest.description,
						version: manifest
							.version
							.unwrap_or_else(|| "latest".to_string()),
						author: manifest.author.name,
						github_url: manifest.repository.unwrap_or(github_url),
						installs: 0,
						last_commit: commit.clone(),
						last_commit_date: None,
						etag: None,
					};

					self.cache.insert(cached);
				}
				Ok(None) => {
					log::warn!("No manifest found for plugin: {}", name);
				}
				Err(e) => {
					log::warn!("Failed to read manifest for {}: {}", name, e);
				}
			}
		}

		self.cache.touch();
		self.cache.save()?;

		log::info!(
			"Marketplace cache refreshed with {} plugins",
			self.cache.list().len()
		);
		Ok(())
	}

	/// Build market plugin list with install status
	async fn build_market_list(&self) -> Result<Vec<MarketPlugin>> {
		// Get installed plugins for status checking
		let installed_plugins = ClaudePluginManager::new()
			.ok()
			.map(|m| {
				m.list_plugins()
					.iter()
					.map(|p| (p.id.to_string(), p.enabled))
					.collect::<std::collections::HashMap<_, _>>()
			})
			.unwrap_or_default();

		let mut plugins: Vec<MarketPlugin> = self
			.cache
			.list()
			.into_iter()
			.map(|cached| {
				let installed = installed_plugins.contains_key(&cached.id);
				let enabled = installed_plugins.get(&cached.id).copied();

				MarketPlugin {
					id: cached.id.clone(),
					name: cached.name.clone(),
					description: cached.description.clone(),
					version: cached.version.clone(),
					author: cached.author.clone(),
					github_url: cached.github_url.clone(),
					installs: cached.installs,
					installed,
					enabled,
				}
			})
			.collect();

		// Sort by name
		plugins.sort_by(|a, b| a.name.cmp(&b.name));

		Ok(plugins)
	}

	/// Set cache TTL
	pub fn set_cache_ttl(&mut self, seconds: u64) {
		self.cache.set_ttl(seconds);
	}

	/// Clear cache
	pub fn clear_cache(&mut self) -> Result<()> {
		self.cache.clear();
		self.cache.save()?;
		Ok(())
	}

	/// Get the marketplace registry (for advanced operations)
	pub fn registry(&self) -> &MarketplaceRegistry {
		&self.registry
	}
}

impl Default for PluginMarket {
	fn default() -> Self {
		Self::new().expect("Failed to create PluginMarket")
	}
}
