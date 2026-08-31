use crate::{
	errors::{ConfigError, Result},
	models::{AgentConfig, McpServer, McpTransport},
};
use serde::Deserialize;
use std::collections::HashMap;
use toml_edit::{value, Array, DocumentMut, Item, Table};

#[derive(Deserialize)]
struct TomlMcpEntry {
	command: Option<String>,
	url: Option<String>,
	#[serde(default)]
	args: Vec<String>,
	env: Option<HashMap<String, String>>,
	http_headers: Option<HashMap<String, String>>,
	#[serde(default = "crate::models::default_true")]
	enabled: bool,
}

fn parse_toml(content: &str) -> Result<toml::Value> {
	toml::from_str(content).map_err(|error| {
		ConfigError::InvalidConfig(format!("Failed to parse TOML: {error}"))
	})
}

pub fn parse(content: &str) -> Result<AgentConfig> {
	let doc = parse_toml(content)?;
	let mut config = AgentConfig::new();
	let Some(value) = doc.get("mcp_servers") else {
		return Ok(config);
	};
	let servers = value.as_table().ok_or_else(|| {
		ConfigError::InvalidConfig("mcp_servers must be a table".into())
	})?;
	for (name, entry) in servers {
		if entry.get("command").is_none() && entry.get("url").is_none() {
			continue;
		}
		let mcp: TomlMcpEntry = entry.clone().try_into().map_err(|error| {
			ConfigError::InvalidConfig(format!("MCP '{name}': {error}"))
		})?;
		let transport = match (mcp.command, mcp.url) {
			(Some(command), None) => McpTransport::Stdio {
				command,
				args: mcp.args,
				env: mcp.env,
				timeout: None,
			},
			(None, Some(url)) => McpTransport::StreamableHttp {
				url,
				headers: mcp.http_headers,
				timeout: None,
			},
			_ => {
				return Err(ConfigError::InvalidConfig(format!(
					"MCP '{name}' requires exactly one of command or url"
				)))
			}
		};
		let mut server = McpServer::new(name, transport);
		server.enabled = mcp.enabled;
		server.source_name = Some(name.clone());
		config.mcps.push(server);
	}
	Ok(config)
}

