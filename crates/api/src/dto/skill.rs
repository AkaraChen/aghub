use aghub_core::models::{ConfigSource, Skill};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct CreateSkillRequest {
	pub name: String,
	pub description: Option<String>,
	pub author: Option<String>,
	pub version: Option<String>,
	pub content: Option<String>,
	pub tools: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct ImportSkillRequest {
	pub path: String,
}

impl From<CreateSkillRequest> for Skill {
	fn from(req: CreateSkillRequest) -> Self {
		Skill {
			name: req.name,
			enabled: true,
			description: req.description,
			author: req.author,
			version: req.version,
			content: req.content,
			tools: req.tools.unwrap_or_default(),
			source_path: None,
			canonical_path: None,
			config_source: None,
		}
	}
}

#[derive(Debug, Deserialize)]
pub struct UpdateSkillRequest {
	pub name: Option<String>,
	pub description: Option<String>,
	pub author: Option<String>,
	pub version: Option<String>,
	pub content: Option<String>,
	pub tools: Option<Vec<String>>,
	pub enabled: Option<bool>,
}

impl UpdateSkillRequest {
	pub fn apply_to(self, existing: Skill) -> Skill {
		Skill {
			name: self.name.unwrap_or(existing.name),
			enabled: self.enabled.unwrap_or(existing.enabled),
			description: self.description.or(existing.description),
			author: self.author.or(existing.author),
			version: self.version.or(existing.version),
			content: self.content.or(existing.content),
			tools: self.tools.unwrap_or(existing.tools),
			source_path: existing.source_path,
			canonical_path: existing.canonical_path,
			config_source: existing.config_source,
		}
	}
}

#[derive(Debug, Serialize)]
pub struct SkillResponse {
	pub name: String,
	pub enabled: bool,
	pub source_path: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub canonical_path: Option<String>,
	pub description: Option<String>,
	pub author: Option<String>,
	pub version: Option<String>,
	pub tools: Vec<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub source: Option<ConfigSource>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub agent: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillTreeNodeKind {
	File,
	Directory,
}

#[derive(Debug, Clone, Serialize)]
pub struct SkillTreeNodeResponse {
	pub name: String,
	pub path: String,
	pub kind: SkillTreeNodeKind,
	pub children: Vec<SkillTreeNodeResponse>,
}

impl From<Skill> for SkillResponse {
	fn from(s: Skill) -> Self {
		SkillResponse::from(&s)
	}
}

impl From<&Skill> for SkillResponse {
	fn from(s: &Skill) -> Self {
		SkillResponse {
			name: s.name.clone(),
			enabled: s.enabled,
			source_path: s.source_path.clone(),
			canonical_path: s.canonical_path.clone(),
			description: s.description.clone(),
			author: s.author.clone(),
			version: s.version.clone(),
			tools: s.tools.clone(),
			source: s.config_source,
			agent: None,
		}
	}
}

impl From<(Skill, &str)> for SkillResponse {
	fn from((s, agent_id): (Skill, &str)) -> Self {
		SkillResponse {
			agent: Some(agent_id.to_string()),
			..SkillResponse::from(s)
		}
	}
}

#[derive(Debug, Deserialize)]
pub struct InstallSkillRequest {
	pub source: String,
	pub agents: Vec<String>,
	pub skills: Vec<String>,
	pub scope: String,
	pub project_path: Option<String>,
	pub install_all: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct InstallSkillResponse {
	pub success: bool,
	pub stdout: String,
	pub stderr: String,
	pub exit_code: i32,
}

/// Response for a single global skill lock entry
#[derive(Debug, Serialize)]
pub struct SkillLockEntryResponse {
	pub name: String,
	pub source: String,
	#[serde(rename = "sourceType")]
	pub source_type: String,
	#[serde(rename = "sourceUrl")]
	pub source_url: String,
	#[serde(rename = "skillPath", skip_serializing_if = "Option::is_none")]
	pub skill_path: Option<String>,
	#[serde(rename = "skillFolderHash")]
	pub skill_folder_hash: String,
	#[serde(rename = "installedAt")]
	pub installed_at: String,
	#[serde(rename = "updatedAt")]
	pub updated_at: String,
	#[serde(rename = "pluginName", skip_serializing_if = "Option::is_none")]
	pub plugin_name: Option<String>,
}

/// Response for the global skill lock file
#[derive(Debug, Serialize)]
pub struct GlobalSkillLockResponse {
	pub version: u32,
	pub skills: Vec<SkillLockEntryResponse>,
	#[serde(
		rename = "lastSelectedAgents",
		skip_serializing_if = "Option::is_none"
	)]
	pub last_selected_agents: Option<Vec<String>>,
}

/// Response for a single project skill lock entry
#[derive(Debug, Serialize)]
pub struct LocalSkillLockEntryResponse {
	pub name: String,
	pub source: String,
	#[serde(rename = "sourceType")]
	pub source_type: String,
	#[serde(rename = "computedHash")]
	pub computed_hash: String,
}

/// Response for the project skill lock file
#[derive(Debug, Serialize)]
pub struct ProjectSkillLockResponse {
	pub version: u32,
	pub skills: Vec<LocalSkillLockEntryResponse>,
}

#[derive(Debug, Deserialize)]
pub struct DeleteSkillByPathRequest {
	pub source_path: String,
	pub agents: Vec<String>,
	pub scope: String,
	pub project_root: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ValidationError {
	pub agent: String,
	pub reason: String,
}

#[derive(Debug, Serialize)]
pub struct DeleteSkillByPathResponse {
	pub success: bool,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub deleted_path: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub validation_errors: Option<Vec<ValidationError>>,
}
