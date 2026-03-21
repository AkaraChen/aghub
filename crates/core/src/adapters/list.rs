use crate::{
	errors::Result,
	format::{json_list, json_opencode},
	models::AgentConfig,
};
use std::path::{Path, PathBuf};
use std::process::Command;

use super::AgentAdapter;

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

fn is_opencode_native(content: &str) -> bool {
	serde_json::from_str::<serde_json::Value>(content)
		.ok()
		.and_then(|v| v.get("mcp").cloned())
		.map(|v| v.is_object())
		.unwrap_or(false)
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
		if is_opencode_native(content) {
			return json_opencode::parse(content);
		}
		json_list::parse(content)
	}

	fn serialize_config(
		&self,
		config: &AgentConfig,
		original_content: Option<&str>,
	) -> Result<String> {
		if original_content.map(is_opencode_native).unwrap_or(false) {
			return json_opencode::serialize(config, original_content);
		}
		json_list::serialize(config, original_content)
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
	use crate::models::{McpServer, McpTransport, Skill, SubAgent};

	#[test]
	fn test_parse_list_config() {
		let json = r#"{
            "mcp_servers": [
                {"name": "filesystem", "type": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"], "enabled": true},
                {"name": "custom-api", "type": "sse", "url": "http://localhost:3000", "headers": {"Authorization": "Bearer token"}, "enabled": true}
            ],
            "skills": [{"name": "rust-dev", "enabled": true, "description": "Rust development skills", "author": "test", "version": "1.0.0", "tools": ["cargo", "clippy"]}],
            "sub_agents": [{"name": "reviewer", "enabled": true, "description": "Code reviewer", "model": "claude-sonnet", "instructions": "Review code for quality"}]
        }"#;
		let adapter = ListAdapter::new();
		let config = adapter.parse_config(json).unwrap();
		assert_eq!(config.mcps.len(), 2);
		assert_eq!(config.skills.len(), 1);
		assert_eq!(config.sub_agents.len(), 1);
	}

	#[test]
	fn test_opencode_native_roundtrip() {
		let original = r#"{
            "$schema": "https://opencode.ai/config.json",
            "mcp": {
                "local-srv": {"type": "local", "command": ["npx", "-y", "some-mcp"], "environment": {"TOKEN": "abc"}, "enabled": true},
                "remote-srv": {"type": "remote", "url": "https://api.example.com/mcp", "headers": {"X-Key": "val"}, "enabled": true}
            }
        }"#;
		let adapter = ListAdapter::new();
		let config = adapter.parse_config(original).unwrap();
		assert_eq!(config.mcps.len(), 2);
		let out = adapter.serialize_config(&config, Some(original)).unwrap();
		let val: serde_json::Value = serde_json::from_str(&out).unwrap();
		assert_eq!(
			val.get("$schema").and_then(|v| v.as_str()),
			Some("https://opencode.ai/config.json")
		);
		assert!(val.get("mcp").is_some());
		assert!(val.get("mcp_servers").is_none());
	}

	#[test]
	fn test_preserves_disabled_state() {
		let config = AgentConfig {
			mcps: vec![McpServer {
				name: "disabled-mcp".to_string(),
				enabled: false,
				transport: McpTransport::stdio("echo", vec![]),
				timeout: None,
			}],
			skills: vec![Skill {
				name: "disabled-skill".to_string(),
				enabled: false,
				description: None,
				author: None,
				version: None,
				tools: vec![],
				metadata: None,
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
		let reparsed = adapter.parse_config(&json).unwrap();
		assert!(!reparsed.mcps[0].enabled);
		assert!(!reparsed.skills[0].enabled);
		assert!(!reparsed.sub_agents[0].enabled);
	}
}
