use crate::{
	errors::{ConfigError, Result},
	models::{AgentConfig, McpServer, McpTransport},
};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
struct MapMcpServer {
	#[serde(rename = "type")]
	server_type: Option<String>,
	command: Option<String>,
	#[serde(default)]
	args: Vec<String>,
	env: Option<HashMap<String, String>>,
	url: Option<String>,
	#[serde(rename = "httpUrl")]
	http_url: Option<String>,
	#[serde(rename = "serverUrl")]
	server_url: Option<String>,
	headers: Option<HashMap<String, String>>,
	enabled: Option<bool>,
	disabled: Option<bool>,
}

#[derive(Clone, Copy)]
enum JsonMcpDialect {
	Standard,
	Gemini,
	Copilot,
}

fn parse_root(content: &str) -> Result<Map<String, Value>> {
	aghub_json::parse_jsonc_opt(content)
		.map(|root| root.unwrap_or_default())
		.map_err(|error| ConfigError::InvalidConfig(error.to_string()))
}

fn server_map<'a>(
	root: &'a Map<String, Value>,
	key: &str,
) -> Result<Option<&'a Map<String, Value>>> {
	root.get(key)
		.map(|value| {
			value.as_object().ok_or_else(|| {
				ConfigError::InvalidConfig(format!("{key} must be an object"))
			})
		})
		.transpose()
}

