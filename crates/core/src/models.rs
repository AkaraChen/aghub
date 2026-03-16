use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// The normalized configuration structure that works across all agent types
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentConfig {
    #[serde(default)]
    pub skills: Vec<Skill>,
    #[serde(default)]
    pub mcps: Vec<McpServer>,
    #[serde(default)]
    pub sub_agents: Vec<SubAgent>,
}

impl AgentConfig {
    pub fn new() -> Self {
        Self {
            skills: Vec::new(),
            mcps: Vec::new(),
            sub_agents: Vec::new(),
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
    /// URL or file path to skill definition
    pub source: Option<String>,
    pub description: Option<String>,
    pub author: Option<String>,
    pub version: Option<String>,
    /// List of tool names this skill provides
    #[serde(default)]
    pub tools: Vec<String>,
}

impl Skill {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            enabled: true,
            source: None,
            description: None,
            author: None,
            version: None,
            tools: Vec::new(),
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
}

impl McpServer {
    pub fn new(name: impl Into<String>, transport: McpTransport) -> Self {
        Self {
            name: name.into(),
            enabled: true,
            transport,
        }
    }
}

/// Transport configuration for MCP servers
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum McpTransport {
    /// stdio-based MCP transport with command execution
    Command {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        /// Environment variables (only for stdio transport)
        #[serde(default)]
        env: Option<HashMap<String, String>>,
    },
    /// HTTP/SSE-based MCP transport
    Url {
        url: String,
        /// HTTP headers as KV pairs (for URL-based MCPs)
        #[serde(default)]
        headers: Option<HashMap<String, String>>,
    },
}

impl McpTransport {
    pub fn command(command: impl Into<String>, args: Vec<String>) -> Self {
        Self::Command {
            command: command.into(),
            args,
            env: None,
        }
    }

    pub fn command_with_env(
        command: impl Into<String>,
        args: Vec<String>,
        env: HashMap<String, String>,
    ) -> Self {
        Self::Command {
            command: command.into(),
            args,
            env: Some(env),
        }
    }

    pub fn url(url: impl Into<String>) -> Self {
        Self::Url {
            url: url.into(),
            headers: None,
        }
    }

    pub fn url_with_headers(url: impl Into<String>, headers: HashMap<String, String>) -> Self {
        Self::Url {
            url: url.into(),
            headers: Some(headers),
        }
    }
}

/// Sub-agent configuration
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SubAgent {
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub description: Option<String>,
    /// Model identifier (e.g., "claude-sonnet-4-6")
    pub model: Option<String>,
    /// System instructions for the sub-agent
    pub instructions: Option<String>,
}

impl SubAgent {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            enabled: true,
            description: None,
            model: None,
            instructions: None,
        }
    }
}

fn default_true() -> bool {
    true
}

/// Agent types supported by the system
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentType {
    Claude,
    OpenCode,
}

impl AgentType {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentType::Claude => "claude",
            AgentType::OpenCode => "opencode",
        }
    }
}

impl std::str::FromStr for AgentType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "claude" => Ok(AgentType::Claude),
            "opencode" => Ok(AgentType::OpenCode),
            _ => Err(format!("Unknown agent type: {}", s)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_skill_serialization() {
        let skill = Skill {
            name: "test-skill".to_string(),
            enabled: true,
            source: Some("https://example.com/skill.json".to_string()),
            description: Some("A test skill".to_string()),
            author: Some("test-author".to_string()),
            version: Some("1.0.0".to_string()),
            tools: vec!["tool1".to_string(), "tool2".to_string()],
        };

        let json = serde_json::to_string(&skill).unwrap();
        let deserialized: Skill = serde_json::from_str(&json).unwrap();
        assert_eq!(skill, deserialized);
    }

    #[test]
    fn test_mcp_server_command() {
        let mcp = McpServer::new(
            "filesystem",
            McpTransport::command(
                "npx",
                vec![
                    "-y".to_string(),
                    "@modelcontextprotocol/server-filesystem".to_string(),
                    "/tmp".to_string(),
                ],
            ),
        );

        let json = serde_json::to_string(&mcp).unwrap();
        assert!(json.contains("\"type\":\"command\""));
        assert!(json.contains("\"command\":\"npx\""));
    }

    #[test]
    fn test_mcp_server_url_with_headers() {
        let mut headers = HashMap::new();
        headers.insert("Authorization".to_string(), "Bearer token".to_string());

        let mcp = McpServer::new(
            "custom-server",
            McpTransport::url_with_headers("http://localhost:3000", headers),
        );

        let json = serde_json::to_string(&mcp).unwrap();
        assert!(json.contains("\"type\":\"url\""));
        assert!(json.contains("\"url\":\"http://localhost:3000\""));
        assert!(json.contains("\"Authorization\""));
    }

    #[test]
    fn test_agent_config_default() {
        let config = AgentConfig::new();
        assert!(config.skills.is_empty());
        assert!(config.mcps.is_empty());
        assert!(config.sub_agents.is_empty());
    }
}
