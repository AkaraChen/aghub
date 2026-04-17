use super::common::{
	CCPluginAuthorResponse, CCPluginMcpConfigResponse, CCPluginResponse,
	CCPluginSkillInfo,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Plugin manifest (detailed plugin info)
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

/// Plugin detail response (combined)
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
