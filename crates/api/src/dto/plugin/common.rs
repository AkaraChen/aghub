use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginScopeResponse {
	pub scope: String,
	/// Installed folder path for this specific scope entry
	pub folder_path: String,
	pub version: String,
	/// Timestamp when this scope entry was first installed
	pub installed_at: String,
	/// Timestamp when this scope entry was last updated
	pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginAuthorResponse {
	pub name: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub email: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginSourceInfoResponse {
	pub label: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub url: Option<String>,
	pub is_github: bool,
	pub can_reinstall: bool,
	pub can_check_updates: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginResponse {
	pub id: String,
	pub name: String,
	/// Display version derived from the default display scope installation.
	pub version: String,
	/// Scope that provides the top-level display version and default selection.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub display_scope: Option<String>,
	pub description: Option<String>,
	pub enabled: bool,
	pub source: String,
	pub has_skills: bool,
	pub has_hooks: bool,
	pub has_mcp: bool,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub author: Option<CCPluginAuthorResponse>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub repository: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub license: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub keywords: Option<Vec<String>>,
	pub source_info: CCPluginSourceInfoResponse,
	/// All scopes where this plugin is installed
	pub scopes: Vec<CCPluginScopeResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginConfigResponse {
	pub plugin_id: String,
	/// Config as JSON string (use serde_json to parse)
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub config: Option<String>,
	/// Schema as JSON string (use serde_json to parse)
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub schema: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginMcpConfigResponse {
	pub servers: Vec<CCPluginMcpServerResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginMcpServerResponse {
	pub name: String,
	pub transport_type: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub command: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub args: Option<Vec<String>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub url: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub env: Option<std::collections::BTreeMap<String, String>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub headers: Option<std::collections::BTreeMap<String, String>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub note: Option<String>,
}

/// Skill discovered from a plugin directory
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginSkillInfo {
	pub name: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub description: Option<String>,
}
