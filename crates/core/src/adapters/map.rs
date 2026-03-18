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

/// Map-based MCP server configuration
#[derive(Debug, Serialize, Deserialize)]
struct MapMcpServer {
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

/// Load skills from the skills directory, walking recursively.
/// - A directory containing `SKILL.md` is a skill.
/// - A directory without `SKILL.md` but with skill subdirectories is a grouping dir.
/// - Other directories are skipped.
pub(crate) fn load_skills_from_dir(skills_dir: &Path) -> Vec<Skill> {
	let mut skills = Vec::new();
	collect_skills(skills_dir, &mut skills);
	skills.sort_by(|a, b| a.name.cmp(&b.name));
	skills
}

fn collect_skills(dir: &Path, skills: &mut Vec<Skill>) {
	if !dir.exists() {
		return;
	}

	let Ok(entries) = fs::read_dir(dir) else {
		return;
	};

	for entry in entries.flatten() {
		let path = entry.path();
		if !path.is_dir() {
			continue;
		}

		let skill_md_path = path.join("SKILL.md");
		if skill_md_path.exists() {
			// This directory is a skill
			let dir_name =
				path.file_name().and_then(|n| n.to_str()).unwrap_or("");
			if dir_name.is_empty() {
				continue;
			}
			let (display_name, description, author, version) =
				fs::read_to_string(&skill_md_path)
					.ok()
					.and_then(|content| parse_skill_md(&content))
					.map(|meta| {
						(meta.name, meta.description, meta.author, meta.version)
					})
					.unwrap_or_else(|| {
						(dir_name.to_string(), None, None, None)
					});
			skills.push(Skill {
				name: display_name,
				enabled: true,
				description,
				author,
				version,
				tools: Vec::new(),
			});
		} else {
			// No SKILL.md — recurse as a potential grouping directory
			collect_skills(&path, skills);
		}
	}
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

pub struct MapAdapter {
	name: &'static str,
	global_path_fn: fn() -> PathBuf,
	project_path_fn: fn(&Path) -> PathBuf,
	server_key: &'static str,
}

impl MapAdapter {
	pub fn new() -> Self {
		Self {
			name: "claude",
			global_path_fn: crate::paths::claude_global_path,
			project_path_fn: crate::paths::claude_project_path,
			server_key: "mcpServers",
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
			server_key: "mcpServers",
		}
	}

	pub fn with_paths_and_key(
		name: &'static str,
		global_path_fn: fn() -> PathBuf,
		project_path_fn: fn(&Path) -> PathBuf,
		server_key: &'static str,
	) -> Self {
		Self {
			name,
			global_path_fn,
			project_path_fn,
			server_key,
		}
	}
}

impl Default for MapAdapter {
	fn default() -> Self {
		Self::new()
	}
}

impl AgentAdapter for MapAdapter {
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
		let root: serde_json::Value = serde_json::from_str(content)?;

		let mut config = AgentConfig::new();

		// Parse MCP servers using the configured key
		let servers_map = root
			.get(self.server_key)
			.and_then(|v| v.as_object())
			.cloned()
			.unwrap_or_default();

		for (name, mcp_val) in servers_map {
			let mcp: MapMcpServer = serde_json::from_value(mcp_val)
				.unwrap_or_else(|_| MapMcpServer {
					server_type: None,
					command: None,
					args: vec![],
					env: None,
					url: None,
					headers: None,
				});
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
						// Only match /sse as a path segment (e.g. /sse or /sse/events)
						let is_sse = {
							let path = url.split('?').next().unwrap_or(&url);
							path.split('/')
								.any(|seg| seg.eq_ignore_ascii_case("sse"))
						};
						if is_sse {
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
				enabled: true, // Map format doesn't have explicit enabled field
				transport,
				timeout: None,
			});
		}

		// Parse skills from skills directory
		// Note: We use global skills directory for both global and project configs
		// since skills are typically installed globally
		let skills_dir = get_skills_path();
		config.skills = load_skills_from_dir(&skills_dir);

		// Sub-agents are not supported by map-based adapters

		Ok(config)
	}

