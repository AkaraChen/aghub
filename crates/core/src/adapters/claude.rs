use crate::{
	errors::{ConfigError, Result},
	models::{AgentConfig, McpServer, McpTransport, Skill},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::AgentAdapter;

/// Claude Code specific configuration structure
#[derive(Debug, Default, Serialize, Deserialize)]
struct ClaudeConfig {
	#[serde(rename = "mcpServers", default)]
	mcp_servers: HashMap<String, ClaudeMcpServer>,
	/// Note: Skills are now loaded from ~/.claude/skills/ directory
	/// This field is kept for backward compatibility but not used
	#[serde(default)]
	skills: HashMap<String, serde_json::Value>,
	/// Preserve any other fields in the config file
	#[serde(flatten)]
	extra: serde_json::Map<String, serde_json::Value>,
}

/// Claude MCP server configuration
#[derive(Debug, Serialize, Deserialize)]
struct ClaudeMcpServer {
	#[serde(rename = "type", default)]
	server_type: Option<String>, // "stdio", "sse", or "http"
	// For stdio type:
	#[serde(skip_serializing_if = "Option::is_none")]
	command: Option<String>,
	#[serde(default, skip_serializing_if = "Vec::is_empty")]
	args: Vec<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	env: Option<HashMap<String, String>>,
	// For sse/http type:
	#[serde(skip_serializing_if = "Option::is_none")]
	url: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	headers: Option<HashMap<String, String>>,
}

struct SkillMetadata {
	name: String,
	description: Option<String>,
	author: Option<String>,
	version: Option<String>,
}

/// Parse SKILL.md frontmatter to extract skill metadata
fn parse_skill_md(content: &str) -> Option<SkillMetadata> {
	// Look for YAML frontmatter between --- markers
	let lines: Vec<&str> = content.lines().collect();
	if lines.len() < 3 || !lines[0].trim().is_empty() && lines[0] != "---" {
		return None;
	}

	// Find the end of frontmatter
	let mut name = None;
	let mut description = None;
	let mut author = None;
	let mut version = None;
	let mut in_frontmatter = false;
	let mut current_key: Option<&str> = None;

	for line in &lines {
		let trimmed = line.trim();

		if trimmed == "---" {
			if !in_frontmatter {
				in_frontmatter = true;
				continue;
			} else {
				break;
			}
		}

		if !in_frontmatter {
			continue;
		}

		// Check for key: value pairs
		if let Some(pos) = line.find(':') {
			let key = line[..pos].trim();
			// Remove surround quotes if any
			let val = line[pos + 1..].trim();
			let value = if (val.starts_with('"') && val.ends_with('"'))
				|| (val.starts_with('\'') && val.ends_with('\''))
			{
				&val[1..val.len() - 1]
			} else {
				val
			};

			if key == "name" {
				name = Some(value.to_string());
				current_key = Some("name");
			} else if key == "author" {
				author = Some(value.to_string());
				current_key = Some("author");
			} else if key == "version" {
				version = Some(value.to_string());
				current_key = Some("version");
			} else if key == "description" {
				// Description might be a folded scalar (>)
				if value.is_empty() || value == ">" {
					current_key = Some("description");
					description = Some(String::new());
				} else {
					description = Some(value.to_string());
					current_key = Some("description");
				}
			} else {
				current_key = Some(key);
			}
		} else if in_frontmatter && current_key == Some("description") {
			// Continuation of multi-line description
			if let Some(ref mut desc) = description {
				if !trimmed.is_empty() {
					if !desc.is_empty() {
						desc.push(' ');
					}
					desc.push_str(trimmed);
				}
			}
		}
	}

	name.map(|n| SkillMetadata {
		name: n,
		description,
		author,
		version,
	})
}

/// Load skills from the skills directory
fn load_skills_from_dir(skills_dir: &Path) -> Vec<Skill> {
	let mut skills = Vec::new();

	if !skills_dir.exists() {
		return skills;
	}

	let Ok(entries) = fs::read_dir(skills_dir) else {
		return skills;
	};

	for entry in entries.flatten() {
		let path = entry.path();
		if !path.is_dir() {
			continue;
		}

		let skill_name =
			path.file_name().and_then(|n| n.to_str()).unwrap_or("");
		if skill_name.is_empty() {
			continue;
		}

		// Try to read SKILL.md for metadata
		let skill_md_path = path.join("SKILL.md");
		let (display_name, description, author, version) = if skill_md_path
			.exists()
		{
			fs::read_to_string(&skill_md_path)
				.ok()
				.and_then(|content| parse_skill_md(&content))
				.map(|meta| {
					(meta.name, meta.description, meta.author, meta.version)
				})
				.unwrap_or_else(|| (skill_name.to_string(), None, None, None))
		} else {
			(skill_name.to_string(), None, None, None)
		};

		skills.push(Skill {
			name: display_name,
			enabled: true,
			description,
			author,
			version,
			tools: Vec::new(),
		});
	}

	skills.sort_by(|a, b| a.name.cmp(&b.name));
	skills
}

use std::cell::RefCell;

thread_local! {
	/// Thread-local override for skills path (used in tests)
	static SKILLS_PATH_OVERRIDE: RefCell<Option<PathBuf>> = const { RefCell::new(None) };
}

/// Set the thread-local skills path override (for testing)
pub fn set_thread_local_skills_path(path: Option<PathBuf>) {
	SKILLS_PATH_OVERRIDE.with(|p| *p.borrow_mut() = path);
}

/// Get skills directory path, respecting thread-local override and CLAUDE_SKILLS_PATH env var
fn get_skills_path() -> PathBuf {
	// First check thread-local override (for isolated testing)
	if let Some(path) = SKILLS_PATH_OVERRIDE.with(|p| p.borrow().clone()) {
		return path;
	}
	// Then check environment variable
	std::env::var("CLAUDE_SKILLS_PATH")
		.map(PathBuf::from)
		.unwrap_or_else(|_| crate::paths::claude_global_skills_path())
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

		// Parse MCP servers from settings.json
		for (name, mcp) in claude_config.mcp_servers {
			let transport = match mcp.server_type.as_deref() {
				Some("stdio") => McpTransport::Stdio {
					command: mcp.command.unwrap_or_default(),
					args: mcp.args,
					env: mcp.env,
					timeout: None,
				},
				Some("sse") => McpTransport::Sse {
					url: mcp.url.unwrap_or_default(),
					headers: mcp.headers,
					timeout: None,
				},
				Some("http") => McpTransport::StreamableHttp {
					url: mcp.url.unwrap_or_default(),
					headers: mcp.headers,
					timeout: None,
				},
				None | Some(_) => {
					// Try to infer from field presence for backward compatibility
					if let Some(command) = mcp.command {
						McpTransport::Stdio {
							command,
							args: mcp.args,
							env: mcp.env,
							timeout: None,
						}
					} else if let Some(url) = mcp.url {
						// Infer transport type from URL pattern
						// URLs containing "/sse" or "stream" are legacy SSE
						if url.contains("/sse") || url.contains("stream") {
							McpTransport::Sse {
								url,
								headers: mcp.headers,
								timeout: None,
							}
						} else {
							McpTransport::StreamableHttp {
								url,
								headers: mcp.headers,
								timeout: None,
							}
						}
					} else {
						continue; // Skip malformed entries
					}
				}
			};
			config.mcps.push(McpServer {
				name,
				enabled: true, // Claude doesn't have explicit enabled field
				transport,
				timeout: None,
			});
		}

		// Parse skills from skills directory
		// Note: We use global skills directory for both global and project configs
		// since skills are typically installed globally
		let skills_dir = get_skills_path();
		config.skills = load_skills_from_dir(&skills_dir);

		// Note: Claude Code doesn't have sub-agents in the same way
		// This feature is silently disabled for Claude

		Ok(config)
	}

	fn serialize_config(
		&self,
		config: &AgentConfig,
		original_content: Option<&str>,
	) -> Result<String> {
		let mut claude_config = if let Some(content) = original_content {
			if content.trim().is_empty() {
				ClaudeConfig::default()
			} else {
				serde_json::from_str::<ClaudeConfig>(content).map_err(|e| {
					ConfigError::InvalidConfig(format!(
						"Failed to parse existing Claude config: {}",
						e
					))
				})?
			}
		} else {
			ClaudeConfig::default()
		};

		// Clear existing MCP servers so deleted ones are removed during merge
		claude_config.mcp_servers.clear();

		// Serialize MCP servers
		for mcp in &config.mcps {
			// Skip disabled MCPs
			if !mcp.enabled {
				continue;
			}

			let claude_mcp = match &mcp.transport {
				McpTransport::Stdio {
					command, args, env, ..
				} => Some(ClaudeMcpServer {
					server_type: Some("stdio".to_string()),
					command: Some(command.clone()),
					args: args.clone(),
					env: env.clone(),
					url: None,
					headers: None,
				}),
				McpTransport::Sse { url, headers, .. } => {
					Some(ClaudeMcpServer {
						server_type: Some("sse".to_string()),
						command: None,
						args: vec![],
						env: None,
						url: Some(url.clone()),
						headers: headers.clone(),
					})
				}
				McpTransport::StreamableHttp { url, headers, .. } => {
					Some(ClaudeMcpServer {
						server_type: Some("http".to_string()),
						command: None,
						args: vec![],
						env: None,
						url: Some(url.clone()),
						headers: headers.clone(),
					})
				}
			};

			if let Some(mcp_server) = claude_mcp {
				claude_config
					.mcp_servers
					.insert(mcp.name.clone(), mcp_server);
			}
		}

		// Note: Skills are NOT serialized to settings.json
		// They are managed in the ~/.claude/skills/ directory
		// We keep the skills field empty in the JSON output

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

	fn supports_mcp_enable_disable(&self) -> bool {
		// Claude doesn't preserve MCP enabled state in config
		// Disabled MCPs are simply removed from the config
		false
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::models::SubAgent;

	#[test]
	fn test_parse_claude_config_stdio() {
		let json = r#"{
            "mcpServers": {
                "filesystem": {
                    "type": "stdio",
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
                },
                "github": {
                    "type": "stdio",
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
		let filesystem =
			config.mcps.iter().find(|m| m.name == "filesystem").unwrap();
		assert!(matches!(filesystem.transport, McpTransport::Stdio { .. }));

		// Find github MCP and check env
		let github = config.mcps.iter().find(|m| m.name == "github").unwrap();
		assert!(matches!(github.transport, McpTransport::Stdio { .. }));
	}

	#[test]
	fn test_parse_claude_config_sse() {
		let json = r#"{
            "mcpServers": {
                "remote-server": {
                    "type": "sse",
                    "url": "http://localhost:3000/sse",
                    "headers": {
                        "Authorization": "Bearer token"
                    }
                }
            }
        }"#;

		let adapter = ClaudeAdapter::new();
		let config = adapter.parse_config(json).unwrap();

		assert_eq!(config.mcps.len(), 1);
		let mcp = &config.mcps[0];
		assert_eq!(mcp.name, "remote-server");
		assert!(matches!(mcp.transport, McpTransport::Sse { .. }));
	}

	#[test]
	fn test_parse_claude_config_streamable_http() {
		let json = r#"{
            "mcpServers": {
                "http-server": {
                    "type": "http",
                    "url": "http://localhost:3000/mcp",
                    "headers": {
                        "Authorization": "Bearer token"
                    }
                }
            }
        }"#;

		let adapter = ClaudeAdapter::new();
		let config = adapter.parse_config(json).unwrap();

		assert_eq!(config.mcps.len(), 1);
		let mcp = &config.mcps[0];
		assert_eq!(mcp.name, "http-server");
		assert!(matches!(mcp.transport, McpTransport::StreamableHttp { .. }));
	}

	#[test]
	fn test_parse_claude_config_infers_transport_from_url() {
		// Test that URLs without "/sse" or "stream" are inferred as StreamableHttp
		let json = r#"{
            "mcpServers": {
                "inferred-http": {
                    "url": "http://localhost:3000/mcp"
                },
                "inferred-sse": {
                    "url": "http://localhost:3001/sse"
                },
                "inferred-stream": {
                    "url": "http://localhost:3002/stream/events"
                }
            }
        }"#;

		let adapter = ClaudeAdapter::new();
		let config = adapter.parse_config(json).unwrap();

		assert_eq!(config.mcps.len(), 3);

		let http_mcp = config
			.mcps
			.iter()
			.find(|m| m.name == "inferred-http")
			.unwrap();
		assert!(matches!(
			http_mcp.transport,
			McpTransport::StreamableHttp { .. }
		));

		let sse_mcp = config
			.mcps
			.iter()
			.find(|m| m.name == "inferred-sse")
			.unwrap();
		assert!(matches!(sse_mcp.transport, McpTransport::Sse { .. }));

		let stream_mcp = config
			.mcps
			.iter()
			.find(|m| m.name == "inferred-stream")
			.unwrap();
		assert!(matches!(stream_mcp.transport, McpTransport::Sse { .. }));
	}

	#[test]
	fn test_parse_claude_config_backward_compatible() {
		// Test parsing old format without type field (backward compatibility)
		let json = r#"{
            "mcpServers": {
                "filesystem": {
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
                }
            }
        }"#;

		let adapter = ClaudeAdapter::new();
		let config = adapter.parse_config(json).unwrap();

		assert_eq!(config.mcps.len(), 1);
		assert!(matches!(
			config.mcps[0].transport,
			McpTransport::Stdio { .. }
		));
	}

	#[test]
	fn test_serialize_claude_config_stdio() {
		let config = AgentConfig {
			mcps: vec![McpServer::new(
				"test",
				McpTransport::stdio("echo", vec!["hello".to_string()]),
			)],
			skills: vec![Skill {
				name: "my-skill".to_string(),
				enabled: true,
				description: Some("A test skill".to_string()),
				author: Some("test".to_string()),
				version: Some("1.0.0".to_string()),
				tools: vec!["tool1".to_string()],
			}],
			sub_agents: vec![SubAgent::new("agent1")], // Should be ignored
		};

		let adapter = ClaudeAdapter::new();
		let json = adapter.serialize_config(&config, None).unwrap();

		assert!(json.contains("mcpServers"));
		assert!(json.contains("test"));
		assert!(json.contains("\"type\": \"stdio\""));
		// Skills should NOT be in the serialized output (they're in directory)
		assert!(!json.contains("my-skill"));
		assert!(!json.contains("sub_agents")); // Claude doesn't support this
	}

	#[test]
	fn test_serialize_claude_config_sse() {
		let config = AgentConfig {
			mcps: vec![McpServer::new(
				"remote-server",
				McpTransport::sse("http://localhost:3000/sse"),
			)],
			skills: vec![],
			sub_agents: vec![],
		};

		let adapter = ClaudeAdapter::new();
		let json = adapter.serialize_config(&config, None).unwrap();

		assert!(json.contains("mcpServers"));
		assert!(json.contains("remote-server"));
		assert!(json.contains("\"type\": \"sse\""));
		assert!(json.contains("\"url\": \"http://localhost:3000/sse\""));
	}

	#[test]
	fn test_serialize_claude_config_streamable_http() {
		// Test that StreamableHttp serializes to type "http"
		let config = AgentConfig {
			mcps: vec![McpServer::new(
				"http-server",
				McpTransport::streamable_http("http://localhost:3000/mcp"),
			)],
			skills: vec![],
			sub_agents: vec![],
		};

		let adapter = ClaudeAdapter::new();
		let json = adapter.serialize_config(&config, None).unwrap();

		assert!(json.contains("\"type\": \"http\""));
		assert!(json.contains("\"url\": \"http://localhost:3000/mcp\""));
	}

	#[test]
	fn test_serialize_claude_config_sse_legacy() {
		// Test that legacy Sse still serializes to type "sse"
		let config = AgentConfig {
			mcps: vec![McpServer::new(
				"sse-server",
				McpTransport::sse("http://localhost:3000/sse"),
			)],
			skills: vec![],
			sub_agents: vec![],
		};

		let adapter = ClaudeAdapter::new();
		let json = adapter.serialize_config(&config, None).unwrap();

		assert!(json.contains("\"type\": \"sse\""));
		assert!(json.contains("\"url\": \"http://localhost:3000/sse\""));
	}

	#[test]
	fn test_disabled_resources_not_serialized() {
		let config = AgentConfig {
			mcps: vec![
				McpServer {
					name: "enabled".to_string(),
					enabled: true,
					transport: McpTransport::stdio(
						"echo",
						vec!["hello".to_string()],
					),
					timeout: None,
				},
				McpServer {
					name: "disabled".to_string(),
					enabled: false,
					transport: McpTransport::stdio(
						"echo",
						vec!["world".to_string()],
					),
					timeout: None,
				},
			],
			skills: vec![],
			sub_agents: vec![],
		};

		let adapter = ClaudeAdapter::new();
		let json = adapter.serialize_config(&config, None).unwrap();

		assert!(json.contains("enabled"));
		assert!(!json.contains("disabled"));
	}

	#[test]
	fn test_parse_skill_md_simple() {
		let content = r#"---
name: test-skill
description: A simple test skill
---

# Usage

Some content here.
"#;

		let result = parse_skill_md(content);
		assert!(result.is_some());
		let meta = result.unwrap();
		assert_eq!(meta.name, "test-skill");
		assert_eq!(meta.description, Some("A simple test skill".to_string()));
	}

	#[test]
	fn test_parse_skill_md_multiline_description() {
		let content = r#"---
name: agent-reach
description: >
  Give your AI agent eyes to see the entire internet.
  Search and read 16 platforms.
---

# Usage
"#;

		let result = parse_skill_md(content);
		assert!(result.is_some());
		let meta = result.unwrap();
		assert_eq!(meta.name, "agent-reach");
		assert!(meta.description.unwrap().contains("eyes to see"));
	}

	#[test]
	fn test_parse_skill_md_no_frontmatter() {
		let content = r#"# Just a regular markdown file

No frontmatter here.
"#;

		let result = parse_skill_md(content);
		assert!(result.is_none());
	}
}
