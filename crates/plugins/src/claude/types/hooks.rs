use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
