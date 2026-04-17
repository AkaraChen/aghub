use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Marketplace plugin item (from GitHub organization)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginMarketResponse {
	pub id: String,
	pub name: String,
	pub description: String,
	pub version: String,
	pub author: String,
	pub github_url: String,
	pub installs: i64,
	pub installed: bool,
	pub installed_scopes: Vec<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub enabled: Option<bool>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub category: Option<String>,
	pub has_mcp: bool,
	pub has_skills: bool,
	pub has_hooks: bool,
}
