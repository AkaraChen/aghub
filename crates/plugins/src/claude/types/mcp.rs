use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// MCP Server configuration (.mcp.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpConfig {
	#[serde(rename = "mcpServers")]
	pub mcp_servers: HashMap<String, McpServerConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
	/// Transport type: "stdio", "http", "sse", etc.
	/// Defaults to "stdio" when omitted (common in legacy .mcp.json)
	#[serde(
		rename = "type",
		default = "McpServerConfig::default_transport_type"
	)]
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

impl McpServerConfig {
	fn default_transport_type() -> String {
		"stdio".to_string()
	}
}