fn parse_entry(
	name: &str,
	value: &Value,
	dialect: JsonMcpDialect,
) -> Result<Option<McpServer>> {
	if let Some(kind) = value.get("type").and_then(Value::as_str) {
		if !matches!(
			kind,
			"stdio"
				| "local" | "sse"
				| "http" | "streamable-http"
				| "streamableHttp"
		) {
			return Ok(None);
		}
	}
	let mcp: MapMcpServer =
		serde_json::from_value(value.clone()).map_err(|error| {
			ConfigError::InvalidConfig(format!("MCP '{name}': {error}"))
		})?;
	let transport = match mcp.server_type.as_deref() {
		Some("stdio" | "local") => McpTransport::Stdio {
			command: mcp.command.ok_or_else(|| {
				ConfigError::InvalidConfig(format!(
					"MCP '{name}' requires command"
				))
			})?,
			args: mcp.args,
			env: mcp.env,
			timeout: None,
		},
		Some("sse" | "http" | "streamable-http" | "streamableHttp") => {
			let url = mcp.url.or(mcp.http_url).or(mcp.server_url).ok_or_else(
				|| {
					ConfigError::InvalidConfig(format!(
						"MCP '{name}' requires a URL"
					))
				},
			)?;
			if mcp.server_type.as_deref() == Some("sse") {
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
		}
		_ => {
			if let Some(url) = mcp.http_url.or(mcp.server_url) {
				McpTransport::StreamableHttp {
					url,
					headers: mcp.headers,
					timeout: None,
				}
			} else if let Some(url) = mcp.url {
				if matches!(dialect, JsonMcpDialect::Gemini) {
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
			} else if let Some(command) = mcp.command {
				McpTransport::Stdio {
					command,
					args: mcp.args,
					env: mcp.env,
					timeout: None,
				}
			} else {
				return Ok(None);
			}
		}
	};
	let mut server = McpServer::new(name, transport);
	server.source_name = Some(name.to_string());
	server.enabled =
		mcp.enabled.unwrap_or(true) && !mcp.disabled.unwrap_or(false);
	Ok(Some(server))
}

fn parse_dialect(
	content: &str,
	server_key: &str,
	dialect: JsonMcpDialect,
) -> Result<AgentConfig> {
	let root = parse_root(content)?;
	let mut config = AgentConfig::new();
	if let Some(servers) = server_map(&root, server_key)? {
		for (name, value) in servers {
			if let Some(server) = parse_entry(name, value, dialect)? {
				config.mcps.push(server);
			}
		}
	}
	Ok(config)
}

pub fn parse(content: &str, server_key: &str) -> Result<AgentConfig> {
	parse_dialect(content, server_key, JsonMcpDialect::Standard)
}

pub fn parse_gemini(content: &str) -> Result<AgentConfig> {
	parse_dialect(content, "mcpServers", JsonMcpDialect::Gemini)
}

pub fn serialize_gemini(
	config: &AgentConfig,
	original: Option<&str>,
) -> Result<String> {
	serialize_dialect(config, original, "mcpServers", JsonMcpDialect::Gemini)
}

pub fn parse_copilot(content: &str) -> Result<AgentConfig> {
	let root = parse_root(content)?;
	if root.contains_key("mcpServers") {
		return parse_dialect(content, "mcpServers", JsonMcpDialect::Copilot);
	}
	let mut config = AgentConfig::new();
	for (name, value) in &root {
		if let Some(server) = parse_entry(name, value, JsonMcpDialect::Copilot)?
		{
			config.mcps.push(server);
		}
	}
	Ok(config)
}

pub fn serialize_copilot(
	config: &AgentConfig,
	original: Option<&str>,
) -> Result<String> {
	let original_root = parse_root(original.unwrap_or(""))?;
	let uses_bare_map = if original_root.contains_key("mcpServers") {
		false
	} else {
		original_root
			.iter()
			.try_fold(false, |found, (name, value)| {
				parse_entry(name, value, JsonMcpDialect::Copilot)
					.map(|entry| found || entry.is_some())
			})?
	};
	if !uses_bare_map {
		return serialize_dialect(
			config,
			original,
			"mcpServers",
			JsonMcpDialect::Copilot,
		);
	}

	let synthetic = serde_json::json!({ "mcpServers": original_root });
	let updated = serialize_dialect(
		config,
		Some(&synthetic.to_string()),
		"mcpServers",
		JsonMcpDialect::Copilot,
	)?;
	let updated_root = parse_root(&updated)?;
	let servers = server_map(&updated_root, "mcpServers")?
		.cloned()
		.unwrap_or_default();
	aghub_json::patch_jsonc_object(original, &servers)
		.map_err(|error| ConfigError::InvalidConfig(error.to_string()))
}

pub fn serialize(
	config: &AgentConfig,
	original: Option<&str>,
	server_key: &str,
) -> Result<String> {
	serialize_dialect(config, original, server_key, JsonMcpDialect::Standard)
}

fn serialize_dialect(
	config: &AgentConfig,
	original: Option<&str>,
	server_key: &str,
	dialect: JsonMcpDialect,
) -> Result<String> {
	let mut root = parse_root(original.unwrap_or(""))?;
	let original_servers =
		server_map(&root, server_key)?.cloned().unwrap_or_default();
	let mut servers = original_servers.clone();
	for (name, value) in &original_servers {
		if parse_entry(name, value, dialect)?.is_some()
			&& !config.mcps.iter().any(|mcp| mcp.name == *name)
		{
			servers.remove(name);
		}
	}
	for mcp in &config.mcps {
		let source_name = mcp.source_name.as_deref().unwrap_or(&mcp.name);
		if let Some(existing) = original_servers.get(&mcp.name) {
			if source_name != mcp.name
				|| parse_entry(&mcp.name, existing, dialect)?.is_none()
			{
				return Err(ConfigError::resource_exists(
					"MCP server",
					&mcp.name,
				));
			}
		}
		let source = original_servers.get(source_name);
		let previous = source
			.map(|value| parse_entry(source_name, value, dialect))
			.transpose()?
			.flatten();
		let mut entry = source
			.and_then(Value::as_object)
			.cloned()
			.unwrap_or_default();
		if !mcp.enabled
			&& !entry.contains_key("disabled")
			&& !entry.contains_key("enabled")
		{
			servers.remove(&mcp.name);
			continue;
		}
		if previous.as_ref().map(|server| &server.transport)
			!= Some(&mcp.transport)
		{
			let same_transport = previous.as_ref().is_some_and(|server| {
				std::mem::discriminant(&server.transport)
					== std::mem::discriminant(&mcp.transport)
			});
			let native_type = entry.get("type").cloned();
			let url_key = if matches!(dialect, JsonMcpDialect::Gemini) {
				match mcp.transport {
					McpTransport::StreamableHttp { .. } => "httpUrl",
					_ => "url",
				}
			} else if entry.contains_key("serverUrl") {
				"serverUrl"
			} else if same_transport && entry.contains_key("httpUrl") {
				"httpUrl"
			} else {
				"url"
			};
			for key in [
				"type",
				"command",
				"args",
				"env",
				"url",
				"httpUrl",
				"serverUrl",
				"headers",
			] {
				if key == "env"
					&& same_transport
					&& !matches!(mcp.transport, McpTransport::Stdio { .. })
				{
					continue;
				}
				entry.remove(key);
			}
			let kind = match &mcp.transport {
				McpTransport::Stdio {
					command, args, env, ..
				} => {
					entry.insert(
						"command".into(),
						Value::String(command.clone()),
					);
					if !args.is_empty() {
						entry
							.insert("args".into(), serde_json::to_value(args)?);
					}
					if let Some(env) = env {
						entry.insert("env".into(), serde_json::to_value(env)?);
					}
					if matches!(dialect, JsonMcpDialect::Copilot) {
						"local"
					} else {
						"stdio"
					}
				}
				McpTransport::Sse { url, headers, .. }
				| McpTransport::StreamableHttp { url, headers, .. } => {
					entry.insert(url_key.into(), Value::String(url.clone()));
					if let Some(headers) = headers {
						entry.insert(
							"headers".into(),
							serde_json::to_value(headers)?,
						);
					}
					if matches!(mcp.transport, McpTransport::Sse { .. }) {
						"sse"
					} else {
						"http"
					}
				}
			};
			if !matches!(dialect, JsonMcpDialect::Gemini) {
				if same_transport {
					if let Some(native_type) = native_type {
						entry.insert("type".into(), native_type);
					}
				} else {
					entry.insert("type".into(), Value::String(kind.into()));
				}
			}
		}
		if entry.contains_key("disabled") {
			entry.insert("disabled".into(), Value::Bool(!mcp.enabled));
		}
		if entry.contains_key("enabled") {
			entry.insert("enabled".into(), Value::Bool(mcp.enabled));
		}
		servers.insert(mcp.name.clone(), Value::Object(entry));
	}
	root.insert(server_key.to_string(), Value::Object(servers));
	aghub_json::patch_jsonc_object(original, &root)
		.map_err(|error| ConfigError::InvalidConfig(error.to_string()))
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::models::{McpServer, McpTransport, Skill};

	#[test]
	fn url_edit_keeps_native_type_and_remote_environment() {
		for kind in ["streamableHttp", "streamable-http"] {
			let original = serde_json::json!({"mcpServers": {
				"remote": {"type": kind, "url": "https://example.test/mcp", "env": {"ACCOUNT": "work"}}
			}}).to_string();
			let mut config = parse(&original, "mcpServers").unwrap();
			config.mcps[0].transport =
				McpTransport::streamable_http("https://example.test/updated");
			let output =
				serialize(&config, Some(&original), "mcpServers").unwrap();
			let after: Value = serde_json::from_str(&output).unwrap();
			assert_eq!(after["mcpServers"]["remote"]["type"], kind);
			assert_eq!(after["mcpServers"]["remote"]["env"]["ACCOUNT"], "work");
		}
	}

	#[test]
	fn gemini_uses_native_transport_keys_and_keeps_auth() {
		let original = r#"{
			// Native request timeout is in milliseconds
			"mcpServers": {
				"http": {"httpUrl":"https://example.test/sse", "timeout":5000, "oauth":{"enabled":true,"scopes":["read"]}},
				"events": {"url":"https://example.test/events"}
			}
		}"#;
		let mut config = parse_gemini(original).unwrap();
		let http = config
			.mcps
			.iter_mut()
			.find(|mcp| mcp.name == "http")
			.unwrap();
		assert!(matches!(
			http.transport,
			McpTransport::StreamableHttp { .. }
		));
		http.transport =
			McpTransport::streamable_http("https://example.test/updated");
		assert!(matches!(
			config
				.mcps
				.iter()
				.find(|mcp| mcp.name == "events")
				.unwrap()
				.transport,
			McpTransport::Sse { .. }
		));
		let output = serialize_gemini(&config, Some(original)).unwrap();
		let after: Value =
			aghub_json::parse_jsonc_opt(&output).unwrap().unwrap();
		assert_eq!(
			after["mcpServers"]["http"]["httpUrl"],
			"https://example.test/updated"
		);
		assert!(after["mcpServers"]["http"].get("url").is_none());
		assert!(after["mcpServers"]["http"].get("type").is_none());
		assert_eq!(after["mcpServers"]["http"]["timeout"], 5000);
		assert_eq!(after["mcpServers"]["http"]["oauth"]["enabled"], true);
		assert!(output.contains("// Native request timeout"));
	}

	#[test]
	fn amp_literal_key_is_read_and_written_without_moving_other_settings() {
		let original = r#"{"amp.mcpServers":{"local":{"command":"node","cwd":"/project","custom":42}},"amp.mode":"smart"}"#;
		let mut config = parse(original, "amp.mcpServers").unwrap();
		assert_eq!(config.mcps.len(), 1);
		config.mcps[0].name = "renamed".into();
		let output =
			serialize(&config, Some(original), "amp.mcpServers").unwrap();
		let after: Value = serde_json::from_str(&output).unwrap();
		assert_eq!(after["amp.mcpServers"]["renamed"]["cwd"], "/project");
		assert_eq!(after["amp.mcpServers"]["renamed"]["custom"], 42);
		assert!(after["amp.mcpServers"].get("local").is_none());
		assert!(after.get("amp").is_none());
		assert_eq!(after["amp.mode"], "smart");
	}

	#[test]
	fn adding_cannot_replace_an_unrecognized_entry() {
		let original = r#"{"mcpServers":{"socket":{"type":"ws","url":"ws://localhost:3000"}}}"#;
		let mut config = parse(original, "mcpServers").unwrap();
		config.mcps.push(McpServer::new(
			"socket",
			McpTransport::stdio("node", vec![]),
		));
		assert!(serialize(&config, Some(original), "mcpServers").is_err());
	}

	#[test]
	fn editing_preserves_native_options_and_unknown_servers() {
		let original = r#"{
			"mcpServers": {
				"remote": {
					"type": "http", "url": "https://example.test/mcp",
					"oauth": {"clientId": "public-client"},
					"headersHelper": "get-headers", "disabledTools": ["delete"]
				},
				"socket": {"type": "ws", "url": "ws://localhost:3000"},
				"future": {"customTransport": {"endpoint": "local"}}
			}
		}"#;
		let mut config = parse(original, "mcpServers").unwrap();
		assert_eq!(config.mcps.len(), 1);
		config.mcps[0].transport =
			McpTransport::streamable_http("https://example.test/updated");
		let output = serialize(&config, Some(original), "mcpServers").unwrap();
		let after: serde_json::Value = serde_json::from_str(&output).unwrap();
		let before: serde_json::Value = serde_json::from_str(original).unwrap();
		for name in ["socket", "future"] {
			assert_eq!(after["mcpServers"][name], before["mcpServers"][name]);
		}
		for key in ["oauth", "headersHelper", "disabledTools"] {
			assert_eq!(
				after["mcpServers"]["remote"][key],
				before["mcpServers"]["remote"][key]
			);
		}
		assert_eq!(
			after["mcpServers"]["remote"]["url"],
			"https://example.test/updated"
		);
	}

	#[test]
	fn disabled_native_entry_survives_an_unrelated_save() {
		let original = r#"{"mcpServers":{"local":{"command":"node","disabled":true,"autoApprove":["read"]}}}"#;
		let config = parse(original, "mcpServers").unwrap();
		assert!(!config.mcps[0].enabled);
		let output = serialize(&config, Some(original), "mcpServers").unwrap();
		let after: serde_json::Value = serde_json::from_str(&output).unwrap();
		assert_eq!(after["mcpServers"]["local"]["disabled"], true);
		assert_eq!(after["mcpServers"]["local"]["autoApprove"][0], "read");
	}

	#[test]
	fn malformed_known_fields_cannot_be_silently_rewritten() {
		let original =
			r#"{"mcpServers":{"local":{"command":"node","env":{"TOKEN":42}}}}"#;
		assert!(parse(original, "mcpServers").is_err());
	}

	#[test]
	fn test_parse_stdio() {
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
		let config = parse(json, "mcpServers").unwrap();
		assert_eq!(config.mcps.len(), 2);
		let fs = config.mcps.iter().find(|m| m.name == "filesystem").unwrap();
		assert!(matches!(fs.transport, McpTransport::Stdio { .. }));
		let gh = config.mcps.iter().find(|m| m.name == "github").unwrap();
		assert!(matches!(gh.transport, McpTransport::Stdio { .. }));
	}

	#[test]
	fn copilot_local_transport_round_trips_without_losing_fields() {
		let original = r#"{
			"mcpServers": {
				"filesystem": {
					"type": "local",
					"command": "npx",
					"args": ["@modelcontextprotocol/server-filesystem"],
					"tools": ["*"]
				}
			}
		}"#;
		let mut config = parse_copilot(original).unwrap();
		assert_eq!(config.mcps.len(), 1);
		config.mcps[0].transport = McpTransport::stdio(
			"bunx",
			vec!["@modelcontextprotocol/server-filesystem".to_string()],
		);
		let output = serialize_copilot(&config, Some(original)).unwrap();
		let after: Value = serde_json::from_str(&output).unwrap();
		assert_eq!(after["mcpServers"]["filesystem"]["type"], "local");
		assert_eq!(after["mcpServers"]["filesystem"]["command"], "bunx");
		assert_eq!(after["mcpServers"]["filesystem"]["tools"][0], "*");
	}

	#[test]
	fn copilot_bare_project_map_round_trips_in_place() {
		let original = r#"{
			"filesystem": {
				"type": "local",
				"command": "npx",
				"tools": ["*"]
			}
		}"#;
		let mut config = parse_copilot(original).unwrap();
		assert_eq!(config.mcps.len(), 1);
		config.mcps[0].transport = McpTransport::stdio("bunx", Vec::new());

		let output = serialize_copilot(&config, Some(original)).unwrap();
		let after: Value = serde_json::from_str(&output).unwrap();
		assert_eq!(after["filesystem"]["command"], "bunx");
		assert_eq!(after["filesystem"]["tools"][0], "*");
		assert!(after.get("mcpServers").is_none());
	}

	#[test]
	fn test_parse_sse() {
		let json = r#"{"mcpServers": {"remote-server": {"type": "sse", "url": "http://localhost:3000/sse", "headers": {"Authorization": "Bearer token"}}}}"#;
		let config = parse(json, "mcpServers").unwrap();
		assert_eq!(config.mcps.len(), 1);
		assert!(matches!(config.mcps[0].transport, McpTransport::Sse { .. }));
	}

	#[test]
	fn test_parse_streamable_http() {
		let json = r#"{"mcpServers": {"http-server": {"type": "http", "url": "http://localhost:3000/mcp"}}}"#;
		let config = parse(json, "mcpServers").unwrap();
		assert_eq!(config.mcps.len(), 1);
		assert!(matches!(
			config.mcps[0].transport,
			McpTransport::StreamableHttp { .. }
		));
	}

	#[test]
	fn url_path_does_not_select_legacy_sse() {
		let json = r#"{
            "mcpServers": {
                "inferred-http": {"url": "http://localhost:3000/mcp"},
                "inferred-sse": {"url": "http://localhost:3001/sse"},
                "inferred-sse-sub": {"url": "http://localhost:3002/sse/events"},
                "inferred-stream": {"url": "http://localhost:3003/stream/events"}
            }
        }"#;
		let config = parse(json, "mcpServers").unwrap();
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
		assert!(matches!(sse.transport, McpTransport::StreamableHttp { .. }));
		let sse_sub = config
			.mcps
			.iter()
			.find(|m| m.name == "inferred-sse-sub")
			.unwrap();
		assert!(matches!(
			sse_sub.transport,
			McpTransport::StreamableHttp { .. }
		));
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
	fn test_serialize_stdio() {
		let config = crate::models::AgentConfig {
			mcps: vec![McpServer::new(
				"test",
				McpTransport::stdio("echo", vec!["hello".to_string()]),
			)],
			skills: vec![Skill {
				name: "my-skill".to_string(),
				display_name: None,
				enabled: true,
				description: Some("A test skill".to_string()),
				author: Some("test".to_string()),
				version: Some("1.0.0".to_string()),
				content: None,
				tools: vec!["tool1".to_string()],
				source_path: None,
				canonical_path: None,
				config_source: None,
				origin: None,
			}],
			sub_agents: vec![],
		};
		let json = serialize(&config, None, "mcpServers").unwrap();
		assert!(json.contains("mcpServers"));
		assert!(json.contains("test"));
		assert!(json.contains("\"type\": \"stdio\""));
		assert!(!json.contains("my-skill"));
	}

	#[test]
	fn test_disabled_resources_not_serialized() {
		let config = crate::models::AgentConfig {
			mcps: vec![
				McpServer {
					name: "enabled".to_string(),
					source_name: None,
					enabled: true,
					transport: McpTransport::stdio("echo", vec![]),
					timeout: None,
					config_source: None,
					origin: None,
				},
				McpServer {
					name: "disabled".to_string(),
					source_name: None,
					enabled: false,
					transport: McpTransport::stdio("echo", vec![]),
					timeout: None,
					config_source: None,
					origin: None,
				},
			],
			skills: vec![],
			sub_agents: vec![],
		};
		let json = serialize(&config, None, "mcpServers").unwrap();
		assert!(json.contains("enabled"));
		assert!(!json.contains("disabled"));
	}

	#[test]
	fn test_custom_server_key() {
		let json = r#"{"servers": {"my-mcp": {"type": "stdio", "command": "npx", "args": ["-y", "some-mcp"]}}}"#;
		let config = parse(json, "servers").unwrap();
		assert_eq!(config.mcps.len(), 1);
		let out = serialize(&config, Some(json), "servers").unwrap();
		let val: serde_json::Value = serde_json::from_str(&out).unwrap();
		assert!(val.get("servers").is_some());
		assert!(val.get("mcpServers").is_none());
	}

	#[test]
	fn test_serialize_preserves_non_mcp_fields() {
		let original = r#"{
			"$schema": "https://example.com/settings.schema.json",
			"theme": "night",
			"features": {
				"autocomplete": true
			},
			"mcpServers": {
				"old": {
					"type": "stdio",
					"command": "old-cmd"
				}
			}
		}"#;
		let mut config = parse(original, "mcpServers").unwrap();
		config.mcps = vec![McpServer::new(
			"new",
			McpTransport::stdio("new-cmd", vec!["--flag".to_string()]),
		)];

		let out = serialize(&config, Some(original), "mcpServers").unwrap();
		let val: serde_json::Value = serde_json::from_str(&out).unwrap();

		assert_eq!(val["$schema"], "https://example.com/settings.schema.json");
		assert_eq!(val["theme"], "night");
		assert_eq!(val["features"]["autocomplete"], true);
		assert!(val["mcpServers"].get("new").is_some());
		assert!(val["mcpServers"].get("old").is_none());
	}

	#[test]
	fn test_serialize_preserves_nested_non_mcp_fields() {
		let original = r#"{
			"amp": {
				"mode": "strict",
				"telemetry": {
					"enabled": false
				},
				"mcpServers": {
					"old": {
						"type": "stdio",
						"command": "old-cmd"
					}
				}
			},
			"otherSetting": 42
		}"#;
		let mut config = parse(original, "amp.mcpServers").unwrap();
		assert!(config.mcps.is_empty());
		config.mcps = vec![McpServer::new(
			"new",
			McpTransport::stdio("new-cmd", vec![]),
		)];

		let out = serialize(&config, Some(original), "amp.mcpServers").unwrap();
		let val: serde_json::Value = serde_json::from_str(&out).unwrap();

		assert_eq!(val["amp"]["mode"], "strict");
		assert_eq!(val["amp"]["telemetry"]["enabled"], false);
		assert_eq!(val["otherSetting"], 42);
		assert!(val["amp.mcpServers"].get("new").is_some());
		assert!(val["amp"]["mcpServers"].get("old").is_some());
	}
}