	fn serialize_config(
		&self,
		config: &AgentConfig,
		original_content: Option<&str>,
	) -> Result<String> {
		// Parse original content as a generic Value to preserve unknown fields
		let mut root: serde_json::Value =
			if let Some(content) = original_content {
				if content.trim().is_empty() {
					serde_json::Value::Object(serde_json::Map::new())
				} else {
					serde_json::from_str(content).map_err(|e| {
						ConfigError::InvalidConfig(format!(
							"Failed to parse existing config: {}",
							e
						))
					})?
				}
			} else {
				serde_json::Value::Object(serde_json::Map::new())
			};

		// Build the servers map using the configured key
		let mut servers_map = serde_json::Map::new();

		for mcp in &config.mcps {
			if !mcp.enabled {
				continue;
			}

			let map_mcp = match &mcp.transport {
				McpTransport::Stdio {
					command, args, env, ..
				} => MapMcpServer {
					server_type: Some("stdio".to_string()),
					command: Some(command.clone()),
					args: args.clone(),
					env: env.clone(),
					url: None,
					headers: None,
				},
				McpTransport::Sse { url, headers, .. } => MapMcpServer {
					server_type: Some("sse".to_string()),
					command: None,
					args: vec![],
					env: None,
					url: Some(url.clone()),
					headers: headers.clone(),
				},
				McpTransport::StreamableHttp { url, headers, .. } => {
					MapMcpServer {
						server_type: Some("http".to_string()),
						command: None,
						args: vec![],
						env: None,
						url: Some(url.clone()),
						headers: headers.clone(),
					}
				}
			};

			servers_map.insert(
				mcp.name.clone(),
				serde_json::to_value(map_mcp).map_err(ConfigError::Json)?,
			);
		}

		// Write the servers map under the configured key
		if let serde_json::Value::Object(ref mut obj) = root {
			obj.insert(
				self.server_key.to_string(),
				serde_json::Value::Object(servers_map),
			);
		}

		// Skills are NOT serialized to settings.json
		// Sub-agents are not serialized for map-based adapters

		serde_json::to_string_pretty(&root).map_err(ConfigError::Json)
	}

	fn validate_command(&self, config_path: &Path) -> Command {
		let mut cmd = Command::new(self.name);
		cmd.arg("--settings").arg(config_path);
		cmd.arg("--version");
		cmd
	}

	fn supports_mcp_enable_disable(&self) -> bool {
		// Map format doesn't preserve MCP enabled state in config
		// Disabled MCPs are simply removed from the config
		false
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::models::SubAgent;

	#[test]
	fn test_parse_map_config_stdio() {
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

		let adapter = MapAdapter::new();
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
	fn test_parse_map_config_sse() {
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

		let adapter = MapAdapter::new();
		let config = adapter.parse_config(json).unwrap();

		assert_eq!(config.mcps.len(), 1);
		let mcp = &config.mcps[0];
		assert_eq!(mcp.name, "remote-server");
		assert!(matches!(mcp.transport, McpTransport::Sse { .. }));
	}

	#[test]
	fn test_parse_map_config_streamable_http() {
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

		let adapter = MapAdapter::new();
		let config = adapter.parse_config(json).unwrap();

		assert_eq!(config.mcps.len(), 1);
		let mcp = &config.mcps[0];
		assert_eq!(mcp.name, "http-server");
		assert!(matches!(mcp.transport, McpTransport::StreamableHttp { .. }));
	}

	#[test]
	fn test_parse_map_config_infers_transport_from_url() {
		let json = r#"{
            "mcpServers": {
                "inferred-http": {
                    "url": "http://localhost:3000/mcp"
                },
                "inferred-sse": {
                    "url": "http://localhost:3001/sse"
                },
                "inferred-sse-sub": {
                    "url": "http://localhost:3002/sse/events"
                },
                "inferred-stream": {
                    "url": "http://localhost:3003/stream/events"
                }
            }
        }"#;

		let adapter = MapAdapter::new();
		let config = adapter.parse_config(json).unwrap();

		assert_eq!(config.mcps.len(), 4);

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

		let sse_sub_mcp = config
			.mcps
			.iter()
			.find(|m| m.name == "inferred-sse-sub")
			.unwrap();
		assert!(matches!(sse_sub_mcp.transport, McpTransport::Sse { .. }));

		// "stream" substring no longer triggers SSE — defaults to StreamableHttp
		let stream_mcp = config
			.mcps
			.iter()
			.find(|m| m.name == "inferred-stream")
			.unwrap();
		assert!(matches!(
			stream_mcp.transport,
			McpTransport::StreamableHttp { .. }
		));
	}

	#[test]
	fn test_parse_map_config_backward_compatible() {
		// Test parsing old format without type field (backward compatibility)
		let json = r#"{
            "mcpServers": {
                "filesystem": {
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
                }
            }
        }"#;

		let adapter = MapAdapter::new();
		let config = adapter.parse_config(json).unwrap();

		assert_eq!(config.mcps.len(), 1);
		assert!(matches!(
			config.mcps[0].transport,
			McpTransport::Stdio { .. }
		));
	}

