use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// The normalized configuration structure that works across all agent types
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentConfig {
	#[serde(default)]
	pub skills: Vec<Skill>,
	#[serde(default)]
	pub mcps: Vec<McpServer>,
}

impl AgentConfig {
	pub fn new() -> Self {
		Self {
			skills: Vec::new(),
			mcps: Vec::new(),
		}
	}
}

impl Default for AgentConfig {
	fn default() -> Self {
		Self::new()
	}
}

/// A skill with explicit frontmatter fields
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Skill {
	pub name: String,
	#[serde(default = "default_true")]
	pub enabled: bool,
	pub description: Option<String>,
	pub author: Option<String>,
	pub version: Option<String>,
	#[serde(skip)]
	pub content: Option<String>,
	/// List of tool names this skill provides
	#[serde(default)]
	pub tools: Vec<String>,
	/// Source path relative to skills directory with ~ prefix (e.g., "~/.claude/skills/my-skill/SKILL.md")
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub source_path: Option<String>,
	/// Resolved canonical path when source_path is a symlink.
	/// None if the skill was not discovered via a symlink.
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub canonical_path: Option<String>,
	/// Which config scope this skill was loaded from (set at load time, not persisted)
	#[serde(skip)]
	pub config_source: Option<ConfigSource>,
}

impl Skill {
	pub fn new(name: impl Into<String>) -> Self {
		Self {
			name: name.into(),
			enabled: true,
			description: None,
			author: None,
			version: None,
			content: None,
			tools: Vec::new(),
			source_path: None,
			canonical_path: None,
			config_source: None,
		}
	}
}

/// MCP server configuration
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct McpServer {
	pub name: String,
	#[serde(default = "default_true")]
	pub enabled: bool,
	pub transport: McpTransport,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub timeout: Option<u64>, // Timeout in seconds
	/// Which config scope this MCP was loaded from (set at load time, not persisted)
	#[serde(skip)]
	pub config_source: Option<ConfigSource>,
}

impl McpServer {
	pub fn new(name: impl Into<String>, transport: McpTransport) -> Self {
		Self {
			name: name.into(),
			enabled: true,
			transport,
			timeout: None,
			config_source: None,
		}
	}
}

/// Transport configuration for MCP servers
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum McpTransport {
	/// stdio-based MCP transport (command execution)
	Stdio {
		command: String,
		#[serde(default)]
		args: Vec<String>,
		/// Environment variables (only for stdio transport)
		#[serde(default)]
		env: Option<HashMap<String, String>>,
		#[serde(skip_serializing_if = "Option::is_none")]
		timeout: Option<u64>,
	},
	/// Legacy SSE-based MCP transport (HTTP server-sent events)
	/// Deprecated in favor of StreamableHttp
	Sse {
		url: String,
		/// HTTP headers as KV pairs (for SSE-based MCPs)
		#[serde(default)]
		headers: Option<HashMap<String, String>>,
		#[serde(skip_serializing_if = "Option::is_none")]
		timeout: Option<u64>,
	},
	/// Streamable HTTP transport (successor to SSE)
	/// Uses HTTP POST for client->server, streaming responses for server->client
	StreamableHttp {
		url: String,
		/// HTTP headers as KV pairs
		#[serde(default)]
		headers: Option<HashMap<String, String>>,
		#[serde(skip_serializing_if = "Option::is_none")]
		timeout: Option<u64>,
	},
}

impl McpTransport {
	pub fn stdio(command: impl Into<String>, args: Vec<String>) -> Self {
		Self::Stdio {
			command: command.into(),
			args,
			env: None,
			timeout: None,
		}
	}

	pub fn stdio_with_env(
		command: impl Into<String>,
		args: Vec<String>,
		env: HashMap<String, String>,
	) -> Self {
		Self::Stdio {
			command: command.into(),
			args,
			env: Some(env),
			timeout: None,
		}
	}

	pub fn sse(url: impl Into<String>) -> Self {
		Self::Sse {
			url: url.into(),
			headers: None,
			timeout: None,
		}
	}

	pub fn sse_with_headers(
		url: impl Into<String>,
		headers: HashMap<String, String>,
	) -> Self {
		Self::Sse {
			url: url.into(),
			headers: Some(headers),
			timeout: None,
		}
	}

