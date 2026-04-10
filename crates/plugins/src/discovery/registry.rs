//! Unified Plugin Registry implementation
//!
//! Merges data from three layers:
//! - L1: Local installed plugins
//! - L2: Marketplace definitions (marketplace.json)
//! - L3: Remote install statistics

use crate::claude::types::PluginManifest as ClaudePluginManifest;
use crate::claude::ClaudePluginManager;
use crate::discovery::marketplace::{scan_marketplaces, SourceDef};
use crate::discovery::{
	DiscoveryConfig, InstallCountsCache, PluginAuthor, PluginInfo, PluginSource,
};
use anyhow::Result;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

struct LocalPluginMetadata {
	version: Option<String>,
	author: Option<PluginAuthor>,
	homepage: Option<String>,
	repository: Option<String>,
	keywords: Vec<String>,
	has_mcp: bool,
	has_skills: bool,
	has_hooks: bool,
}

/// Unified plugin registry combining all data sources
pub struct UnifiedPluginRegistry {
	/// All discovered plugins by ID
	plugins: HashMap<String, PluginInfo>,
	/// Install counts from remote cache
	install_counts: HashMap<String, u64>,
	/// Configuration
	config: DiscoveryConfig,
}

impl UnifiedPluginRegistry {
	/// Async initialization
	pub async fn new_async(config: &DiscoveryConfig) -> Result<Self> {
		let mut registry = Self {
			plugins: HashMap::new(),
			install_counts: HashMap::new(),
			config: config.clone(),
		};

		// Load install counts (L3)
		registry.load_install_counts().await?;

		// Scan marketplaces (L2)
		registry.scan_marketplaces().await?;

		// Scan local installations (L1)
		registry.scan_local_installs().await?;

		log::info!(
			"UnifiedPluginRegistry initialized with {} plugins",
			registry.plugins.len()
		);

		Ok(registry)
	}

	/// Load install counts from cache
	async fn load_install_counts(&mut self) -> Result<()> {
		let path = self.config.install_counts_path();

		if !path.exists() {
			log::debug!("Install counts cache not found at {}", path.display());
			return Ok(());
		}

		let content = tokio::fs::read_to_string(&path).await?;

		// Try to parse as the cache format
		if let Ok(cache) = serde_json::from_str::<InstallCountsCache>(&content)
		{
			for entry in cache.counts {
				self.install_counts
					.insert(entry.plugin, entry.unique_installs);
			}
			log::debug!("Loaded {} install counts", self.install_counts.len());
		} else {
			log::warn!("Failed to parse install counts cache");
		}

		Ok(())
	}

