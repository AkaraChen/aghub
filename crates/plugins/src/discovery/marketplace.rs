//! Marketplace scanner for reading marketplace.json definitions

use anyhow::Result;
use serde::Deserialize;
use std::path::{Path, PathBuf};

/// Marketplace configuration from marketplace.json
#[derive(Debug, Deserialize)]
pub struct MarketplaceConfig {
	#[serde(rename = "$schema")]
	pub schema: Option<String>,
	pub name: String,
	pub description: String,
	pub owner: MarketplaceOwner,
	pub plugins: Vec<MarketplacePlugin>,
}

#[derive(Debug, Deserialize)]
pub struct MarketplaceOwner {
	pub name: String,
	pub email: Option<String>,
}

/// Plugin definition in marketplace.json
#[derive(Debug, Deserialize)]
pub struct MarketplacePlugin {
	pub name: String,
	pub description: String,
	#[serde(default)]
	pub version: Option<String>,
	pub author: Option<MarketplaceAuthor>,
	pub source: MarketplaceSource,
	#[serde(default)]
	pub category: Option<String>,
	#[serde(default)]
	pub homepage: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct MarketplaceAuthor {
	pub name: String,
	pub email: Option<String>,
}

/// Source definition in marketplace.json
/// This uses a tagged enum structure based on the "source" field
#[derive(Debug, Deserialize, Clone)]
#[serde(untagged)]
pub enum MarketplaceSource {
	/// Simple string path like "./plugins/xxx"
	Local(String),
	/// Object with source type
	#[serde(rename_all = "kebab-case")]
	GitHub {
		source: String,
		repo: String,
		#[serde(rename = "ref")]
		git_ref: Option<String>,
		sha: Option<String>,
	},
	#[serde(rename_all = "kebab-case")]
	Url {
		source: String,
		url: String,
		sha: Option<String>,
	},
	#[serde(rename_all = "kebab-case")]
	GitSubdir {
		source: String,
		url: String,
		path: String,
		#[serde(rename = "ref")]
		git_ref: Option<String>,
		sha: Option<String>,
	},
	#[serde(rename_all = "kebab-case")]
	Npm {
		source: String,
		package: String,
		version: Option<String>,
		registry: Option<String>,
	},
}

/// Plugin source type enum
#[derive(Debug, Clone)]
pub enum SourceDef {
	Local(String),
	GitHub {
		repo: String,
		git_ref: Option<String>,
		sha: Option<String>,
	},
	Url {
		url: String,
		sha: Option<String>,
	},
	GitSubdir {
		url: String,
		path: String,
		git_ref: Option<String>,
		sha: Option<String>,
	},
	Npm {
		package: String,
		version: Option<String>,
		registry: Option<String>,
	},
}

impl From<&MarketplaceSource> for SourceDef {
	fn from(source: &MarketplaceSource) -> Self {
		match source {
			MarketplaceSource::Local(path) => SourceDef::Local(path.clone()),
			MarketplaceSource::GitHub {
				repo, git_ref, sha, ..
			} => SourceDef::GitHub {
				repo: repo.clone(),
				git_ref: git_ref.clone(),
				sha: sha.clone(),
			},
			MarketplaceSource::Url { url, sha, .. } => SourceDef::Url {
				url: url.clone(),
				sha: sha.clone(),
			},
			MarketplaceSource::GitSubdir {
				url,
				path,
				git_ref,
				sha,
				..
			} => SourceDef::GitSubdir {
				url: url.clone(),
				path: path.clone(),
				git_ref: git_ref.clone(),
				sha: sha.clone(),
			},
			MarketplaceSource::Npm {
				package,
				version,
				registry,
				..
			} => SourceDef::Npm {
				package: package.clone(),
				version: version.clone(),
				registry: registry.clone(),
			},
		}
	}
}

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

		if !manifest_path.exists() {
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

			// Try multiple manifest locations
			let possible_paths = [
				full_path.join(".claude-plugin/plugin.json"),
				full_path.join(".plugin/plugin.json"),
				full_path.join("plugin.json"),
			];

			for path in &possible_paths {
				if path.exists() {
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

	if !marketplaces_dir.exists() {
		log::warn!(
			"Marketplaces directory does not exist: {}",
			marketplaces_dir.display()
		);
		return Ok(results);
	}

	let mut entries = tokio::fs::read_dir(marketplaces_dir).await?;

	while let Some(entry) = entries.next_entry().await? {
		let path = entry.path();

		if !path.is_dir() {
			continue;
		}

		let manifest_path = path.join(".claude-plugin/marketplace.json");

		if manifest_path.exists() {
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

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_marketplace_config_parsing() {
		let json = r#"{
            "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
            "name": "test-marketplace",
            "description": "Test marketplace",
            "owner": { "name": "Test" },
            "plugins": [
                {
                    "name": "local-plugin",
                    "description": "A local plugin",
                    "source": "./plugins/local-plugin"
                },
                {
                    "name": "github-plugin",
                    "description": "A GitHub plugin",
                    "source": { "source": "github", "repo": "owner/repo" }
                },
                {
                    "name": "url-plugin",
                    "description": "A URL plugin",
                    "source": { "source": "url", "url": "https://example.com/repo.git" }
                }
            ]
        }"#;

		let config: MarketplaceConfig = serde_json::from_str(json).unwrap();
		assert_eq!(config.name, "test-marketplace");
		assert_eq!(config.plugins.len(), 3);
	}
}
