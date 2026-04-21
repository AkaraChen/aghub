use super::common::CCPluginResponse;
use crate::dto::integrations::CodeEditorType;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

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

/// Check for updates request/response
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
	/// Config as JSON string (must be a valid JSON object)
	pub config: String,
}
