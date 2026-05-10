use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ConfigFileType {
	Json,
	Toml,
	Markdown,
	Yaml,
	Text,
	Directory,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct ConfigFileNode {
	/// Relative path from agent root (e.g. "settings.json", "skills/my-skill")
	pub path: String,
	pub name: String,
	#[serde(rename = "type")]
	pub file_type: ConfigFileType,
	/// Optional navigation target for directories (e.g. skills/ -> "/skills")
	#[serde(skip_serializing_if = "Option::is_none")]
	pub link_to: Option<String>,
	/// Child nodes (only populated for directories)
	pub children: Vec<ConfigFileNode>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct AgentWorkspaceResponse {
	pub agent_id: String,
	/// Display path with ~ prefix (e.g. "~/.claude")
	pub root_path: String,
	pub files: Vec<ConfigFileNode>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct FileContentResponse {
	pub path: String,
	pub name: String,
	pub file_type: ConfigFileType,
	pub content: String,
}
