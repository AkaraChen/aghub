use crate::{
	errors::{ConfigError, Result},
	models::{AgentConfig, McpServer, McpTransport},
};
use std::collections::HashMap;

fn parse_toml(content: &str) -> Result<toml::Value> {
	toml::from_str(content).map_err(|e| {
		ConfigError::InvalidConfig(format!("Failed to parse TOML: {e}"))
	})
}

pub fn parse(content: &str) -> Result<AgentConfig> {
	let doc = parse_toml(content)?;
	let mut config = AgentConfig::new();

	let Some(servers) = doc.get("mcp_servers").and_then(|v| v.as_table())
	else {
		return Ok(config);
	};

	for (name, entry) in servers {
		let table = match entry.as_table() {
			Some(t) => t,
			None => continue,
		};
		let Some(command) = table.get("command").and_then(|v| v.as_str())
		else {
			continue;
		};
		let args = table
			.get("args")
			.and_then(|v| v.as_array())
			.map(|arr| {
				arr.iter()
					.filter_map(|v| v.as_str().map(String::from))
					.collect()
			})
			.unwrap_or_default();
		let env = table
			.get("env")
			.and_then(|v| v.as_table())
			.map(|t| {
				t.iter()
					.filter_map(|(k, v)| {
						v.as_str().map(|s| (k.clone(), s.to_string()))
					})
					.collect::<HashMap<_, _>>()
			})
			.filter(|m| !m.is_empty());

		config.mcps.push(McpServer {
			name: name.clone(),
			enabled: true,
			transport: McpTransport::Stdio {
				command: command.to_string(),
				args,
				env,
				timeout: None,
			},
			timeout: None,
			config_source: None,
		});
	}

	Ok(config)
}

