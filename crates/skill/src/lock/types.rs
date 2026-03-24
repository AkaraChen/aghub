use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const CURRENT_VERSION: u32 = 3;

/// Represents a single installed skill entry in the lock file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillLockEntry {
	/// Normalized source identifier (e.g., "owner/repo", "mintlify/bun.com")
	pub source: String,
	/// The provider/source type (e.g., "github", "mintlify", "huggingface", "local")
	#[serde(rename = "sourceType")]
	pub source_type: String,
	/// The original URL used to install the skill (for re-fetching updates)
	#[serde(rename = "sourceUrl")]
	pub source_url: String,
	/// Subpath within the source repo, if applicable
	#[serde(rename = "skillPath", skip_serializing_if = "Option::is_none")]
	pub skill_path: Option<String>,
	/// GitHub tree SHA for the entire skill folder.
	/// This hash changes when ANY file in the skill folder changes.
	/// Fetched via GitHub Trees API by the telemetry server.
	#[serde(rename = "skillFolderHash")]
	pub skill_folder_hash: String,
	/// ISO timestamp when the skill was first installed
	#[serde(rename = "installedAt")]
	pub installed_at: String,
	/// ISO timestamp when the skill was last updated
	#[serde(rename = "updatedAt")]
	pub updated_at: String,
	/// Name of the plugin this skill belongs to (if any)
	#[serde(rename = "pluginName", skip_serializing_if = "Option::is_none")]
	pub plugin_name: Option<String>,
}

/// Tracks dismissed prompts so they're not shown again.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DismissedPrompts {
	/// Dismissed the find-skills skill installation prompt
	#[serde(rename = "findSkillsPrompt", skip_serializing_if = "Option::is_none")]
	pub find_skills_prompt: Option<bool>,
}

/// The structure of the skill lock file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillLockFile {
	/// Schema version for future migrations
	pub version: u32,
	/// Map of skill name to its lock entry
	pub skills: BTreeMap<String, SkillLockEntry>,
	/// Tracks dismissed prompts
	#[serde(skip_serializing_if = "Option::is_none")]
	pub dismissed: Option<DismissedPrompts>,
	/// Last selected agents for installation
	#[serde(rename = "lastSelectedAgents", skip_serializing_if = "Option::is_none")]
	pub last_selected_agents: Option<Vec<String>>,
}

impl Default for SkillLockFile {
	fn default() -> Self {
		Self {
			version: CURRENT_VERSION,
			skills: BTreeMap::new(),
			dismissed: None,
			last_selected_agents: None,
		}
	}
}

impl SkillLockFile {
	/// Create a new empty lock file.
	pub fn new() -> Self {
		Self::default()
	}

	/// Get current schema version
	pub fn current_version() -> u32 {
		CURRENT_VERSION
	}
}

impl SkillLockEntry {
	/// Create a new skill lock entry with timestamps
	pub fn new(
		source: String,
		source_type: String,
		source_url: String,
		skill_path: Option<String>,
		skill_folder_hash: String,
		plugin_name: Option<String>,
	) -> Self {
		let now = Utc::now().to_rfc3339();
		Self {
			source,
			source_type,
			source_url,
			skill_path,
			skill_folder_hash,
			installed_at: now.clone(),
			updated_at: now,
			plugin_name,
		}
	}
}