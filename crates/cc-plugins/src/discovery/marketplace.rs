//! Marketplace scanner for reading marketplace.json definitions

use anyhow::Result;
use serde::{Deserialize, Deserializer};
use std::collections::HashMap;
use std::path::Path;

// ── Types ──

#[derive(Debug, Deserialize)]
pub struct MarketplaceConfig {
	pub name: String,
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
	#[serde(default)]
	pub description: String,
	#[serde(default)]
	pub version: Option<String>,
	pub author: Option<MarketplaceAuthor>,
	pub source: MarketplaceSource,
	#[serde(default)]
	pub category: Option<String>,
	#[serde(default)]
	pub homepage: Option<String>,
	#[serde(default, flatten)]
	pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct MarketplaceAuthor {
	pub name: String,
	pub email: Option<String>,
}

/// Source definition in marketplace.json
/// This uses a tagged enum structure based on the "source" field
#[derive(Debug, Clone)]
pub enum MarketplaceSource {
	/// Simple string path like "./plugins/xxx"
	Local(String),
	/// Object with source type
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

impl<'de> Deserialize<'de> for MarketplaceSource {
	fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
	where
		D: Deserializer<'de>,
	{
		let value = serde_json::Value::deserialize(deserializer)?;

		match value {
			serde_json::Value::String(path) => Ok(Self::Local(path)),
			serde_json::Value::Object(mut map) => {
				let source: String = take_required_string(&mut map, "source")?;

				match source.as_str() {
					"github" => Ok(Self::GitHub {
						repo: take_required_string(&mut map, "repo")?,
						git_ref: take_optional_string(&mut map, "ref")?,
						sha: take_optional_string(&mut map, "sha")?,
					}),
					"url" => Ok(Self::Url {
						url: take_required_string(&mut map, "url")?,
						sha: take_optional_string(&mut map, "sha")?,
					}),
					"git-subdir" => Ok(Self::GitSubdir {
						url: take_required_string(&mut map, "url")?,
						path: take_required_string(&mut map, "path")?,
						git_ref: take_optional_string(&mut map, "ref")?,
						sha: take_optional_string(&mut map, "sha")?,
					}),
					"npm" => Ok(Self::Npm {
						package: take_required_string(&mut map, "package")?,
						version: take_optional_string(&mut map, "version")?,
						registry: take_optional_string(&mut map, "registry")?,
					}),
					other => Err(serde::de::Error::custom(format!(
						"Unsupported marketplace source type: {other}"
					))),
				}
			}
			_ => Err(serde::de::Error::custom(
				"Marketplace source must be a string path or object",
			)),
		}
	}
}

fn take_required_string<E>(
	map: &mut serde_json::Map<String, serde_json::Value>,
	key: &str,
) -> Result<String, E>
where
	E: serde::de::Error,
{
	match map.remove(key) {
		Some(serde_json::Value::String(value)) if !value.is_empty() => {
			Ok(value)
		}
		Some(_) => Err(E::custom(format!(
			"Marketplace source field '{key}' must be a string"
		))),
		None => Err(E::custom(format!(
			"Marketplace source field '{key}' is required"
		))),
	}
}

fn take_optional_string<E>(
	map: &mut serde_json::Map<String, serde_json::Value>,
	key: &str,
) -> Result<Option<String>, E>
where
	E: serde::de::Error,
{
	match map.remove(key) {
		Some(serde_json::Value::String(value)) => Ok(Some(value)),
		Some(serde_json::Value::Null) | None => Ok(None),
		Some(_) => Err(E::custom(format!(
			"Marketplace source field '{key}' must be a string"
		))),
	}
}

/// Scan all marketplaces in a directory
pub async fn scan_marketplaces(
	marketplaces_dir: &Path,
) -> Result<Vec<(String, MarketplaceConfig)>> {
	let mut results = Vec::new();

	match tokio::fs::try_exists(marketplaces_dir).await {
		Ok(true) => {}
		Ok(false) => {
			log::warn!(
				"Marketplaces directory does not exist: {}",
				marketplaces_dir.display()
			);
			return Ok(results);
		}
		Err(e) => {
			log::warn!(
				"Cannot check marketplaces directory at {}: {}",
				marketplaces_dir.display(),
				e
			);
			return Ok(results);
		}
	}

	let mut entries = tokio::fs::read_dir(marketplaces_dir).await?;

	while let Some(entry) = entries.next_entry().await? {
		let path = entry.path();

		if !entry.file_type().await?.is_dir() {
			continue;
		}

		let manifest_path = path.join(".claude-plugin/marketplace.json");

		let exists = match tokio::fs::try_exists(&manifest_path).await {
			Ok(v) => v,
			Err(e) => {
				log::warn!(
					"Cannot check manifest at {}: {}",
					manifest_path.display(),
					e
				);
				false
			}
		};
		if exists {
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
	use super::MarketplaceConfig;

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