	pub fn streamable_http(url: impl Into<String>) -> Self {
		Self::StreamableHttp {
			url: url.into(),
			headers: None,
			timeout: None,
		}
	}

	pub fn streamable_http_with_headers(
		url: impl Into<String>,
		headers: HashMap<String, String>,
	) -> Self {
		Self::StreamableHttp {
			url: url.into(),
			headers: Some(headers),
			timeout: None,
		}
	}
}

pub(crate) fn default_true() -> bool {
	true
}

/// Source of a resource (project-level vs global)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConfigSource {
	Global,
	Project,
}

/// Resource discovery scope
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ResourceScope {
	/// Show only global resources (default behavior)
	#[default]
	GlobalOnly,
	/// Show only project-level resources
	ProjectOnly,
	/// Show both project and global resources
	Both,
}

/// Agent types supported by the system
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentType {
	Cursor,
	Windsurf,
	Copilot,
	Claude,
	RooCode,
	Cline,
	Gemini,
	Codex,
	Antigravity,
	Openclaw,
	OpenCode,
	// New agents
	AugmentCode,
	KiloCode,
	Amp,
	Zed,
	Kiro,
	Warp,
	Trae,
	Factory,
	Kimi,
	Mistral,
	Pi,
	JetBrainsAi,
}

impl AgentType {
	pub const ALL: &[AgentType] = &[
		AgentType::Cursor,
		AgentType::Windsurf,
		AgentType::Copilot,
		AgentType::Claude,
		AgentType::RooCode,
		AgentType::Cline,
		AgentType::Gemini,
		AgentType::Codex,
		AgentType::Antigravity,
		AgentType::Openclaw,
		AgentType::OpenCode,
		AgentType::AugmentCode,
		AgentType::KiloCode,
		AgentType::Amp,
		AgentType::Zed,
		AgentType::Kiro,
		AgentType::Warp,
		AgentType::Trae,
		AgentType::Factory,
		AgentType::Kimi,
		AgentType::Mistral,
		AgentType::Pi,
		AgentType::JetBrainsAi,
	];

	pub fn as_str(&self) -> &'static str {
		match self {
			AgentType::Cursor => "cursor",
			AgentType::Windsurf => "windsurf",
			AgentType::Copilot => "copilot",
			AgentType::Claude => "claude",
			AgentType::RooCode => "roocode",
			AgentType::Cline => "cline",
			AgentType::Gemini => "gemini",
			AgentType::Codex => "codex",
			AgentType::Antigravity => "antigravity",
			AgentType::Openclaw => "openclaw",
			AgentType::OpenCode => "opencode",
			AgentType::AugmentCode => "augmentcode",
			AgentType::KiloCode => "kilocode",
			AgentType::Amp => "amp",
			AgentType::Zed => "zed",
			AgentType::Kiro => "kiro",
			AgentType::Warp => "warp",
			AgentType::Trae => "trae",
			AgentType::Factory => "factory",
			AgentType::Kimi => "kimi",
			AgentType::Mistral => "mistral",
			AgentType::Pi => "pi",
			AgentType::JetBrainsAi => "jetbrains-ai",
		}
	}

	pub fn next(&self) -> AgentType {
		let idx = Self::ALL.iter().position(|a| a == self).unwrap_or(0);
		Self::ALL[(idx + 1) % Self::ALL.len()]
	}
}

impl std::str::FromStr for AgentType {
	type Err = String;

