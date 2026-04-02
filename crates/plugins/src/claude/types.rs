//! Claude Code plugin types
//!
//! Data structures for parsing installed_plugins.json

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Root structure of installed_plugins.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPluginsManifest {
	pub version: i32,
	/// Plugin ID -> list of installations (different scopes)
	pub plugins: HashMap<String, Vec<InstalledPluginInfo>>,
}

/// Information about an installed plugin
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPluginInfo {
	pub scope: String,
	#[serde(rename = "installPath")]
	pub install_path: String,
	pub version: String,
	#[serde(rename = "installedAt")]
	pub installed_at: String,
	#[serde(rename = "lastUpdated")]
	pub last_updated: String,
	#[serde(rename = "gitCommitSha")]
	pub git_commit_sha: String,
}

/// Plugin source types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginScope {
	User,
	Project,
}

/// Plugin manifest (plugin.json or .claude-plugin/plugin.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
	pub name: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub version: Option<String>,
	pub description: String,
	pub author: PluginAuthor,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub homepage: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub repository: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub license: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub keywords: Option<Vec<String>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub logo: Option<String>,
	/// Path to skills directory relative to plugin root
	#[serde(skip_serializing_if = "Option::is_none")]
	pub skills: Option<String>,
	/// Path to agents directory relative to plugin root
	#[serde(skip_serializing_if = "Option::is_none")]
	pub agents: Option<String>,
	/// Path to commands directory relative to plugin root
	#[serde(skip_serializing_if = "Option::is_none")]
	pub commands: Option<String>,
	/// User configuration schema
	#[serde(skip_serializing_if = "Option::is_none")]
	pub user_config: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginAuthor {
	pub name: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub email: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub url: Option<String>,
}

/// Hooks manifest (hooks/hooks.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HooksManifest {
	pub hooks: HashMap<String, Vec<HookDefinition>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookDefinition {
	/// Pattern to match (regex or exact string)
	#[serde(skip_serializing_if = "Option::is_none")]
	pub matcher: Option<String>,
	/// Hooks to execute
	pub hooks: Vec<HookAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookAction {
	/// Hook type: "command", "prompt", "agent", "http"
	#[serde(rename = "type")]
	pub action_type: String,
	/// Command to execute, prompt text, agent name, or URL
	#[serde(skip_serializing_if = "Option::is_none")]
	pub command: Option<String>,
	/// Timeout in seconds
	#[serde(skip_serializing_if = "Option::is_none")]
	pub timeout: Option<u32>,
}

/// MCP Server configuration (.mcp.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpConfig {
	#[serde(rename = "mcpServers")]
	pub mcp_servers: HashMap<String, McpServerConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
	#[serde(rename = "type")]
	pub transport_type: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub command: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub args: Option<Vec<String>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub url: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub env: Option<HashMap<String, String>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub headers: Option<HashMap<String, String>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub note: Option<String>,
}
