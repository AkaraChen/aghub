use crate::{
	errors::{ConfigError, Result},
	models::{AgentConfig, McpServer, McpTransport},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::AgentAdapter;

// TOML-based configuration structure (used by Codex CLI)
#[derive(Debug, Default, Serialize, Deserialize)]
struct TomlConfig {
	#[serde(default)]
	mcp_servers: HashMap<String, TomlMcpServer>,
	// Preserve all other fields (model, model_provider, projects, etc.)
	#[serde(flatten)]
	extra: toml::map::Map<String, toml::Value>,
}

// TOML MCP server entry (Codex currently only supports stdio)
#[derive(Debug, Serialize, Deserialize)]
struct TomlMcpServer {
	command: String,
	#[serde(default, skip_serializing_if = "Vec::is_empty")]
	args: Vec<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	env: Option<HashMap<String, String>>,
}

pub struct TomlAdapter {
	name: &'static str,
	global_path_fn: fn() -> PathBuf,
	project_path_fn: fn(&Path) -> PathBuf,
}

impl TomlAdapter {
	pub fn new() -> Self {
		Self {
			name: "codex",
			global_path_fn: crate::paths::codex_global_path,
			project_path_fn: crate::paths::codex_project_path,
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

impl Default for TomlAdapter {
	fn default() -> Self {
		Self::new()
	}
}

impl AgentAdapter for TomlAdapter {
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
		let toml_config: TomlConfig = toml::from_str(content).map_err(|e| {
			ConfigError::InvalidConfig(format!(
				"Failed to parse TOML config: {}",
				e
			))
		})?;

		let mut config = AgentConfig::new();

		for (name, server) in toml_config.mcp_servers {
			config.mcps.push(McpServer {
				name,
				enabled: true,
				transport: McpTransport::Stdio {
					command: server.command,
					args: server.args,
					env: server.env,
					timeout: None,
				},
				timeout: None,
			});
		}

		// Load skills from ~/.codex/skills/
		let skills_dir = dirs::home_dir().unwrap().join(".codex/skills");
		config.skills = super::map::load_skills_from_dir(&skills_dir);

		Ok(config)
	}

	fn serialize_config(
		&self,
		config: &AgentConfig,
		original_content: Option<&str>,
	) -> Result<String> {
		let mut toml_config = if let Some(content) = original_content {
			if content.trim().is_empty() {
				TomlConfig::default()
			} else {
				toml::from_str::<TomlConfig>(content).map_err(|e| {
					ConfigError::InvalidConfig(format!(
						"Failed to parse existing config: {}",
						e
					))
				})?
			}
		} else {
			TomlConfig::default()
		};

		toml_config.mcp_servers.clear();

		for mcp in &config.mcps {
			if !mcp.enabled {
				continue;
			}

			if let McpTransport::Stdio {
				command, args, env, ..
			} = &mcp.transport
			{
				toml_config.mcp_servers.insert(
					mcp.name.clone(),
					TomlMcpServer {
						command: command.clone(),
						args: args.clone(),
						env: env.clone(),
					},
				);
			}
			// SSE/HTTP transports are not supported in TOML format (Codex limitation)
		}

		toml::to_string_pretty(&toml_config)
			.map_err(|e| ConfigError::InvalidConfig(e.to_string()))
	}

	fn validate_command(&self, config_path: &Path) -> Command {
		let mut cmd = Command::new(self.name);
		cmd.arg("--config").arg(config_path);
		cmd.arg("--version");
		cmd
	}

	fn supports_mcp_enable_disable(&self) -> bool {
		// TOML format doesn't have explicit enabled field
		false
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_parse_toml_config() {
		let content = r#"
model = "o3"

[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]

[mcp_servers.chrome]
command = "/usr/local/bin/chrome-mcp"
env = { DISPLAY = ":0" }
"#;

		let adapter = TomlAdapter::new();
		let config = adapter.parse_config(content).unwrap();

		assert_eq!(config.mcps.len(), 2);

		let fs_mcp =
			config.mcps.iter().find(|m| m.name == "filesystem").unwrap();
		match &fs_mcp.transport {
			McpTransport::Stdio { command, args, .. } => {
				assert_eq!(command, "npx");
				assert_eq!(args.len(), 3);
			}
			_ => panic!("Expected Stdio transport"),
		}

		let chrome_mcp =
			config.mcps.iter().find(|m| m.name == "chrome").unwrap();
		match &chrome_mcp.transport {
			McpTransport::Stdio { command, env, .. } => {
				assert_eq!(command, "/usr/local/bin/chrome-mcp");
				assert!(env.is_some());
			}
			_ => panic!("Expected Stdio transport"),
		}
	}

	#[test]
	fn test_serialize_toml_config() {
		let config = AgentConfig {
			mcps: vec![McpServer::new(
				"test",
				McpTransport::stdio("echo", vec!["hello".to_string()]),
			)],
			skills: vec![],
			sub_agents: vec![],
		};

		let adapter = TomlAdapter::new();
		let output = adapter.serialize_config(&config, None).unwrap();

		assert!(output.contains("[mcp_servers.test]"));
		assert!(output.contains("command = \"echo\""));
		assert!(output.contains("\"hello\""));
	}

	#[test]
	fn test_roundtrip_preserves_extra_fields() {
		let original = r#"
model_provider = "custom"
model = "gpt-5.4"

[model_providers.custom]
name = "custom"
base_url = "https://api.example.com"

[mcp_servers.old]
command = "old-cmd"

[projects."/home/user"]
trust_level = "trusted"
"#;

		let adapter = TomlAdapter::new();
		let config = adapter.parse_config(original).unwrap();

		assert_eq!(config.mcps.len(), 1);
		assert_eq!(config.mcps[0].name, "old");

		// Replace with new MCP
		let mut updated = config;
		updated.mcps.clear();
		updated.mcps.push(McpServer::new(
			"new-mcp",
			McpTransport::stdio("new-cmd", vec![]),
		));

		let output =
			adapter.serialize_config(&updated, Some(original)).unwrap();

		// Extra fields should be preserved
		assert!(output.contains("model_provider"));
		assert!(output.contains("gpt-5.4"));
		assert!(output.contains("model_providers"));
		assert!(output.contains("trust_level"));
		// Old MCP should be gone, new one present
		assert!(!output.contains("[mcp_servers.old]"));
		assert!(output.contains("[mcp_servers.new-mcp]"));
	}

	#[test]
	fn test_disabled_mcp_not_serialized() {
		let config = AgentConfig {
			mcps: vec![
				McpServer {
					name: "enabled".to_string(),
					enabled: true,
					transport: McpTransport::stdio("cmd1", vec![]),
					timeout: None,
				},
				McpServer {
					name: "disabled".to_string(),
					enabled: false,
					transport: McpTransport::stdio("cmd2", vec![]),
					timeout: None,
				},
			],
			skills: vec![],
			sub_agents: vec![],
		};

		let adapter = TomlAdapter::new();
		let output = adapter.serialize_config(&config, None).unwrap();

		assert!(output.contains("enabled"));
		assert!(!output.contains("disabled"));
	}
}