	/// Scan all marketplaces
	async fn scan_marketplaces(&mut self) -> Result<()> {
		let marketplaces_dir = self
			.config
			.plugins_dir
			.join(&self.config.marketplaces_subdir);

		if !marketplaces_dir.exists() {
			log::warn!(
				"Marketplaces directory not found: {}",
				marketplaces_dir.display()
			);
			return Ok(());
		}

		// Scan all marketplace directories
		let marketplace_configs = scan_marketplaces(&marketplaces_dir).await?;

		for (marketplace_name, config) in marketplace_configs {
			log::debug!(
				"Scanning marketplace '{}' with {} plugins",
				marketplace_name,
				config.plugins.len()
			);
			let owner_name = config.owner.name.clone();
			let owner_email = config.owner.email.clone();

			for plugin_def in config.plugins {
				let plugin_id =
					format!("{}@{}", plugin_def.name, marketplace_name);

				// Parse source
				let source_def = SourceDef::from(&plugin_def.source);
				let source = PluginSource::from_marketplace_def(&source_def);

				// Extract git SHA if available
				let git_sha = match &source_def {
					SourceDef::GitHub { sha, .. } => sha.clone(),
					SourceDef::Url { sha, .. } => sha.clone(),
					SourceDef::GitSubdir { sha, .. } => sha.clone(),
					_ => None,
				};

				// Get install count
				let install_count =
					self.install_counts.get(&plugin_id).copied();

				// Convert author
				let author = plugin_def
					.author
					.map(|author| PluginAuthor {
						name: author.name,
						email: author.email,
					})
					.or_else(|| {
						Some(PluginAuthor {
							name: owner_name.clone(),
							email: owner_email.clone(),
						})
					});

				// Create plugin info
				let plugin_info = PluginInfo {
					id: plugin_id.clone(),
					name: plugin_def.name.clone(),
					description: plugin_def.description,
					version: plugin_def.version,
					author,
					category: plugin_def.category.clone(),
					source,
					marketplace: marketplace_name.clone(),
					local_path: None, // Will be set by scan_local_installs
					installed: false, // Will be updated by scan_local_installs
					enabled: None,    // Will be updated by scan_local_installs
					install_count,
					homepage: plugin_def.homepage.clone(),
					repository: None, // Will be derived from source
					keywords: Vec::new(),
					git_sha,
					has_mcp: false,
					has_skills: false,
					has_hooks: false,
				};

				// Check if local plugin exists
				if let Some(local_path) = Self::find_local_plugin_path(
					&marketplaces_dir,
					&marketplace_name,
					&plugin_def.name,
					&plugin_def.source,
				) {
					if tokio::fs::try_exists(&local_path).await.unwrap_or(false)
					{
						let mut info = plugin_info;
						info.local_path = Some(local_path.clone());

						if let Some(metadata) =
							Self::extract_local_metadata(&local_path).await
						{
							if info.version.is_none() {
								info.version = metadata.version;
							}
							if info.author.is_none() {
								info.author = metadata.author;
							}
							if info.homepage.is_none() {
								info.homepage = metadata.homepage;
							}
							if info.repository.is_none() {
								info.repository = metadata.repository;
							}
							if info.keywords.is_empty() {
								info.keywords = metadata.keywords;
							}
							info.has_mcp = metadata.has_mcp;
							info.has_skills = metadata.has_skills;
							info.has_hooks = metadata.has_hooks;
						}

						self.plugins.insert(plugin_id, info);
					} else {
						self.plugins.insert(plugin_id, plugin_info);
					}
				} else {
					self.plugins.insert(plugin_id, plugin_info);
				}
			}
		}

		Ok(())
	}

	/// Find local plugin path for a marketplace plugin
	fn find_local_plugin_path(
		marketplaces_dir: &std::path::Path,
		marketplace_name: &str,
		_plugin_name: &str,
		source: &crate::discovery::marketplace::MarketplaceSource,
	) -> Option<PathBuf> {
		match source {
			crate::discovery::marketplace::MarketplaceSource::Local(path) => {
				let marketplace_path = marketplaces_dir.join(marketplace_name);
				Some(marketplace_path.join(path.trim_start_matches("./")))
			}
			_ => None,
		}
	}

	async fn find_manifest_path(plugin_dir: &Path) -> Option<PathBuf> {
		let possible_paths = [
			plugin_dir.join(".claude-plugin/plugin.json"),
			plugin_dir.join(".plugin/plugin.json"),
			plugin_dir.join("plugin.json"),
		];

		for path in &possible_paths {
			if tokio::fs::try_exists(path).await.ok()? {
				return Some(path.clone());
			}
		}

		None
	}

