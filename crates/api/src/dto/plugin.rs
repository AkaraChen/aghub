use crate::dto::integrations::CodeEditorType;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ── Common ───────────────────────────────────────────────────────────────────

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
	pub version: String,
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
	pub scopes: Vec<CCPluginScopeResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginConfigResponse {
	pub plugin_id: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub config: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginSkillInfo {
	pub name: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub description: Option<String>,
}

// ── Detail ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginManifestResponse {
	pub name: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub version: Option<String>,
	pub description: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub author: Option<CCPluginAuthorResponse>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub homepage: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub repository: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub license: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub keywords: Option<Vec<String>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub logo: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub skills: Option<Vec<String>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub agents: Option<Vec<String>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub commands: Option<Vec<String>>,
}

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
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub matcher: Option<String>,
	pub hooks: Vec<CCPluginHookActionResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginHookActionResponse {
	pub action_type: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub command: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub timeout: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginDetailResponse {
	#[ts(flatten)]
	#[serde(flatten)]
	pub plugin: CCPluginResponse,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub manifest: Option<CCPluginManifestResponse>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub hooks: Option<CCPluginHooksManifestResponse>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub mcp_config: Option<CCPluginMcpConfigResponse>,
	pub provided_skills: Vec<CCPluginSkillInfo>,
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

fn default_scope() -> String {
	"global".to_string()
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
	/// Also remove auto-installed dependencies that are no longer needed.
	#[serde(default)]
	pub prune: bool,
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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginCheckUpdateRequest {
	pub plugin_id: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginCheckUpdateResponse {
	pub plugin_id: String,
	pub update_available: bool,
	pub current_version: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub latest_version: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub changelog: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginOpenSkillInEditorRequest {
	pub plugin_id: String,
	#[serde(default = "default_scope")]
	pub scope: String,
	pub skill_name: String,
	pub editor: CodeEditorType,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginUpdateConfigRequest {
	pub plugin_id: String,
	pub config: String,
}

// ── CLI status ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCPluginCliStatusResponse {
	pub installed: bool,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub version: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub path: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub error: Option<String>,
}

// ── Marketplace ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum CCMarketplaceSourceResponse {
	Github { repo: String },
	Url { url: String },
	Local { path: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCMarketplaceEntryResponse {
	pub name: String,
	pub source: CCMarketplaceSourceResponse,
	pub install_location: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCMarketplaceListResponse {
	pub marketplaces: Vec<CCMarketplaceEntryResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCMarketplaceAddRequest {
	pub source: String,
	#[serde(default = "default_scope")]
	pub scope: String,
	/// Optional git sparse-checkout paths (for monorepo marketplaces).
	#[serde(default)]
	pub sparse: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CCMarketplaceMutationResponse {
	pub success: bool,
	pub message: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub marketplace: Option<CCMarketplaceEntryResponse>,
}

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
