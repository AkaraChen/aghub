use crate::{
	errors::Result, format::json_map, models::AgentConfig,
	skills::discovery::load_skills_from_dir,
};
use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::AgentAdapter;

thread_local! {
	static SKILLS_PATH_OVERRIDE: RefCell<Option<PathBuf>> = const { RefCell::new(None) };
}

pub fn set_thread_local_skills_path(path: Option<PathBuf>) {
	SKILLS_PATH_OVERRIDE.with(|p| *p.borrow_mut() = path);
}

fn get_skills_path() -> PathBuf {
	if let Some(path) = SKILLS_PATH_OVERRIDE.with(|p| p.borrow().clone()) {
		return path;
	}
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
		let mut config = json_map::parse(content, self.server_key)?;
		let skills_dir = get_skills_path();
		config.skills = load_skills_from_dir(&skills_dir);
		Ok(config)
	}

	fn serialize_config(
		&self,
		config: &AgentConfig,
		original_content: Option<&str>,
	) -> Result<String> {
		json_map::serialize(config, original_content, self.server_key)
	}

	fn validate_command(&self, config_path: &Path) -> Command {
		let mut cmd = Command::new(self.name);
		cmd.arg("--settings").arg(config_path);
		cmd.arg("--version");
		cmd
	}

	fn supports_mcp_enable_disable(&self) -> bool {
		false
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::models::{McpServer, McpTransport, Skill, SubAgent};

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
                    "env": {"GITHUB_TOKEN": "secret"}
                }
            }
        }"#;
		let adapter = MapAdapter::new();
		let config = adapter.parse_config(json).unwrap();
		assert_eq!(config.mcps.len(), 2);
		let fs = config.mcps.iter().find(|m| m.name == "filesystem").unwrap();
		assert!(matches!(fs.transport, McpTransport::Stdio { .. }));
		let gh = config.mcps.iter().find(|m| m.name == "github").unwrap();
		assert!(matches!(gh.transport, McpTransport::Stdio { .. }));
	}

	#[test]
	fn test_parse_map_config_sse() {
		let json = r#"{"mcpServers": {"remote-server": {"type": "sse", "url": "http://localhost:3000/sse", "headers": {"Authorization": "Bearer token"}}}}"#;
		let adapter = MapAdapter::new();
		let config = adapter.parse_config(json).unwrap();
		assert_eq!(config.mcps.len(), 1);
		assert!(matches!(config.mcps[0].transport, McpTransport::Sse { .. }));
	}

	#[test]
	fn test_parse_map_config_streamable_http() {
		let json = r#"{"mcpServers": {"http-server": {"type": "http", "url": "http://localhost:3000/mcp"}}}"#;
		let adapter = MapAdapter::new();
		let config = adapter.parse_config(json).unwrap();
		assert_eq!(config.mcps.len(), 1);
		assert!(matches!(
			config.mcps[0].transport,
			McpTransport::StreamableHttp { .. }
		));
	}

	#[test]
	fn test_parse_map_config_infers_transport_from_url() {
		let json = r#"{
            "mcpServers": {
                "inferred-http": {"url": "http://localhost:3000/mcp"},
                "inferred-sse": {"url": "http://localhost:3001/sse"},
                "inferred-sse-sub": {"url": "http://localhost:3002/sse/events"},
                "inferred-stream": {"url": "http://localhost:3003/stream/events"}
            }
        }"#;
		let adapter = MapAdapter::new();
		let config = adapter.parse_config(json).unwrap();
		assert_eq!(config.mcps.len(), 4);
		let http = config
			.mcps
			.iter()
			.find(|m| m.name == "inferred-http")
			.unwrap();
		assert!(matches!(
			http.transport,
			McpTransport::StreamableHttp { .. }
		));
		let sse = config
			.mcps
			.iter()
			.find(|m| m.name == "inferred-sse")
			.unwrap();
		assert!(matches!(sse.transport, McpTransport::Sse { .. }));
		let sse_sub = config
			.mcps
			.iter()
			.find(|m| m.name == "inferred-sse-sub")
			.unwrap();
		assert!(matches!(sse_sub.transport, McpTransport::Sse { .. }));
		let stream = config
			.mcps
			.iter()
			.find(|m| m.name == "inferred-stream")
			.unwrap();
		assert!(matches!(
			stream.transport,
			McpTransport::StreamableHttp { .. }
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
				metadata: None,
			}],
			sub_agents: vec![SubAgent::new("agent1")],
		};
		let adapter = MapAdapter::new();
		let json = adapter.serialize_config(&config, None).unwrap();
		assert!(json.contains("mcpServers"));
		assert!(json.contains("test"));
		assert!(json.contains("\"type\": \"stdio\""));
		assert!(!json.contains("my-skill"));
		assert!(!json.contains("sub_agents"));
	}

	#[test]
	fn test_disabled_resources_not_serialized() {
		use crate::models::McpServer;
		let config = AgentConfig {
			mcps: vec![
				McpServer {
					name: "enabled".to_string(),
					enabled: true,
					transport: McpTransport::stdio("echo", vec![]),
					timeout: None,
				},
				McpServer {
					name: "disabled".to_string(),
					enabled: false,
					transport: McpTransport::stdio("echo", vec![]),
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
	fn test_copilot_uses_servers_key() {
		use crate::paths;
		let adapter = MapAdapter::with_paths_and_key(
			"copilot",
			paths::copilot_global_path,
			paths::copilot_project_path,
			"servers",
		);
		let json = r#"{"servers": {"my-mcp": {"type": "stdio", "command": "npx", "args": ["-y", "some-mcp"]}}}"#;
		let config = adapter.parse_config(json).unwrap();
		assert_eq!(config.mcps.len(), 1);
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
		let skill_a = root.join("skill-a");
		fs::create_dir_all(&skill_a).unwrap();
		fs::write(
			skill_a.join("SKILL.md"),
			"---\nname: skill-a\ndescription: Direct skill\n---\n",
		)
		.unwrap();
		let group = root.join("group");
		fs::create_dir_all(&group).unwrap();
		let skill_b = group.join("skill-b");
		fs::create_dir_all(&skill_b).unwrap();
		fs::write(
			skill_b.join("SKILL.md"),
			"---\nname: skill-b\ndescription: Nested skill\n---\n",
		)
		.unwrap();
		let skills = load_skills_from_dir(root);
		let names: Vec<&str> = skills.iter().map(|s| s.name.as_str()).collect();
		assert!(names.contains(&"skill-a"));
		assert!(names.contains(&"skill-b"));
		assert_eq!(skills.len(), 2);
	}
}
