use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginResponse {
	pub id: String,
	pub name: String,
	pub version: String,
	pub description: Option<String>,
	pub enabled: bool,
	pub source: String,
	pub install_path: String,
	pub has_skills: bool,
	pub has_hooks: bool,
	pub has_mcp: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginListResponse {
	pub plugins: Vec<PluginResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnablePluginRequest {
	pub plugin_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisablePluginRequest {
	pub plugin_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InstallPluginRequest {
	pub plugin_id: String,
	#[serde(default = "default_scope")]
	pub scope: String,
}

fn default_scope() -> String {
	"user".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InstallPluginResponse {
	pub success: bool,
	pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UninstallPluginRequest {
	pub plugin_id: String,
	#[serde(default = "default_scope")]
	pub scope: String,
	#[serde(default)]
	pub keep_data: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UninstallPluginResponse {
	pub success: bool,
	pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdatePluginRequest {
	pub plugin_id: String,
	#[serde(default = "default_scope")]
	pub scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdatePluginResponse {
	pub success: bool,
	pub message: String,
}

/// Plugin manifest (detailed plugin info)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginManifestResponse {
	pub name: String,
	#[ts(optional)]
	pub version: Option<String>,
	pub description: String,
	pub author: PluginAuthorResponse,
	#[ts(optional)]
	pub homepage: Option<String>,
	#[ts(optional)]
	pub repository: Option<String>,
	#[ts(optional)]
	pub license: Option<String>,
	#[ts(optional)]
	pub keywords: Option<Vec<String>>,
	#[ts(optional)]
	pub logo: Option<String>,
	#[ts(optional)]
	pub skills: Option<String>,
	#[ts(optional)]
	pub agents: Option<String>,
	#[ts(optional)]
	pub commands: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginAuthorResponse {
	pub name: String,
	#[ts(optional)]
	pub email: Option<String>,
	#[ts(optional)]
	pub url: Option<String>,
}

/// Hooks configuration
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HooksManifestResponse {
	pub hooks: Vec<HookEventResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HookEventResponse {
	pub event: String,
	pub matchers: Vec<HookMatcherResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HookMatcherResponse {
	#[ts(optional)]
	pub matcher: Option<String>,
	pub hooks: Vec<HookActionResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HookActionResponse {
	pub action_type: String,
	#[ts(optional)]
	pub command: Option<String>,
	#[ts(optional)]
	pub timeout: Option<u32>,
}

/// MCP Server configuration
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct McpConfigResponse {
	pub servers: Vec<McpServerResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct McpServerResponse {
	pub name: String,
	pub transport_type: String,
	#[ts(optional)]
	pub command: Option<String>,
	#[ts(optional)]
	pub args: Option<Vec<String>>,
	#[ts(optional)]
	pub url: Option<String>,
	#[ts(optional)]
	pub env: Option<std::collections::HashMap<String, String>>,
	#[ts(optional)]
	pub headers: Option<std::collections::HashMap<String, String>>,
	#[ts(optional)]
	pub note: Option<String>,
}

/// Plugin detail response (combined)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginDetailResponse {
	#[ts(flatten)]
	#[serde(flatten)]
	pub plugin: PluginResponse,
	#[ts(optional)]
	pub manifest: Option<PluginManifestResponse>,
	#[ts(optional)]
	pub hooks: Option<HooksManifestResponse>,
	#[ts(optional)]
	pub mcp_config: Option<McpConfigResponse>,
	pub update_available: bool,
	#[ts(optional)]
	pub latest_version: Option<String>,
	pub provided_skills: Vec<String>,
}

/// Check for updates request/response
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CheckUpdateRequest {
	pub plugin_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CheckUpdateResponse {
	pub plugin_id: String,
	pub update_available: bool,
	pub current_version: String,
	#[ts(optional)]
	pub latest_version: Option<String>,
	#[ts(optional)]
	pub changelog: Option<String>,
}

/// Reinstall plugin request/response
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ReinstallPluginRequest {
	pub plugin_id: String,
	#[serde(default = "default_scope")]
	pub scope: String,
	#[serde(default)]
	pub keep_data: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ReinstallPluginResponse {
	pub success: bool,
	pub message: String,
}

/// Plugin configuration request/response
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginConfigRequest {
	pub plugin_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginConfigResponse {
	pub plugin_id: String,
	/// Config as JSON string (use serde_json to parse)
	#[ts(optional)]
	pub config: Option<String>,
	/// Schema as JSON string (use serde_json to parse)
	#[ts(optional)]
	pub schema: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdatePluginConfigRequest {
	pub plugin_id: String,
	/// Config as JSON string (must be a valid JSON object)
	pub config: String,
}

/// Marketplace plugin item (from GitHub organization)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MarketPluginResponse {
	pub id: String,
	pub name: String,
	pub description: String,
	pub version: String,
	pub author: String,
	pub github_url: String,
	pub installs: i64,
	pub installed: bool,
	#[ts(optional)]
	pub enabled: Option<bool>,
}
