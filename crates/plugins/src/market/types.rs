use crate::claude::types::PluginAuthor;
use serde::{Deserialize, Serialize};

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

/// Plugin manifest structure from file
#[derive(Debug, Deserialize)]
pub struct PluginManifestFromFile {
	pub name: String,
	pub version: Option<String>,
	pub description: String,
	#[serde(default)]
	pub author: PluginAuthor,
	pub homepage: Option<String>,
	pub repository: Option<String>,
}
