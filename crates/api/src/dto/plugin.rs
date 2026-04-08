use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginScopeResponse {
	pub scope: String,
	pub install_path: String,
	pub version: String,
	pub installed_at: String,
	pub last_updated: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginResponse {
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
	#[ts(optional)]
	pub author: Option<CCPluginAuthorResponse>,
	#[ts(optional)]
	pub repository: Option<String>,
	#[ts(optional)]
	pub license: Option<String>,
	#[ts(optional)]
	pub keywords: Option<Vec<String>>,
	/// All scopes where this plugin is installed
	pub scopes: Vec<CCPluginScopeResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginListResponse {
	pub plugins: Vec<CCPluginResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginInstallRequest {
	pub plugin_id: String,
	#[serde(default = "default_scope")]
	pub scope: String,
}

fn default_scope() -> String {
	"user".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginInstallResponse {
	pub success: bool,
	pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginUninstallRequest {
	pub plugin_id: String,
	#[serde(default = "default_scope")]
	pub scope: String,
	#[serde(default)]
	pub keep_data: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginUninstallResponse {
	pub success: bool,
	pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginUpdateRequest {
	pub plugin_id: String,
	#[serde(default = "default_scope")]
	pub scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginUpdateResponse {
	pub success: bool,
	pub message: String,
}

/// Plugin manifest (detailed plugin info)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginManifestResponse {
	pub name: String,
	#[ts(optional)]
	pub version: Option<String>,
	pub description: String,
	#[ts(optional)]
	pub author: Option<CCPluginAuthorResponse>,
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
	pub skills: Option<Vec<String>>,
	#[ts(optional)]
	pub agents: Option<Vec<String>>,
	#[ts(optional)]
	pub commands: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginAuthorResponse {
	pub name: String,
	#[ts(optional)]
	pub email: Option<String>,
	#[ts(optional)]
	pub url: Option<String>,
}

/// Hooks configuration
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginHooksManifestResponse {
	pub hooks: Vec<CCPluginHookEventResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginHookEventResponse {
	pub event: String,
	pub matchers: Vec<CCPluginHookMatcherResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginHookMatcherResponse {
	#[ts(optional)]
	pub matcher: Option<String>,
	pub hooks: Vec<CCPluginHookActionResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginHookActionResponse {
	pub action_type: String,
	#[ts(optional)]
	pub command: Option<String>,
	#[ts(optional)]
	pub timeout: Option<u32>,
}

/// MCP Server configuration
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
pub struct CCPluginDetailResponse {
	#[ts(flatten)]
	#[serde(flatten)]
	pub plugin: CCPluginResponse,
	#[ts(optional)]
	pub manifest: Option<CCPluginManifestResponse>,
	#[ts(optional)]
	pub hooks: Option<CCPluginHooksManifestResponse>,
	#[ts(optional)]
	pub mcp_config: Option<CCPluginMcpConfigResponse>,
	pub update_available: bool,
	#[ts(optional)]
	pub latest_version: Option<String>,
	pub provided_skills: Vec<CCPluginSkillInfo>,
}

/// Skill discovered from a plugin directory
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginSkillInfo {
	pub name: String,
	#[ts(optional)]
	pub description: Option<String>,
}

/// Check for updates request/response
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginCheckUpdateRequest {
	pub plugin_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginCheckUpdateResponse {
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
pub struct CCPluginReinstallRequest {
	pub plugin_id: String,
	#[serde(default = "default_scope")]
	pub scope: String,
	#[serde(default)]
	pub keep_data: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginReinstallResponse {
	pub success: bool,
	pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginConfigResponse {
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
pub struct CCPluginUpdateConfigRequest {
	pub plugin_id: String,
	/// Config as JSON string (must be a valid JSON object)
	pub config: String,
}

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
	#[ts(optional)]
	pub enabled: Option<bool>,
	#[ts(optional)]
	pub category: Option<String>,
	pub has_mcp: bool,
	pub has_skills: bool,
	pub has_hooks: bool,
}
