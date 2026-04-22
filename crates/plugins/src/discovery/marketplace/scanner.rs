use super::types::{MarketplaceConfig, MarketplacePlugin, MarketplaceSource};
use anyhow::Result;
use std::path::{Path, PathBuf};

/// Marketplace scanner
pub struct MarketplaceScanner {
	marketplace_path: PathBuf,
	config: Option<MarketplaceConfig>,
}

impl MarketplaceScanner {
	/// Create a scanner for a marketplace path
	pub fn new(marketplace_path: PathBuf) -> Self {
		Self {
			marketplace_path,
			config: None,
		}
	}

	/// Load marketplace.json from the marketplace directory
	pub async fn load(&mut self) -> Result<&MarketplaceConfig> {
		let manifest_path = self
			.marketplace_path
			.join(".claude-plugin")
			.join("marketplace.json");

		if !tokio::fs::try_exists(&manifest_path).await.unwrap_or(false) {
			anyhow::bail!(
				"Marketplace manifest not found: {}",
				manifest_path.display()
			);
		}

		let content = tokio::fs::read_to_string(&manifest_path).await?;
		let config: MarketplaceConfig = serde_json::from_str(&content)?;

		self.config = Some(config);
		Ok(self.config.as_ref().unwrap())
	}

	/// Get the loaded config (must call load() first)
	pub fn config(&self) -> Option<&MarketplaceConfig> {
		self.config.as_ref()
	}

	/// Get marketplace name
	pub fn name(&self) -> Option<&str> {
		self.config.as_ref().map(|c| c.name.as_str())
	}

	/// Get all plugin definitions
	pub fn plugins(&self) -> Vec<&MarketplacePlugin> {
		self.config
			.as_ref()
			.map(|c| c.plugins.iter().collect())
			.unwrap_or_default()
	}

	/// Get plugin definition by name
	pub fn get_plugin(&self, name: &str) -> Option<&MarketplacePlugin> {
		self.config
			.as_ref()
			.and_then(|c| c.plugins.iter().find(|p| p.name == name))
	}

	/// Find plugin.json path for a local plugin
	pub async fn find_local_manifest(
		&self,
		plugin_name: &str,
	) -> Option<PathBuf> {
		let plugin = self.get_plugin(plugin_name)?;

		if let MarketplaceSource::Local(path) = &plugin.source {
			let full_path = self.marketplace_path.join(path);
			let possible_paths = [
				full_path.join(".claude-plugin/plugin.json"),
				full_path.join(".plugin/plugin.json"),
				full_path.join("plugin.json"),
			];

			for path in &possible_paths {
				if tokio::fs::try_exists(path).await.unwrap_or(false) {
					return Some(path.clone());
				}
			}
		}

		None
	}

	/// Get the local plugin directory path if it's a local source
	pub fn get_local_plugin_path(&self, plugin_name: &str) -> Option<PathBuf> {
		let plugin = self.get_plugin(plugin_name)?;

		if let MarketplaceSource::Local(path) = &plugin.source {
			Some(self.marketplace_path.join(path))
		} else {
			None
		}
	}
}

/// Scan all marketplaces in a directory
pub async fn scan_marketplaces(
	marketplaces_dir: &Path,
) -> Result<Vec<(String, MarketplaceConfig)>> {
	let mut results = Vec::new();

	if !tokio::fs::try_exists(marketplaces_dir)
		.await
		.unwrap_or(false)
	{
		log::warn!(
			"Marketplaces directory does not exist: {}",
			marketplaces_dir.display()
		);
		return Ok(results);
	}

	let mut entries = tokio::fs::read_dir(marketplaces_dir).await?;

	while let Some(entry) = entries.next_entry().await? {
		let path = entry.path();

		if !entry.file_type().await?.is_dir() {
			continue;
		}

		let manifest_path = path.join(".claude-plugin/marketplace.json");

		if tokio::fs::try_exists(&manifest_path).await.unwrap_or(false) {
			match tokio::fs::read_to_string(&manifest_path).await {
				Ok(content) => {
					match serde_json::from_str::<MarketplaceConfig>(&content) {
						Ok(config) => {
							let name = config.name.clone();
							results.push((name, config));
						}
						Err(e) => {
							log::warn!(
								"Failed to parse {}: {}",
								manifest_path.display(),
								e
							);
						}
					}
				}
				Err(e) => {
					log::warn!(
						"Failed to read {}: {}",
						manifest_path.display(),
						e
					);
				}
			}
		}
	}

	Ok(results)
}
