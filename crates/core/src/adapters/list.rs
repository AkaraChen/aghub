use crate::{
	errors::{ConfigError, Result},
	models::{AgentConfig, McpServer, McpTransport, Skill, SubAgent},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::AgentAdapter;

/// List-based JSON configuration structure
#[derive(Debug, Default, Serialize, Deserialize)]
struct ListConfig {
	#[serde(rename = "mcp_servers", default)]
	mcp_servers: Vec<ListMcpServer>,
	#[serde(default)]
	skills: Vec<ListSkill>,
	#[serde(rename = "sub_agents", default)]
	sub_agents: Vec<ListSubAgent>,
	/// Preserve any other fields in the config file
	#[serde(flatten)]
	extra: serde_json::Map<String, serde_json::Value>,
}

/// List-based MCP server configuration
#[derive(Debug, Serialize, Deserialize)]
struct ListMcpServer {
	name: String,
	#[serde(flatten)]
	transport: ListMcpTransport,
	#[serde(default)]
	enabled: bool,
}

/// List-based MCP transport (supports stdio, SSE, and Streamable HTTP)
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ListMcpTransport {
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

/// List-based skill configuration
#[derive(Debug, Serialize, Deserialize)]
struct ListSkill {
	name: String,
	#[serde(default)]
	enabled: bool,
	description: Option<String>,
	author: Option<String>,
	version: Option<String>,
	#[serde(default)]
	tools: Vec<String>,
}

/// List-based sub-agent configuration
#[derive(Debug, Serialize, Deserialize)]
struct ListSubAgent {
	name: String,
	#[serde(default)]
	enabled: bool,
	description: Option<String>,
	model: Option<String>,
	instructions: Option<String>,
}

pub struct ListAdapter {
	name: &'static str,
	global_path_fn: fn() -> PathBuf,
	project_path_fn: fn(&Path) -> PathBuf,
}

impl ListAdapter {
	pub fn new() -> Self {
		Self {
			name: "opencode",
			global_path_fn: crate::paths::opencode_global_path,
			project_path_fn: crate::paths::opencode_project_path,
		}
	}

	pub fn with_paths(
		name: &'static str,
		global_path_fn: fn() -> PathBuf,
		project_path_fn: fn(&Path) -> PathBuf,
	) -> Self {
		Self {
			name,
			global_path_fn,
			project_path_fn,
		}
	}
}

impl Default for ListAdapter {
	fn default() -> Self {
		Self::new()
	}
}

impl AgentAdapter for ListAdapter {
	fn name(&self) -> &'static str {
		self.name
	}

	fn global_config_path(&self) -> PathBuf {
		(self.global_path_fn)()
	}

	fn project_config_path(&self, project_root: &Path) -> PathBuf {
		(self.project_path_fn)(project_root)
	}

	fn parse_config(&self, content: &str) -> Result<AgentConfig> {
		let list_config: ListConfig = serde_json::from_str(content)?;

		let mut config = AgentConfig::new();

		// Parse MCP servers
		for mcp in list_config.mcp_servers {
			let (transport, timeout) = match mcp.transport {
				ListMcpTransport::Stdio {
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
				ListMcpTransport::Sse {
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
				ListMcpTransport::StreamableHttp {
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
		for skill in list_config.skills {
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
		for agent in list_config.sub_agents {
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

	fn serialize_config(
		&self,
		config: &AgentConfig,
		original_content: Option<&str>,
	) -> Result<String> {
		let mut list_config = if let Some(content) = original_content {
			if content.trim().is_empty() {
				ListConfig::default()
			} else {
				serde_json::from_str::<ListConfig>(content).map_err(|e| {
					ConfigError::InvalidConfig(format!(
						"Failed to parse existing config: {}",
						e
					))
				})?
			}
		} else {
			ListConfig::default()
		};

		// Clear existing resources to prevent duplication and respect deletions
		list_config.mcp_servers.clear();
		list_config.skills.clear();
		list_config.sub_agents.clear();

		// Serialize MCP servers
		for mcp in &config.mcps {
			let transport = match &mcp.transport {
				McpTransport::Stdio {
					command,
					args,
					env,
					timeout,
				} => ListMcpTransport::Stdio {
					command: command.clone(),
					args: args.clone(),
					env: env.clone(),
					timeout: *timeout,
				},
				McpTransport::Sse {
					url,
					headers,
					timeout,
				} => ListMcpTransport::Sse {
					url: url.clone(),
					headers: headers.clone(),
					timeout: *timeout,
				},
				McpTransport::StreamableHttp {
					url,
					headers,
					timeout,
				} => ListMcpTransport::StreamableHttp {
					url: url.clone(),
					headers: headers.clone(),
					timeout: *timeout,
				},
			};
			list_config.mcp_servers.push(ListMcpServer {
				name: mcp.name.clone(),
				transport,
				enabled: mcp.enabled,
			});
		}

		// Serialize skills
		for skill in &config.skills {
			list_config.skills.push(ListSkill {
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
			list_config.sub_agents.push(ListSubAgent {
				name: agent.name.clone(),
				enabled: agent.enabled,
				description: agent.description.clone(),
				model: agent.model.clone(),
				instructions: agent.instructions.clone(),
			});
		}

		serde_json::to_string_pretty(&list_config).map_err(ConfigError::Json)
	}

	fn validate_command(&self, config_path: &Path) -> Command {
		let mut cmd = Command::new(self.name);
		cmd.arg("--settings").arg(config_path);
		cmd.arg("--version");
		cmd
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_parse_list_config() {
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

		let adapter = ListAdapter::new();
		let config = adapter.parse_config(json).unwrap();

		assert_eq!(config.mcps.len(), 2);
		assert_eq!(config.mcps[0].name, "filesystem");
		assert!(matches!(
			config.mcps[0].transport,
			McpTransport::Stdio { .. }
		));
		assert!(matches!(config.mcps[1].transport, McpTransport::Sse { .. }));

		assert_eq!(config.skills.len(), 1);
		assert_eq!(config.skills[0].name, "rust-dev");
		assert_eq!(config.skills[0].tools.len(), 2);

		assert_eq!(config.sub_agents.len(), 1);
		assert_eq!(config.sub_agents[0].name, "reviewer");
	}

	#[test]
	fn test_serialize_list_config() {
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

		let adapter = ListAdapter::new();
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
				transport: McpTransport::stdio(
					"echo",
					vec!["test".to_string()],
				),
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

		let adapter = ListAdapter::new();
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

		let adapter = ListAdapter::new();
		let json = adapter.serialize_config(&config, None).unwrap();

		// Parse back and verify timeout is preserved
		let reparsed = adapter.parse_config(&json).unwrap();

		match &reparsed.mcps[0].transport {
			McpTransport::Stdio { timeout, .. } => {
				assert_eq!(*timeout, Some(30))
			}
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
					headers: Some(
						[(
							"Authorization".to_string(),
							"Bearer token".to_string(),
						)]
						.into_iter()
						.collect(),
					),
					timeout: Some(60),
				},
				timeout: Some(120),
			}],
			skills: vec![],
			sub_agents: vec![],
		};

		let adapter = ListAdapter::new();
		let json = adapter.serialize_config(&config, None).unwrap();

		// Verify serialized JSON contains streamable_http type
		assert!(json.contains("\"type\": \"streamable_http\""));
		assert!(json.contains("\"url\": \"http://localhost:3000/mcp\""));

		// Parse back and verify
		let reparsed = adapter.parse_config(&json).unwrap();
		assert_eq!(reparsed.mcps.len(), 1);

		match &reparsed.mcps[0].transport {
			McpTransport::StreamableHttp {
				url,
				headers,
				timeout,
			} => {
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
	fn test_parse_list_config_streamable_http() {
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

		let adapter = ListAdapter::new();
		let config = adapter.parse_config(json).unwrap();

		assert_eq!(config.mcps.len(), 1);
		assert_eq!(config.mcps[0].name, "http-server");
		assert!(matches!(
			config.mcps[0].transport,
			McpTransport::StreamableHttp { .. }
		));
	}
}