	fn from_str(s: &str) -> Result<Self, Self::Err> {
		match s.to_lowercase().as_str() {
			"cursor" => Ok(AgentType::Cursor),
			"windsurf" => Ok(AgentType::Windsurf),
			"copilot" => Ok(AgentType::Copilot),
			"claude" => Ok(AgentType::Claude),
			"roocode" | "roo" => Ok(AgentType::RooCode),
			"cline" => Ok(AgentType::Cline),
			"gemini" => Ok(AgentType::Gemini),
			"codex" => Ok(AgentType::Codex),
			"antigravity" => Ok(AgentType::Antigravity),
			"openclaw" => Ok(AgentType::Openclaw),
			"opencode" => Ok(AgentType::OpenCode),
			"augmentcode" | "augment" => Ok(AgentType::AugmentCode),
			"kilocode" | "kilo" => Ok(AgentType::KiloCode),
			"amp" => Ok(AgentType::Amp),
			"zed" => Ok(AgentType::Zed),
			"kiro" => Ok(AgentType::Kiro),
			"warp" => Ok(AgentType::Warp),
			"trae" => Ok(AgentType::Trae),
			"factory" => Ok(AgentType::Factory),
			"kimi" | "kimi-cli" => Ok(AgentType::Kimi),
			"mistral" => Ok(AgentType::Mistral),
			"pi" => Ok(AgentType::Pi),
			"jetbrains-ai" | "jetbrains" | "jb" => Ok(AgentType::JetBrainsAi),
			_ => Err(format!("Unknown agent type: {}", s)),
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_mcp_server_stdio() {
		let mcp = McpServer::new(
			"filesystem",
			McpTransport::stdio(
				"npx",
				vec![
					"-y".to_string(),
					"@modelcontextprotocol/server-filesystem".to_string(),
					"/tmp".to_string(),
				],
			),
		);

		let json = serde_json::to_string(&mcp).unwrap();
		assert!(json.contains("\"type\":\"stdio\""));
		assert!(json.contains("\"command\":\"npx\""));
	}

	#[test]
	fn test_mcp_server_stdio_with_env() {
		let mut env = HashMap::new();
		env.insert("API_KEY".to_string(), "secret".to_string());

		let mcp = McpServer::new(
			"custom-server",
			McpTransport::stdio_with_env(
				"my-server",
				vec!["--port".to_string()],
				env,
			),
		);

		let json = serde_json::to_string(&mcp).unwrap();
		assert!(json.contains("\"type\":\"stdio\""));
		assert!(json.contains("\"API_KEY\""));
	}

	#[test]
	fn test_mcp_server_sse_with_headers() {
		let mut headers = HashMap::new();
		headers.insert("Authorization".to_string(), "Bearer token".to_string());

		let mcp = McpServer::new(
			"custom-server",
			McpTransport::sse_with_headers("http://localhost:3000", headers),
		);

		let json = serde_json::to_string(&mcp).unwrap();
		assert!(json.contains("\"type\":\"sse\""));
		assert!(json.contains("\"url\":\"http://localhost:3000\""));
		assert!(json.contains("\"Authorization\""));
	}

	#[test]
	fn test_mcp_server_streamable_http_with_headers() {
		let mut headers = HashMap::new();
		headers.insert("Authorization".to_string(), "Bearer token".to_string());
		headers.insert("X-API-Key".to_string(), "secret-key".to_string());

		let mcp = McpServer::new(
			"streamable-server",
			McpTransport::streamable_http_with_headers(
				"http://localhost:3000/mcp",
				headers,
			),
		);

		let json = serde_json::to_string(&mcp).unwrap();
		assert!(json.contains("\"type\":\"streamable_http\""));
		assert!(json.contains("\"url\":\"http://localhost:3000/mcp\""));
		assert!(json.contains("\"Authorization\""));
		assert!(json.contains("\"X-API-Key\""));

		// Test round-trip
		let deserialized: McpServer = serde_json::from_str(&json).unwrap();
		assert_eq!(mcp, deserialized);
	}

	#[test]
	fn test_mcp_server_streamable_http_basic() {
		let mcp = McpServer::new(
			"basic-http",
			McpTransport::streamable_http("http://localhost:8080/mcp"),
		);

		let json = serde_json::to_string(&mcp).unwrap();
		assert!(json.contains("\"type\":\"streamable_http\""));
		assert!(json.contains("\"url\":\"http://localhost:8080/mcp\""));
	}

	#[test]
	fn test_mcp_server_with_timeout() {
		let transport = McpTransport::Stdio {
			command: "npx".to_string(),
			args: vec!["-y".to_string()],
			env: None,
			timeout: Some(30),
		};
		let mcp = McpServer {
			name: "test".to_string(),
			enabled: true,
			transport,
			timeout: Some(60),
			config_source: None,
		};

		let json = serde_json::to_string(&mcp).unwrap();
		assert!(json.contains("\"timeout\":60"));
	}

	#[test]
	fn test_agent_config_default() {
		let config = AgentConfig::new();
		assert!(config.skills.is_empty());
		assert!(config.mcps.is_empty());
	}
}