	#[test]
	fn test_serialize_map_config_stdio() {
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

		let adapter = MapAdapter::new();
		let json = adapter.serialize_config(&config, None).unwrap();

		assert!(json.contains("mcpServers"));
		assert!(json.contains("test"));
		assert!(json.contains("\"type\": \"stdio\""));
		// Skills should NOT be in the serialized output (they're in directory)
		assert!(!json.contains("my-skill"));
		assert!(!json.contains("sub_agents")); // Map format doesn't support this
	}

	#[test]
	fn test_serialize_map_config_sse() {
		let config = AgentConfig {
			mcps: vec![McpServer::new(
				"remote-server",
				McpTransport::sse("http://localhost:3000/sse"),
			)],
			skills: vec![],
			sub_agents: vec![],
		};

		let adapter = MapAdapter::new();
		let json = adapter.serialize_config(&config, None).unwrap();

		assert!(json.contains("mcpServers"));
		assert!(json.contains("remote-server"));
		assert!(json.contains("\"type\": \"sse\""));
		assert!(json.contains("\"url\": \"http://localhost:3000/sse\""));
	}

	#[test]
	fn test_serialize_map_config_streamable_http() {
		// Test that StreamableHttp serializes to type "http"
		let config = AgentConfig {
			mcps: vec![McpServer::new(
				"http-server",
				McpTransport::streamable_http("http://localhost:3000/mcp"),
			)],
			skills: vec![],
			sub_agents: vec![],
		};

		let adapter = MapAdapter::new();
		let json = adapter.serialize_config(&config, None).unwrap();

		assert!(json.contains("\"type\": \"http\""));
		assert!(json.contains("\"url\": \"http://localhost:3000/mcp\""));
	}

	#[test]
	fn test_serialize_map_config_sse_legacy() {
		// Test that legacy Sse still serializes to type "sse"
		let config = AgentConfig {
			mcps: vec![McpServer::new(
				"sse-server",
				McpTransport::sse("http://localhost:3000/sse"),
			)],
			skills: vec![],
			sub_agents: vec![],
		};

		let adapter = MapAdapter::new();
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

		let adapter = MapAdapter::new();
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

	#[test]
	fn test_copilot_uses_servers_key() {
		use crate::paths;
		let adapter = MapAdapter::with_paths_and_key(
			"copilot",
			paths::copilot_global_path,
			paths::copilot_project_path,
			"servers",
		);

		// Parse config with "servers" key
		let json = r#"{
            "servers": {
                "my-mcp": {
                    "type": "stdio",
                    "command": "npx",
                    "args": ["-y", "some-mcp"]
                }
            }
        }"#;
		let config = adapter.parse_config(json).unwrap();
		assert_eq!(config.mcps.len(), 1);
		assert_eq!(config.mcps[0].name, "my-mcp");

		// Serialize back — should use "servers" key, not "mcpServers"
		let out = adapter.serialize_config(&config, Some(json)).unwrap();
		let val: serde_json::Value = serde_json::from_str(&out).unwrap();
		assert!(val.get("servers").is_some());
		assert!(val.get("mcpServers").is_none());
	}

	#[test]
	fn test_recursive_skills_discovery() {
		use std::fs;
		let tmp = tempfile::tempdir().unwrap();
		let root = tmp.path();

		// Direct skill
		let skill_a = root.join("skill-a");
		fs::create_dir_all(&skill_a).unwrap();
		fs::write(
			skill_a.join("SKILL.md"),
			"---\nname: skill-a\ndescription: Direct skill\n---\n",
		)
		.unwrap();

		// Grouping dir containing a skill
		let group = root.join("group");
		fs::create_dir_all(&group).unwrap();
		let skill_b = group.join("skill-b");
		fs::create_dir_all(&skill_b).unwrap();
		fs::write(
			skill_b.join("SKILL.md"),
			"---\nname: skill-b\ndescription: Nested skill\n---\n",
		)
		.unwrap();

		// Stray dir (no SKILL.md, no subdirs with SKILL.md) — should be skipped
		let stray = root.join("stray");
		fs::create_dir_all(&stray).unwrap();

		let skills = load_skills_from_dir(root);
		let names: Vec<&str> = skills.iter().map(|s| s.name.as_str()).collect();
		assert!(names.contains(&"skill-a"), "skill-a not found: {:?}", names);
		assert!(names.contains(&"skill-b"), "skill-b not found: {:?}", names);
		assert_eq!(skills.len(), 2);
	}
}
