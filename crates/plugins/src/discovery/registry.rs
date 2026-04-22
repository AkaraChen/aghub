//! Unified Plugin Registry implementation
//!
//! Merges data from three layers:
//! - L1: Local installed plugins
//! - L2: Marketplace definitions (marketplace.json)
//! - L3: Remote install statistics

mod counts;
mod local;
mod marketplaces;

use crate::discovery::{DiscoveryConfig, PluginAuthor, PluginInfo};
use anyhow::Result;
use std::collections::HashMap;

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

		registry.load_install_counts().await?;
		registry.scan_marketplaces().await?;
		registry.scan_local_installs().await?;

		log::info!(
			"UnifiedPluginRegistry initialized with {} plugins",
			registry.plugins.len()
		);

		Ok(registry)
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
			b_count.cmp(&a_count)
		});
		plugins.into_iter().take(limit).collect()
	}

	/// Get total plugin count
	pub fn count(&self) -> usize {
		self.plugins.len()
	}

	/// Get installed plugin count
	pub fn installed_count(&self) -> usize {
		self.plugins
			.values()
			.filter(|plugin| plugin.installed)
			.count()
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
