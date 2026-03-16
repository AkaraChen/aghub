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
    /// Preserve any other fields in the config file
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
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

/// OpenCode MCP transport (supports stdio, SSE, and Streamable HTTP)
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum OpenCodeMcpTransport {
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        env: Option<HashMap<String, String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        timeout: Option<u64>,
    },
    /// Legacy SSE-based transport (deprecated in favor of StreamableHttp)
    Sse {
        url: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        headers: Option<HashMap<String, String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        timeout: Option<u64>,
    },
    /// Streamable HTTP transport (successor to SSE)
    StreamableHttp {
        url: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        headers: Option<HashMap<String, String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        timeout: Option<u64>,
    },
}

/// OpenCode skill configuration
#[derive(Debug, Serialize, Deserialize)]
struct OpenCodeSkill {
    name: String,
    #[serde(default)]
    enabled: bool,
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
            let (transport, timeout) = match mcp.transport {
                OpenCodeMcpTransport::Stdio {
                    command,
                    args,
                    env,
                    timeout,
                } => (
                    McpTransport::Stdio {
                        command,
                        args,
                        env,
                        timeout,
                    },
                    timeout,
                ),
                OpenCodeMcpTransport::Sse {
                    url,
                    headers,
                    timeout,
                } => (
                    McpTransport::Sse {
                        url,
                        headers,
                        timeout,
                    },
                    timeout,
                ),
                OpenCodeMcpTransport::StreamableHttp {
                    url,
                    headers,
                    timeout,
                } => (
                    McpTransport::StreamableHttp {
                        url,
                        headers,
                        timeout,
                    },
                    timeout,
                ),
            };
            config.mcps.push(McpServer {
                name: mcp.name,
                enabled: mcp.enabled,
                transport,
                timeout,
            });
        }

        // Parse skills
        for skill in opencode_config.skills {
            config.skills.push(Skill {
                name: skill.name,
                enabled: skill.enabled,
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

    fn serialize_config(&self, config: &AgentConfig, original_content: Option<&str>) -> Result<String> {
        let mut opencode_config = if let Some(content) = original_content {
            if content.trim().is_empty() {
                OpenCodeConfig::default()
            } else {
                serde_json::from_str::<OpenCodeConfig>(content).map_err(|e| {
                    ConfigError::InvalidConfig(format!("Failed to parse existing OpenCode config: {}", e))
                })?
            }
        } else {
            OpenCodeConfig::default()
        };

        // Clear existing resources to prevent duplication and respect deletions
        opencode_config.mcp_servers.clear();
        opencode_config.skills.clear();
        opencode_config.sub_agents.clear();

        // Serialize MCP servers
        for mcp in &config.mcps {
            let transport = match &mcp.transport {
                McpTransport::Stdio { command, args, env, timeout } => {
                    OpenCodeMcpTransport::Stdio {
                        command: command.clone(),
                        args: args.clone(),
                        env: env.clone(),
                        timeout: *timeout,
                    }
                }
                McpTransport::Sse { url, headers, timeout } => OpenCodeMcpTransport::Sse {
                    url: url.clone(),
                    headers: headers.clone(),
                    timeout: *timeout,
                },
                McpTransport::StreamableHttp { url, headers, timeout } => {
                    OpenCodeMcpTransport::StreamableHttp {
                        url: url.clone(),
                        headers: headers.clone(),
                        timeout: *timeout,
                    }
                }
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

        serde_json::to_string_pretty(&opencode_config).map_err(ConfigError::Json)
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
        assert!(
            matches!(config.mcps[0].transport, McpTransport::Stdio { .. })
        );
        assert!(matches!(config.mcps[1].transport, McpTransport::Sse { .. }));

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
                    McpTransport::stdio("echo", vec!["hello".to_string()]),
                ),
                McpServer::new(
                    "test-sse",
                    McpTransport::sse_with_headers(
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
        let json = adapter.serialize_config(&config, None).unwrap();

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
                transport: McpTransport::stdio("echo", vec!["test".to_string()]),
                timeout: None,
            }],
            skills: vec![Skill {
                name: "disabled-skill".to_string(),
                enabled: false,
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
        let json = adapter.serialize_config(&config, None).unwrap();

        // Parse back and verify enabled state
        let reparsed = adapter.parse_config(&json).unwrap();
        assert!(!reparsed.mcps[0].enabled);
        assert!(!reparsed.skills[0].enabled);
        assert!(!reparsed.sub_agents[0].enabled);
    }

    #[test]
    fn test_preserves_timeout() {
        let config = AgentConfig {
            mcps: vec![
                McpServer {
                    name: "stdio-mcp".to_string(),
                    enabled: true,
                    transport: McpTransport::Stdio {
                        command: "echo".to_string(),
                        args: vec!["hello".to_string()],
                        env: None,
                        timeout: Some(30),
                    },
                    timeout: Some(60),
                },
                McpServer {
                    name: "sse-mcp".to_string(),
                    enabled: true,
                    transport: McpTransport::Sse {
                        url: "http://localhost:3000".to_string(),
                        headers: None,
                        timeout: Some(45),
                    },
                    timeout: Some(90),
                },
            ],
            skills: vec![],
            sub_agents: vec![],
        };

        let adapter = OpenCodeAdapter::new();
        let json = adapter.serialize_config(&config, None).unwrap();

        // Parse back and verify timeout is preserved
        let reparsed = adapter.parse_config(&json).unwrap();

        match &reparsed.mcps[0].transport {
            McpTransport::Stdio { timeout, .. } => assert_eq!(*timeout, Some(30)),
            _ => panic!("Expected Stdio transport"),
        }

        match &reparsed.mcps[1].transport {
            McpTransport::Sse { timeout, .. } => assert_eq!(*timeout, Some(45)),
            _ => panic!("Expected Sse transport"),
        }
    }

    #[test]
    fn test_streamable_http_roundtrip() {
        let config = AgentConfig {
            mcps: vec![McpServer {
                name: "streamable-http-mcp".to_string(),
                enabled: true,
                transport: McpTransport::StreamableHttp {
                    url: "http://localhost:3000/mcp".to_string(),
                    headers: Some([("Authorization".to_string(), "Bearer token".to_string())]
                        .into_iter()
                        .collect()),
                    timeout: Some(60),
                },
                timeout: Some(120),
            }],
            skills: vec![],
            sub_agents: vec![],
        };

        let adapter = OpenCodeAdapter::new();
        let json = adapter.serialize_config(&config, None).unwrap();

        // Verify serialized JSON contains streamable_http type
        assert!(json.contains("\"type\": \"streamable_http\""));
        assert!(json.contains("\"url\": \"http://localhost:3000/mcp\""));

        // Parse back and verify
        let reparsed = adapter.parse_config(&json).unwrap();
        assert_eq!(reparsed.mcps.len(), 1);

        match &reparsed.mcps[0].transport {
            McpTransport::StreamableHttp { url, headers, timeout } => {
                assert_eq!(url, "http://localhost:3000/mcp");
                assert!(headers.is_some());
                assert_eq!(
                    headers.as_ref().unwrap().get("Authorization"),
                    Some(&"Bearer token".to_string())
                );
                assert_eq!(*timeout, Some(60));
            }
            _ => panic!("Expected StreamableHttp transport"),
        }
    }

    #[test]
    fn test_parse_opencode_config_streamable_http() {
        let json = r#"{
            "mcp_servers": [
                {
                    "name": "http-server",
                    "type": "streamable_http",
                    "url": "http://localhost:3000/mcp",
                    "headers": {
                        "Authorization": "Bearer token"
                    },
                    "enabled": true
                }
            ],
            "skills": [],
            "sub_agents": []
        }"#;

        let adapter = OpenCodeAdapter::new();
        let config = adapter.parse_config(json).unwrap();

        assert_eq!(config.mcps.len(), 1);
        assert_eq!(config.mcps[0].name, "http-server");
        assert!(matches!(config.mcps[0].transport, McpTransport::StreamableHttp { .. }));
    }
}