pub fn serialize(
	config: &AgentConfig,
	original: Option<&str>,
) -> Result<String> {
	let content = original.unwrap_or("");
	let previous = parse(content)?;
	let mut doc = content.parse::<DocumentMut>().map_err(|error| {
		ConfigError::InvalidConfig(format!("Failed to parse TOML: {error}"))
	})?;
	if !doc.contains_key("mcp_servers") {
		doc.insert("mcp_servers", Item::Table(Table::new()));
	}
	let servers = doc["mcp_servers"].as_table_like_mut().ok_or_else(|| {
		ConfigError::InvalidConfig("mcp_servers must be a table".into())
	})?;
	let originals: HashMap<_, _> = servers
		.iter()
		.map(|(name, entry)| (name.to_string(), entry.clone()))
		.collect();
	for old in &previous.mcps {
		if !config.mcps.iter().any(|mcp| mcp.name == old.name) {
			servers.remove(&old.name);
		}
	}
	for mcp in &config.mcps {
		let source_name = mcp.source_name.as_deref().unwrap_or(&mcp.name);
		let old = previous.mcps.iter().find(|old| old.name == source_name);
		if originals.contains_key(&mcp.name)
			&& (source_name != mcp.name || old.is_none())
		{
			return Err(ConfigError::resource_exists("MCP server", &mcp.name));
		}
		let mut item = originals
			.get(source_name)
			.cloned()
			.unwrap_or_else(|| Item::Table(Table::new()));
		let entry = item.as_table_like_mut().ok_or_else(|| {
			ConfigError::InvalidConfig(format!(
				"MCP '{}' must be a table",
				mcp.name
			))
		})?;
		if old.map(|server| &server.transport) != Some(&mcp.transport) {
			match &mcp.transport {
				McpTransport::Stdio {
					command, args, env, ..
				} => {
					for key in ["url", "http_headers"] {
						entry.remove(key);
					}
					entry.insert("command", value(command));
					if args.is_empty() {
						entry.remove("args");
					} else {
						let args: Array =
							args.iter().map(String::as_str).collect();
						entry.insert("args", value(args));
					}
					if let Some(env) = env {
						let mut table = Table::new();
						for (key, val) in env {
							table.insert(key, value(val));
						}
						entry.insert("env", Item::Table(table));
					} else {
						entry.remove("env");
					}
				}
				McpTransport::StreamableHttp { url, headers, .. } => {
					for key in ["command", "args", "env"] {
						entry.remove(key);
					}
					entry.insert("url", value(url));
					if let Some(headers) = headers {
						let mut table = Table::new();
						for (key, val) in headers {
							table.insert(key, value(val));
						}
						entry.insert("http_headers", Item::Table(table));
					} else {
						entry.remove("http_headers");
					}
				}
				McpTransport::Sse { .. } => {
					return Err(ConfigError::UnsupportedOperation(
						"TOML MCP configuration does not support legacy SSE"
							.into(),
					))
				}
			}
		}
		if (entry.contains_key("enabled") || !mcp.enabled)
			&& old.map(|server| server.enabled) != Some(mcp.enabled)
		{
			entry.insert("enabled", value(mcp.enabled));
		}
		servers.insert(&mcp.name, item);
	}
	if servers.is_empty() {
		doc.remove("mcp_servers");
	}
	Ok(doc.to_string())
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::models::{McpServer, McpTransport};

	#[test]
	fn codex_http_edit_retains_auth_and_tool_policy() {
		let original = r#"
# user's model choice
model = "gpt-5.4"
[mcp_servers.github]
url = "https://example.test/mcp"
enabled = false
bearer_token_env_var = "GITHUB_TOKEN"
env_http_headers = { "X-Tenant" = "TENANT" }
http_headers = { "X-Version" = "1" }
startup_timeout_sec = 15.5
tool_timeout_sec = 60
required = true
[mcp_servers.github.tools.delete]
approval_mode = "approve"
"#;
		let mut config = parse(original).unwrap();
		assert_eq!(config.mcps.len(), 1);
		assert!(!config.mcps[0].enabled);
		assert!(
			matches!(&config.mcps[0].transport, McpTransport::StreamableHttp { headers: Some(headers), .. } if headers["X-Version"] == "1")
		);
		config.mcps[0].enabled = true;
		let output = serialize(&config, Some(original)).unwrap();
		let before = parse_toml(original).unwrap();
		let after = parse_toml(&output).unwrap();
		assert_eq!(
			after["mcp_servers"]["github"]["enabled"].as_bool(),
			Some(true)
		);
		for key in [
			"url",
			"bearer_token_env_var",
			"env_http_headers",
			"http_headers",
			"startup_timeout_sec",
			"tool_timeout_sec",
			"required",
			"tools",
		] {
			assert_eq!(
				after["mcp_servers"]["github"][key],
				before["mcp_servers"]["github"][key]
			);
		}
		assert!(output.contains("# user's model choice"));
	}

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

	#[test]
	fn editing_stdio_preserves_unparsed_servers() {
		let original = r#"
[mcp_servers.remote]
url = "https://mcp.example.test/mcp"
bearer_token_env_var = "MCP_TOKEN"
enabled = false

[mcp_servers.remote.oauth]
client_id = "example-client"

[mcp_servers.unsupported]
custom_transport = "future"

[mcp_servers.local]
command = "old-command"
"#;
		let mut config = parse(original).unwrap();
		assert_eq!(config.mcps.len(), 2);
		config.mcps.retain(|mcp| mcp.name != "local");
		config.mcps.push(McpServer::new(
			"replacement",
			McpTransport::stdio("new-command", vec![]),
		));
		let output = serialize(&config, Some(original)).unwrap();
		let before = parse_toml(original).unwrap();
		let after = parse_toml(&output).unwrap();
		assert_eq!(
			after["mcp_servers"]["remote"],
			before["mcp_servers"]["remote"]
		);
		assert_eq!(
			after["mcp_servers"]["unsupported"],
			before["mcp_servers"]["unsupported"]
		);
		assert!(after["mcp_servers"].get("local").is_none());
		assert_eq!(
			after["mcp_servers"]["replacement"]["command"].as_str(),
			Some("new-command")
		);
	}
}
