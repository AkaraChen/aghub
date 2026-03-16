use crate::{
    errors::{ConfigError, Result},
    models::{AgentConfig, McpServer, McpTransport, Skill, SubAgent},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::AgentAdapter;

/// OpenCode specific configuration structure
#[derive(Debug, Default, Serialize, Deserialize)]
struct OpenCodeConfig {
    #[serde(rename = "mcp_servers", default)]
    mcp_servers: Vec<OpenCodeMcpServer>,
    #[serde(default)]
    skills: Vec<OpenCodeSkill>,
    #[serde(rename = "sub_agents", default)]
    sub_agents: Vec<OpenCodeSubAgent>,
}

/// OpenCode MCP server configuration
#[derive(Debug, Serialize, Deserialize)]
struct OpenCodeMcpServer {
    name: String,
    #[serde(flatten)]
    transport: OpenCodeMcpTransport,
    #[serde(default)]
    enabled: bool,
}

/// OpenCode MCP transport (supports both command and URL)
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum OpenCodeMcpTransport {
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: Option<HashMap<String, String>>,
    },
    Sse {
        url: String,
        #[serde(default)]
        headers: Option<HashMap<String, String>>,
    },
}

/// OpenCode skill configuration
#[derive(Debug, Serialize, Deserialize)]
struct OpenCodeSkill {
    name: String,
    #[serde(default)]
    enabled: bool,
    source: Option<String>,
    description: Option<String>,
    author: Option<String>,
    version: Option<String>,
    #[serde(default)]
    tools: Vec<String>,
}

/// OpenCode sub-agent configuration
#[derive(Debug, Serialize, Deserialize)]
struct OpenCodeSubAgent {
    name: String,
    #[serde(default)]
    enabled: bool,
    description: Option<String>,
    model: Option<String>,
    instructions: Option<String>,
}

pub struct OpenCodeAdapter;

impl OpenCodeAdapter {
    pub fn new() -> Self {
        Self
    }
}

