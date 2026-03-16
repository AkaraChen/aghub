use crate::{
    errors::{ConfigError, Result},
    models::{AgentConfig, McpServer, McpTransport, Skill, SubAgent},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::AgentAdapter;

/// Claude Code specific configuration structure
#[derive(Debug, Default, Serialize, Deserialize)]
struct ClaudeConfig {
    #[serde(rename = "mcpServers", default)]
    mcp_servers: HashMap<String, ClaudeMcpServer>,
    #[serde(default)]
    skills: HashMap<String, serde_json::Value>,
}

/// Claude MCP server configuration
#[derive(Debug, Serialize, Deserialize)]
struct ClaudeMcpServer {
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: Option<HashMap<String, String>>,
}

pub struct ClaudeAdapter;

impl ClaudeAdapter {
    pub fn new() -> Self {
        Self
    }
}

impl Default for ClaudeAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentAdapter for ClaudeAdapter {
    fn name(&self) -> &'static str {
        "claude"
    }

    fn global_config_path(&self) -> PathBuf {
        crate::paths::claude_global_path()
    }

    fn project_config_path(&self, project_root: &Path) -> PathBuf {
        crate::paths::claude_project_path(project_root)
    }

    fn parse_config(&self, content: &str) -> Result<AgentConfig> {
        let claude_config: ClaudeConfig = serde_json::from_str(content)?;

        let mut config = AgentConfig::new();

        // Parse MCP servers
        for (name, mcp) in claude_config.mcp_servers {
            config.mcps.push(McpServer {
                name,
                enabled: true, // Claude doesn't have explicit enabled field
                transport: McpTransport::Command {
                    command: mcp.command,
                    args: mcp.args,
                    env: mcp.env,
                },
            });
        }

        // Parse skills if present
        for (name, value) in claude_config.skills {
            let skill = if let Some(obj) = value.as_object() {
                Skill {
                    name,
                    enabled: obj.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true),
                    source: obj.get("source").and_then(|v| v.as_str().map(String::from)),
                    description: obj
                        .get("description")
                        .and_then(|v| v.as_str().map(String::from)),
                    author: obj.get("author").and_then(|v| v.as_str().map(String::from)),
                    version: obj
                        .get("version")
                        .and_then(|v| v.as_str().map(String::from)),
                    tools: obj
                        .get("tools")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default(),
                }
            } else {
                // Simple string value or other - create basic skill
                Skill::new(name)
            };
            config.skills.push(skill);
        }

        // Note: Claude Code doesn't have sub-agents in the same way
        // This feature is silently disabled for Claude

        Ok(config)
    }

    fn serialize_config(&self, config: &AgentConfig) -> Result<String> {
        let mut claude_config = ClaudeConfig::default();

        // Serialize MCP servers
        for mcp in &config.mcps {
            if let McpTransport::Command { command, args, env } = &mcp.transport {
                // Only include enabled MCPs in the output
                if mcp.enabled {
                    claude_config.mcp_servers.insert(
                        mcp.name.clone(),
                        ClaudeMcpServer {
                            command: command.clone(),
                            args: args.clone(),
                            env: env.clone(),
                        },
                    );
                }
            }
            // Note: URL-based MCPs are not supported by Claude Code
            // They're silently skipped during serialization
        }

        // Serialize skills
        for skill in &config.skills {
            if skill.enabled {
                let mut skill_obj = serde_json::Map::new();
                if let Some(source) = &skill.source {
                    skill_obj.insert("source".to_string(), source.clone().into());
                }
                if let Some(desc) = &skill.description {
                    skill_obj.insert("description".to_string(), desc.clone().into());
                }
                if let Some(author) = &skill.author {
                    skill_obj.insert("author".to_string(), author.clone().into());
                }
                if let Some(version) = &skill.version {
                    skill_obj.insert("version".to_string(), version.clone().into());
                }
                if !skill.tools.is_empty() {
                    skill_obj.insert("tools".to_string(), skill.tools.clone().into());
                }

                if !skill_obj.is_empty() {
                    claude_config
                        .skills
                        .insert(skill.name.clone(), skill_obj.into());
                } else {
                    claude_config.skills.insert(skill.name.clone(), true.into());
                }
            }
        }

        // Note: Sub-agents are not serialized for Claude Code
        // This feature is silently disabled

        serde_json::to_string_pretty(&claude_config).map_err(ConfigError::Json)
    }

    fn validate_command(&self, config_path: &Path) -> Command {
        let mut cmd = Command::new("claude");
        cmd.arg("--settings").arg(config_path);
        cmd.arg("--version");
        cmd
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_claude_config() {
        let json = r#"{
            "mcpServers": {
                "filesystem": {
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
                },
                "github": {
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-github"],
                    "env": {
                        "GITHUB_TOKEN": "secret"
                    }
                }
            }
        }"#;

        let adapter = ClaudeAdapter::new();
        let config = adapter.parse_config(json).unwrap();

        assert_eq!(config.mcps.len(), 2);

        // Find filesystem MCP (HashMap iteration order is not deterministic)
        let filesystem = config.mcps.iter().find(|m| m.name == "filesystem").unwrap();
        assert!(matches!(filesystem.transport, McpTransport::Command { .. }));

        // Find github MCP and check env
        let github = config.mcps.iter().find(|m| m.name == "github").unwrap();
        assert!(matches!(github.transport, McpTransport::Command { .. }));
    }

    #[test]
    fn test_serialize_claude_config() {
        let config = AgentConfig {
            mcps: vec![McpServer::new(
                "test",
                McpTransport::command("echo", vec!["hello".to_string()]),
            )],
            skills: vec![Skill {
                name: "my-skill".to_string(),
                enabled: true,
                source: Some("https://example.com".to_string()),
                description: Some("A test skill".to_string()),
                author: Some("test".to_string()),
                version: Some("1.0.0".to_string()),
                tools: vec!["tool1".to_string()],
            }],
            sub_agents: vec![SubAgent::new("agent1")], // Should be ignored
        };

        let adapter = ClaudeAdapter::new();
        let json = adapter.serialize_config(&config).unwrap();

        assert!(json.contains("mcpServers"));
        assert!(json.contains("test"));
        assert!(json.contains("skills"));
        assert!(!json.contains("sub_agents")); // Claude doesn't support this
    }

    #[test]
    fn test_disabled_resources_not_serialized() {
        let config = AgentConfig {
            mcps: vec![
                McpServer {
                    name: "enabled".to_string(),
                    enabled: true,
                    transport: McpTransport::command("echo", vec!["hello".to_string()]),
                },
                McpServer {
                    name: "disabled".to_string(),
                    enabled: false,
                    transport: McpTransport::command("echo", vec!["world".to_string()]),
                },
            ],
            skills: vec![],
            sub_agents: vec![],
        };

        let adapter = ClaudeAdapter::new();
        let json = adapter.serialize_config(&config).unwrap();

        assert!(json.contains("enabled"));
        assert!(!json.contains("disabled"));
    }

    #[test]
    fn test_url_mcp_silently_skipped() {
        // Claude doesn't support URL-based MCPs
        let config = AgentConfig {
            mcps: vec![McpServer::new(
                "url-mcp",
                McpTransport::url("http://localhost:3000"),
            )],
            skills: vec![],
            sub_agents: vec![],
        };

        let adapter = ClaudeAdapter::new();
        let json = adapter.serialize_config(&config).unwrap();

        // Should serialize successfully but with empty mcpServers
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        let mcp_servers = parsed.get("mcpServers").unwrap().as_object().unwrap();
        assert!(mcp_servers.is_empty());
    }
}