	/// Read local manifest metadata if plugin.json exists
	async fn extract_local_metadata(
		plugin_dir: &Path,
	) -> Option<LocalPluginMetadata> {
		let manifest_path = Self::find_manifest_path(plugin_dir).await?;
		let content = tokio::fs::read_to_string(manifest_path).await.ok()?;
		let json = serde_json::from_str::<serde_json::Value>(&content).ok()?;
		let manifest =
			serde_json::from_str::<ClaudePluginManifest>(&content).ok();
		let has_hooks = tokio::fs::try_exists(plugin_dir.join("hooks"))
			.await
			.unwrap_or(false)
			|| tokio::fs::try_exists(plugin_dir.join("hooks.json"))
				.await
				.unwrap_or(false);

		Some(LocalPluginMetadata {
			version: manifest.as_ref().and_then(|m| m.version.clone()),
			author: manifest.as_ref().and_then(|manifest| {
				(!manifest.author.is_empty()).then_some(PluginAuthor {
					name: manifest.author.name.clone(),
					email: manifest.author.email.clone(),
				})
			}),
			homepage: manifest.as_ref().and_then(|m| m.homepage.clone()),
			repository: manifest.as_ref().and_then(|m| m.repository.clone()),
			keywords: manifest.and_then(|m| m.keywords).unwrap_or_default(),
			has_mcp: json.get("mcpServers").is_some()
				|| json.get("mcp_servers").is_some(),
			has_skills: json.get("skills").is_some()
				&& !json["skills"].is_null(),
			has_hooks: json.get("hooks").is_some() || has_hooks,
		})
	}

	/// Scan locally installed plugins
	async fn scan_local_installs(&mut self) -> Result<()> {
		// Use ClaudePluginManager to get installed plugins
		match ClaudePluginManager::new_with_plugins_dir(
			&self.config.plugins_dir,
		) {
			Ok(manager) => {
				let installed = manager.list_plugins();
				log::debug!("Found {} installed plugins", installed.len());

				for plugin in installed {
					let plugin_id = plugin.id.to_string();

					// Parse the ID to get name and marketplace
					let parts: Vec<&str> = plugin_id.split('@').collect();
					let (name, marketplace) = if parts.len() == 2 {
						(parts[0].to_string(), parts[1].to_string())
					} else {
						(plugin_id.clone(), "unknown".to_string())
					};

					// Check if we already have this plugin from marketplace scan
					if let Some(existing) = self.plugins.get_mut(&plugin_id) {
						// Update existing entry with local info
						existing.installed = true;
						existing.enabled = Some(plugin.enabled);
						existing.local_path = Some(plugin.install_path.clone());
						existing.has_mcp = existing.has_mcp || plugin.has_mcp();
						existing.has_skills =
							existing.has_skills || plugin.has_skills();
						existing.has_hooks =
							existing.has_hooks || plugin.has_hooks();
						// Use version from manifest if available
						if existing.version.is_none()
							&& !plugin.version.is_empty()
						{
							existing.version = Some(plugin.version.clone());
						}
					} else {
						// Plugin not found in any marketplace, add it
						let install_count =
							self.install_counts.get(&plugin_id).copied();

						let plugin_info = PluginInfo {
							id: plugin_id.clone(),
							name: name.clone(),
							description: String::new(), // Unknown
							version: if plugin.version.is_empty() {
								None
							} else {
								Some(plugin.version.clone())
							},
							author: None,
							category: None,
							source: PluginSource::LocalRelative {
								path: plugin
									.install_path
									.to_string_lossy()
									.to_string(),
							},
							marketplace,
							local_path: Some(plugin.install_path.clone()),
							installed: true,
							enabled: Some(plugin.enabled),
							install_count,
							homepage: None,
							repository: None,
							keywords: Vec::new(),
							git_sha: if plugin.commit_hash.is_empty() {
								None
							} else {
								Some(plugin.commit_hash.clone())
							},
							has_mcp: plugin.has_mcp(),
							has_skills: plugin.has_skills(),
							has_hooks: plugin.has_hooks(),
						};

						self.plugins.insert(plugin_id, plugin_info);
					}
				}
			}
			Err(e) => {
				log::warn!("Failed to load installed plugins: {}", e);
			}
		}

		Ok(())
	}

	/// Get all plugins
	pub fn all_plugins(&self) -> Vec<&PluginInfo> {
		self.plugins.values().collect()
	}