pub fn serialize(
	config: &AgentConfig,
	original_content: Option<&str>,
) -> Result<String> {
	let mut doc = match original_content {
		Some(c) if !c.trim().is_empty() => parse_toml(c)?,
		_ => toml::Value::Table(toml::map::Map::new()),
	};

	let root = doc.as_table_mut().ok_or_else(|| {
		ConfigError::InvalidConfig("root is not a table".into())
	})?;

	// Get or create the mcp_servers table.
	if !root.contains_key("mcp_servers") {
		root.insert(
			"mcp_servers".to_string(),
			toml::Value::Table(toml::map::Map::new()),
		);
	}
	let servers = root
		.get_mut("mcp_servers")
		.and_then(|v| v.as_table_mut())
		.ok_or_else(|| {
			ConfigError::InvalidConfig("mcp_servers is not a table".into())
		})?;

	// Collect the names aghub manages this round.
	let managed: std::collections::HashSet<String> =
		config.mcps.iter().map(|m| m.name.clone()).collect();

	// Remove servers that aghub no longer tracks.
	servers.retain(|name, _| managed.contains(name));

	// Upsert each server: merge aghub fields into existing entry.
	for mcp in &config.mcps {
		if !mcp.enabled {
			servers.remove(&mcp.name);
			continue;
		}
		let McpTransport::Stdio {
			command, args, env, ..
		} = &mcp.transport
		else {
			continue;
		};

		let entry = servers
			.entry(&mcp.name)
			.or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
		let table = match entry.as_table_mut() {
			Some(t) => t,
			None => continue,
		};

		table.insert(
			"command".to_string(),
			toml::Value::String(command.clone()),
		);

		if args.is_empty() {
			table.remove("args");
		} else {
			table.insert(
				"args".to_string(),
				toml::Value::Array(
					args.iter()
						.map(|a| toml::Value::String(a.clone()))
						.collect(),
				),
			);
		}

		match env {
			Some(env_map) if !env_map.is_empty() => {
				let mut env_table = toml::map::Map::new();
				for (k, v) in env_map {
					env_table.insert(k.clone(), toml::Value::String(v.clone()));
				}
				table.insert("env".to_string(), toml::Value::Table(env_table));
			}
			_ => {
				table.remove("env");
			}
		}
	}

	// Remove empty mcp_servers table.
	if servers.is_empty() {
		root.remove("mcp_servers");
	}

	toml::to_string_pretty(&doc)
		.map_err(|e| ConfigError::InvalidConfig(e.to_string()))
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::models::{McpServer, McpTransport};

	#[test]
	fn parse_basic_servers() {
		let content = r#"
model = "o3"

[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]

[mcp_servers.chrome]
command = "/usr/local/bin/chrome-mcp"
env = { DISPLAY = ":0" }
"#;
		let config = parse(content).unwrap();
		assert_eq!(config.mcps.len(), 2);
		let fs = config.mcps.iter().find(|m| m.name == "filesystem").unwrap();
		match &fs.transport {
			McpTransport::Stdio { command, args, .. } => {
				assert_eq!(command, "npx");
				assert_eq!(args.len(), 3);
			}
			_ => panic!("Expected Stdio"),
		}
	}

	#[test]
	fn parse_codex_format_with_type_and_tools() {
		let content = r#"
[mcp_servers.pencil]
type = "stdio"
command = "/path/to/pencil"
args = ["--app", "desktop"]

[mcp_servers.playwright]
command = "npx"
args = ["@playwright/mcp@latest"]

[mcp_servers.playwright.tools.browser_navigate]
approval_mode = "approve"

[mcp_servers.playwright.tools.browser_click]
approval_mode = "approve"
"#;
		let config = parse(content).unwrap();
		assert_eq!(config.mcps.len(), 2);

		let pencil = config.mcps.iter().find(|m| m.name == "pencil").unwrap();
		match &pencil.transport {
			McpTransport::Stdio { command, args, .. } => {
				assert_eq!(command, "/path/to/pencil");
				assert_eq!(args, &["--app", "desktop"]);
			}
			_ => panic!("Expected Stdio"),
		}
	}

	#[test]
	fn roundtrip_preserves_non_mcp_fields() {
		let original = r#"
model_provider = "custom"
model = "gpt-5.4"

[mcp_servers.old]
command = "old-cmd"
"#;
		let config = parse(original).unwrap();
		let mut updated = config;
		updated.mcps.clear();
		updated.mcps.push(McpServer::new(
			"new-mcp",
			McpTransport::stdio("new-cmd", vec![]),
		));
		let output = serialize(&updated, Some(original)).unwrap();
		assert!(output.contains("model_provider"));
		assert!(output.contains("gpt-5.4"));
		assert!(!output.contains("old-cmd"));
		assert!(output.contains("new-mcp"));
	}

	#[test]
	fn roundtrip_preserves_tools_and_type() {
		let original = r#"
[mcp_servers.playwright]
command = "npx"
args = ["@playwright/mcp@latest"]

[mcp_servers.playwright.tools.browser_navigate]
approval_mode = "approve"

[mcp_servers.playwright.tools.browser_click]
approval_mode = "approve"
"#;
		let config = parse(original).unwrap();
		let output = serialize(&config, Some(original)).unwrap();
		assert!(output.contains("browser_navigate"));
		assert!(output.contains("browser_click"));
		assert!(output.contains("approval_mode"));
	}

	#[test]
	fn add_server_preserves_existing_tools() {
		let original = r#"
[mcp_servers.playwright]
command = "npx"
args = ["@playwright/mcp@latest"]

[mcp_servers.playwright.tools.browser_navigate]
approval_mode = "approve"
"#;
		let mut config = parse(original).unwrap();
		config.mcps.push(McpServer::new(
			"new-mcp",
			McpTransport::stdio("new-cmd", vec!["arg1".into()]),
		));
		let output = serialize(&config, Some(original)).unwrap();
		// New server added.
		assert!(output.contains("new-mcp"));
		assert!(output.contains("new-cmd"));
		// Existing tools preserved.
		assert!(output.contains("browser_navigate"));
		assert!(output.contains("approval_mode"));
	}

	#[test]
	fn no_mcp_servers_section_parses_empty() {
		let content = r#"
model = "gpt-5.4"
"#;
		let config = parse(content).unwrap();
		assert!(config.mcps.is_empty());
	}
}