impl Default for OpenCodeAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentAdapter for OpenCodeAdapter {
    fn name(&self) -> &'static str {
        "opencode"
    }

    fn global_config_path(&self) -> PathBuf {
        crate::paths::opencode_global_path()
    }

    fn project_config_path(&self, project_root: &Path) -> PathBuf {
        crate::paths::opencode_project_path(project_root)
    }

    fn parse_config(&self, content: &str) -> Result<AgentConfig> {
        let opencode_config: OpenCodeConfig = serde_json::from_str(content)?;

        let mut config = AgentConfig::new();

        // Parse MCP servers
        for mcp in opencode_config.mcp_servers {
            let transport = match mcp.transport {
                OpenCodeMcpTransport::Stdio { command, args, env } => {
                    McpTransport::Command { command, args, env }
                }
                OpenCodeMcpTransport::Sse { url, headers } => {
                    McpTransport::Url { url, headers }
                }
            };
            config.mcps.push(McpServer {
                name: mcp.name,
                enabled: mcp.enabled,
                transport,
            });
        }

        // Parse skills
        for skill in opencode_config.skills {
            config.skills.push(Skill {
                name: skill.name,
                enabled: skill.enabled,
                source: skill.source,
                description: skill.description,
                author: skill.author,
                version: skill.version,
                tools: skill.tools,
            });
        }

        // Parse sub-agents
        for agent in opencode_config.sub_agents {
            config.sub_agents.push(SubAgent {
                name: agent.name,
                enabled: agent.enabled,
                description: agent.description,
                model: agent.model,
                instructions: agent.instructions,
            });
        }

        Ok(config)
    }

    fn serialize_config(&self, config: &AgentConfig) -> Result<String> {
        let mut opencode_config = OpenCodeConfig::default();

        // Serialize MCP servers
        for mcp in &config.mcps {
            let transport = match &mcp.transport {
                McpTransport::Command { command, args, env } => {
                    OpenCodeMcpTransport::Stdio {
                        command: command.clone(),
                        args: args.clone(),
                        env: env.clone(),
                    }
                }
                McpTransport::Url { url, headers } => OpenCodeMcpTransport::Sse {
                    url: url.clone(),
                    headers: headers.clone(),
                },
            };
            opencode_config.mcp_servers.push(OpenCodeMcpServer {
                name: mcp.name.clone(),
                transport,
                enabled: mcp.enabled,
            });
        }

        // Serialize skills
        for skill in &config.skills {
            opencode_config.skills.push(OpenCodeSkill {
                name: skill.name.clone(),
                enabled: skill.enabled,
                source: skill.source.clone(),
                description: skill.description.clone(),
                author: skill.author.clone(),
                version: skill.version.clone(),
                tools: skill.tools.clone(),
            });
        }

        // Serialize sub-agents
        for agent in &config.sub_agents {
            opencode_config.sub_agents.push(OpenCodeSubAgent {
                name: agent.name.clone(),
                enabled: agent.enabled,
                description: agent.description.clone(),
                model: agent.model.clone(),
                instructions: agent.instructions.clone(),
            });
        }

        serde_json::to_string_pretty(&opencode_config)
            .map_err(ConfigError::Json)
    }

    fn validate_command(&self, config_path: &Path) -> Command {
        let mut cmd = Command::new("opencode");
        cmd.arg("--settings").arg(config_path);
        cmd.arg("--version");
        cmd
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_opencode_config() {
        let json = r#"{
            "mcp_servers": [
                {
                    "name": "filesystem",
                    "type": "stdio",
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
                    "enabled": true
                },
                {
                    "name": "custom-api",
                    "type": "sse",
                    "url": "http://localhost:3000",
                    "headers": {
                        "Authorization": "Bearer token"
                    },
                    "enabled": true
                }
            ],
            "skills": [
                {
                    "name": "rust-dev",
                    "enabled": true,
                    "source": "https://example.com/rust.json",
                    "description": "Rust development skills",
                    "author": "test",
                    "version": "1.0.0",
                    "tools": ["cargo", "clippy"]
                }
            ],
            "sub_agents": [
                {
                    "name": "reviewer",
                    "enabled": true,
                    "description": "Code reviewer",
                    "model": "claude-sonnet",
                    "instructions": "Review code for quality"
                }
            ]
        }"#;

        let adapter = OpenCodeAdapter::new();
        let config = adapter.parse_config(json).unwrap();

        assert_eq!(config.mcps.len(), 2);
        assert_eq!(config.mcps[0].name, "filesystem");
        assert!(matches!(
            config.mcps[0].transport,
            McpTransport::Command { .. }
        ));
        assert!(matches!(
            config.mcps[1].transport,
            McpTransport::Url { .. }
        ));

        assert_eq!(config.skills.len(), 1);
        assert_eq!(config.skills[0].name, "rust-dev");
        assert_eq!(config.skills[0].tools.len(), 2);

        assert_eq!(config.sub_agents.len(), 1);
        assert_eq!(config.sub_agents[0].name, "reviewer");
    }

    #[test]
    fn test_serialize_opencode_config() {
        let config = AgentConfig {
            mcps: vec![
                McpServer::new(
                    "test-cmd",
                    McpTransport::command("echo", vec!["hello".to_string()]),
                ),
                McpServer::new(
                    "test-url",
                    McpTransport::url_with_headers(
                        "http://localhost:3000",
                        [("Authorization".to_string(), "token".to_string())]
                            .into_iter()
                            .collect(),
                    ),
                ),
            ],
            skills: vec![Skill {
                name: "my-skill".to_string(),
                enabled: true,
                source: Some("https://example.com".to_string()),
                description: Some("A test skill".to_string()),
                author: Some("test".to_string()),
                version: Some("1.0.0".to_string()),
                tools: vec!["tool1".to_string()],
            }],
            sub_agents: vec![SubAgent {
                name: "reviewer".to_string(),
                enabled: true,
                description: Some("Code reviewer".to_string()),
                model: Some("claude-sonnet".to_string()),
                instructions: Some("Review code".to_string()),
            }],
        };

        let adapter = OpenCodeAdapter::new();
        let json = adapter.serialize_config(&config).unwrap();

        assert!(json.contains("mcp_servers"));
        assert!(json.contains("stdio"));
        assert!(json.contains("sse"));
        assert!(json.contains("skills"));
        assert!(json.contains("sub_agents"));
    }

    #[test]
    fn test_preserves_disabled_state() {
        let config = AgentConfig {
            mcps: vec![McpServer {
                name: "disabled-mcp".to_string(),
                enabled: false,
                transport: McpTransport::command("echo", vec!["test".to_string()]),
            }],
            skills: vec![Skill {
                name: "disabled-skill".to_string(),
                enabled: false,
                source: None,
                description: None,
                author: None,
                version: None,
                tools: vec![],
            }],
            sub_agents: vec![SubAgent {
                name: "disabled-agent".to_string(),
                enabled: false,
                description: None,
                model: None,
                instructions: None,
            }],
        };

        let adapter = OpenCodeAdapter::new();
        let json = adapter.serialize_config(&config).unwrap();

        // Parse back and verify enabled state
        let reparsed = adapter.parse_config(&json).unwrap();
        assert!(!reparsed.mcps[0].enabled);
        assert!(!reparsed.skills[0].enabled);
        assert!(!reparsed.sub_agents[0].enabled);
    }
}
