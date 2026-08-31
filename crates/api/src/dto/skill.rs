use aghub_core::models::Skill;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::dto::common::ConfigSource;

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CreateSkillRequest {
	pub name: String,
	pub description: Option<String>,
	pub author: Option<String>,
	pub version: Option<String>,
	pub content: Option<String>,
	pub tools: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct ImportSkillRequest {
	pub path: String,
	/// Content identity returned by a prior review, when one was shown.
	#[ts(optional = nullable)]
	pub expected_content_digest: Option<String>,
	/// Assessment identity explicitly confirmed for a blocked review.
	#[ts(optional = nullable)]
	pub confirmed_assessment_digest: Option<String>,
}

impl From<CreateSkillRequest> for Skill {
	fn from(req: CreateSkillRequest) -> Self {
		Skill {
			name: req.name,
			display_name: None,
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

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
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
			display_name: existing.display_name,
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

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct SkillLocationResponse {
	pub source_path: String,
	pub is_symlink: bool,
	pub source: ConfigSource,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub provider: Option<SkillProviderResponse>,
}

#[derive(Debug, Clone, Copy, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum SkillProviderKindResponse {
	Plugin,
	System,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct SkillProviderResponse {
	pub kind: SkillProviderKindResponse,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub id: Option<String>,
	pub qualified_name: String,
	pub managed: bool,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct SkillProviderLoadErrorResponse {
	pub cwd: String,
	pub path: String,
	pub message: String,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct CodexSkillDiscoveryResponse {
	pub skills: Vec<SkillResponse>,
	pub standalone_skills: Vec<CodexStandaloneSkillResponse>,
	pub errors: Vec<SkillProviderLoadErrorResponse>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct CodexStandaloneSkillResponse {
	pub name: String,
	pub source_path: String,
	pub enabled: bool,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CodexVisibleCopyRequest {
	pub name: String,
	pub mode: CodexVisibleCopyMode,
	#[serde(default)]
	#[ts(optional = nullable)]
	pub source_path: Option<String>,
	#[serde(default)]
	#[ts(optional = nullable)]
	pub source_paths: Option<Vec<String>>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct CodexVisibleCopyResponse {
	pub name: String,
	pub mode: CodexVisibleCopyMode,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub source_path: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub source_paths: Option<Vec<String>>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum CodexVisibleCopyMode {
	All,
	Single,
	Selected,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct SkillResponse {
	pub name: String,
	pub display_name: Option<String>,
	pub enabled: bool,
	pub source_path: Option<String>,
	pub is_symlink: bool,
	pub description: Option<String>,
	pub author: Option<String>,
	pub version: Option<String>,
	pub tools: Vec<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub source: Option<ConfigSource>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub agent: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub locations: Option<Vec<SkillLocationResponse>>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum SkillTreeNodeKind {
	File,
	Directory,
	Symlink,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum SkillLinkStatusResponse {
	Valid,
	Broken,
	OutsideRoot,
	Unreadable,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct SkillLinkResponse {
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub target: Option<String>,
	pub status: SkillLinkStatusResponse,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct SkillHardLinkResponse {
	pub peers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct SkillTreeSkillResponse {
	pub name: String,
	pub display_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct SkillTreeNodeResponse {
	pub name: String,
	pub path: String,
	pub kind: SkillTreeNodeKind,
	pub children: Vec<SkillTreeNodeResponse>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub link: Option<SkillLinkResponse>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub hard_link: Option<SkillHardLinkResponse>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub skill: Option<SkillTreeSkillResponse>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct SkillDiffRequest {
	pub reference: SkillDiffReferenceRequest,
	pub installed_paths: Vec<String>,
	pub scope: Option<String>,
	pub project_root: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SkillDiffReferenceRequest {
	Installed {
		source_path: String,
	},
	GitScan {
		session_id: String,
		skill_path: String,
	},
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum SkillFileDiffKindResponse {
	Added,
	Removed,
	Modified,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct SkillFileDiffResponse {
	pub path: String,
	pub change: SkillFileDiffKindResponse,
	pub before: Option<String>,
	pub after: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub before_link: Option<SkillLinkResponse>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub after_link: Option<SkillLinkResponse>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub before_hard_link: Option<SkillHardLinkResponse>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub after_hard_link: Option<SkillHardLinkResponse>,
	pub content_omitted: bool,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct SkillDirectoryDiffResponse {
	pub identical: bool,
	pub base_hash: String,
	pub target_hash: String,
	pub files: Vec<SkillFileDiffResponse>,
	pub files_omitted: usize,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct SkillDiffResponse {
	pub results: Vec<Option<SkillDirectoryDiffResponse>>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct SkillCopyStatusGroupRequest {
	pub name: String,
	pub source_paths: Vec<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct SkillCopyStatusRequest {
	pub groups: Vec<SkillCopyStatusGroupRequest>,
	pub scope: Option<String>,
	pub project_root: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct SkillCopyStatusResult {
	pub name: String,
	pub has_differences: bool,
	pub unavailable: usize,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct SkillCopyStatusResponse {
	pub results: Vec<SkillCopyStatusResult>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct SkillCopyResolutionRequest {
	pub reference: SkillDiffReferenceRequest,
	pub expected_reference_hash: String,
	#[serde(default)]
	pub storage_mode: SkillCopyStorageModeRequest,
	pub targets: Vec<SkillCopyResolutionTargetRequest>,
	pub scope: Option<String>,
	pub project_root: Option<String>,
	#[ts(optional = nullable)]
	pub expected_content_digest: Option<String>,
	#[ts(optional = nullable)]
	pub confirmed_assessment_digest: Option<String>,
	#[ts(optional = nullable)]
	pub audit_only: Option<bool>,
}

#[derive(Debug, Default, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum SkillCopyStorageModeRequest {
	#[default]
	Preserve,
	Copy,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct SkillCopyResolutionTargetRequest {
	pub source_path: String,
	pub expected_hash: String,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct SkillCopyResolutionResult {
	pub source_path: String,
	pub content_hash: String,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct SkillCopyResolutionResponse {
	pub name: String,
	pub reference_hash: String,
	pub results: Vec<SkillCopyResolutionResult>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional = nullable)]
	pub audit: Option<crate::dto::audit::AuditReportDto>,
	pub audit_confirmation_required: bool,
}

impl From<Skill> for SkillResponse {
	fn from(s: Skill) -> Self {
		SkillResponse::from(&s)
	}
}

impl SkillResponse {
	pub fn from_agent_skill(skill: Skill, agent_id: &str) -> Self {
		let mut response = Self::from(&skill);
		response.agent = Some(agent_id.to_string());
		response
	}
}

impl From<&Skill> for SkillResponse {
	fn from(s: &Skill) -> Self {
		SkillResponse {
			name: s.name.clone(),
			display_name: s.display_name.clone(),
			enabled: s.enabled,
			source_path: s.source_path.clone(),
			is_symlink: s.canonical_path.is_some(),
			description: s.description.clone(),
			author: s.author.clone(),
			version: s.version.clone(),
			tools: s.tools.clone(),
			source: s.config_source.map(Into::into),
			agent: None,
			locations: None,
		}
	}
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct InstallSkillRequest {
	pub source: String,
	pub agents: Vec<String>,
	pub skills: Vec<String>,
	pub scope: String,
	pub project_path: Option<String>,
	pub install_all: Option<bool>,
	/// Content identity returned by a prior review, when one was shown.
	#[ts(optional = nullable)]
	pub expected_content_digest: Option<String>,
	/// Assessment identity explicitly confirmed for a blocked review.
	#[ts(optional = nullable)]
	pub confirmed_assessment_digest: Option<String>,
	/// Reuse a clone cached from a prior blocked attempt (the "install anyway"
	/// retry) instead of cloning the source again.
	#[ts(optional = nullable)]
	pub session_id: Option<String>,
	/// Audit-only phase: clone + audit and return the verdict + `session_id`
	/// WITHOUT installing, so the desktop can show the result first and call
	/// back to install (reusing the session). Nothing is written to disk.
	#[ts(optional = nullable)]
	pub audit_only: Option<bool>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct InstallSkillResponse {
	pub success: bool,
	/// Security-audit report for the selected content.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional = nullable)]
	pub audit: Option<crate::dto::audit::AuditReportDto>,
	/// Whether this report needs an exact digest confirmation before writing.
	pub audit_confirmation_required: bool,
	/// Pass this back to reuse the already-cloned source after review.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional = nullable)]
	pub session_id: Option<String>,
}

/// Response for a single global skill lock entry
#[derive(Debug, Serialize, TS)]
#[ts(export)]
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
#[derive(Debug, Serialize, TS)]
#[ts(export)]
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
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct LocalSkillLockEntryResponse {
	pub name: String,
	pub source: String,
	#[serde(rename = "sourceType")]
	pub source_type: String,
	#[serde(rename = "computedHash")]
	pub computed_hash: String,
}

/// Response for the project skill lock file
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct ProjectSkillLockResponse {
	pub version: u32,
	pub skills: Vec<LocalSkillLockEntryResponse>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct DeleteSkillByPathRequest {
	pub source_path: String,
	pub agents: Vec<String>,
	pub scope: String,
	pub project_root: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct ValidationError {
	pub agent: String,
	pub reason: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct GitScanRequest {
	pub url: String,
	pub credential_id: Option<String>,
	pub branch: Option<String>,
	/// Skip security analysis while retaining the private scan clone.
	#[ts(optional = nullable)]
	pub skip_audit: Option<bool>,
	/// When re-scanning (e.g. branch switch), pass the existing
	/// session ID so the old clone is replaced.
	pub session_id: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct GitScanSkillEntry {
	pub name: String,
	pub description: String,
	pub author: Option<String>,
	pub version: Option<String>,
	pub path: String,
	/// Security-audit report, omitted when analysis was skipped.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional = nullable)]
	pub audit: Option<crate::dto::audit::AuditReportDto>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct GitScanResponse {
	pub session_id: String,
	pub skills: Vec<GitScanSkillEntry>,
	pub branches: Vec<String>,
	pub current_branch: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct GitInstallRequest {
	pub session_id: String,
	pub skill_paths: Vec<String>,
	pub agents: Vec<String>,
	pub scope: String,
	pub project_root: Option<String>,
	/// Content identity returned by a prior review, when one was shown.
	#[ts(optional = nullable)]
	pub expected_content_digest: Option<String>,
	/// Assessment identity explicitly confirmed for a blocked review.
	#[ts(optional = nullable)]
	pub confirmed_assessment_digest: Option<String>,
	/// Audit-only phase: audit the selected skills and return the worst verdict
	/// without installing, so the import UI can show "auditing" before "installing".
	#[ts(optional = nullable)]
	pub audit_only: Option<bool>,
}

/// Request to sync (update in-place) an existing skill from a git session.
#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct GitSyncRequest {
	pub session_id: String,
	/// Relative path of the skill within the cloned repo (from scan result).
	pub skill_path: String,
	/// Tilde-prefixed `source_path` values of every installation to replace.
	pub source_paths: Vec<String>,
	pub scope: Option<String>,
	pub project_root: Option<String>,
	/// Content identity returned by a prior review, when one was shown.
	#[ts(optional = nullable)]
	pub expected_content_digest: Option<String>,
	/// Assessment identity explicitly confirmed for a blocked review.
	#[ts(optional = nullable)]
	pub confirmed_assessment_digest: Option<String>,
	/// Audit without replacing the installed copies.
	#[ts(optional = nullable)]
	pub audit_only: Option<bool>,
}

/// Response for a git sync operation.
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct GitSyncResponse {
	pub success: bool,
	/// Security-audit report for the selected content.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional = nullable)]
	pub audit: Option<crate::dto::audit::AuditReportDto>,
	pub audit_confirmation_required: bool,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional = nullable)]
	pub name: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional = nullable)]
	pub error: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct GitInstallResultEntry {
	pub name: String,
	pub agent: String,
	pub success: bool,
	pub error: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct GitInstallResponse {
	pub results: Vec<GitInstallResultEntry>,
	/// Combined security-audit report for the selected content.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional = nullable)]
	pub audit: Option<crate::dto::audit::AuditReportDto>,
	/// Whether this report needs an exact digest confirmation before writing.
	pub audit_confirmation_required: bool,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct DeleteSkillByPathResponse {
	pub success: bool,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub deleted_path: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub validation_errors: Option<Vec<ValidationError>>,
}

#[derive(Debug, TS, rocket::FromForm)]
#[ts(export)]
pub struct SkillContentQuery {
	pub path: String,
	pub scope: Option<String>,
	pub project_root: Option<String>,
}

#[derive(Debug, TS, rocket::FromForm)]
#[ts(export)]
pub struct SkillTreeQuery {
	pub path: String,
	pub scope: Option<String>,
	pub project_root: Option<String>,
}

#[derive(Debug, TS, rocket::FromForm)]
#[ts(export)]
pub struct ProjectLockQuery {
	pub project_path: Option<String>,
}