	/// Get plugin by ID
	pub fn get_plugin(&self, id: &str) -> Option<&PluginInfo> {
		self.plugins.get(id)
	}

	/// Get mutable plugin by ID
	pub fn get_plugin_mut(&mut self, id: &str) -> Option<&mut PluginInfo> {
		self.plugins.get_mut(id)
	}

	/// Get plugins sorted by install count
	pub fn top_plugins(&self, limit: usize) -> Vec<&PluginInfo> {
		let mut plugins: Vec<&PluginInfo> = self.plugins.values().collect();
		plugins.sort_by(|a, b| {
			let a_count = a.install_count.unwrap_or(0);
			let b_count = b.install_count.unwrap_or(0);
			b_count.cmp(&a_count) // Descending
		});
		plugins.into_iter().take(limit).collect()
	}

	/// Get total plugin count
	pub fn count(&self) -> usize {
		self.plugins.len()
	}

	/// Get installed plugin count
	pub fn installed_count(&self) -> usize {
		self.plugins.values().filter(|p| p.installed).count()
	}

	/// Get install count for a plugin
	pub fn get_install_count(&self, plugin_id: &str) -> Option<u64> {
		self.install_counts.get(plugin_id).copied()
	}

	/// Refresh the registry
	pub async fn refresh(&mut self) -> Result<()> {
		self.plugins.clear();
		self.install_counts.clear();
		self.load_install_counts().await?;
		self.scan_marketplaces().await?;
		self.scan_local_installs().await?;
		Ok(())
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::fs;
	use tempfile::tempdir;

	#[test]
	fn test_registry_with_existing_plugins_dir() {
		let temp_dir = tempdir().unwrap();
		let plugins_dir = temp_dir.path().join("plugins");
		fs::create_dir_all(plugins_dir.join("marketplaces")).unwrap();

		let config = DiscoveryConfig {
			plugins_dir,
			marketplaces_subdir: "marketplaces".to_string(),
			known_marketplaces: vec!["claude-plugins-official".to_string()],
		};

		let rt = tokio::runtime::Builder::new_current_thread()
			.enable_all()
			.build()
			.unwrap();

		rt.block_on(async {
			let registry = UnifiedPluginRegistry::new_async(&config).await;
			assert!(registry.is_ok());
			let registry = registry.unwrap();
			assert_eq!(registry.count(), 0);
			assert_eq!(registry.installed_count(), 0);
		});
	}

	#[tokio::test]
	async fn extract_local_metadata_reads_manifest_fields() {
		let temp_dir = tempdir().unwrap();
		let plugin_dir = temp_dir.path().join("superpowers");
		fs::create_dir_all(plugin_dir.join(".claude-plugin")).unwrap();
		fs::write(
			plugin_dir.join(".claude-plugin/plugin.json"),
			r#"{
				"name":"superpowers",
				"version":"5.0.7",
				"description":"test plugin",
				"author":{"name":"Anthropic","email":"team@example.com"},
				"homepage":"https://example.com",
				"repository":"https://github.com/example/superpowers",
				"keywords":["testing","debugging"],
				"skills":"skills",
				"mcpServers":{"docs":{"command":"node"}}
			}"#,
		)
		.unwrap();

		let metadata =
			UnifiedPluginRegistry::extract_local_metadata(&plugin_dir)
				.await
				.unwrap();

		assert_eq!(metadata.version.as_deref(), Some("5.0.7"));
		assert_eq!(
			metadata.author.as_ref().map(|author| author.name.as_str()),
			Some("Anthropic")
		);
		assert_eq!(metadata.homepage.as_deref(), Some("https://example.com"));
		assert_eq!(
			metadata.repository.as_deref(),
			Some("https://github.com/example/superpowers")
		);
		assert_eq!(metadata.keywords, vec!["testing", "debugging"]);
		assert!(metadata.has_skills);
		assert!(metadata.has_mcp);
		assert!(!metadata.has_hooks);
	}
}
