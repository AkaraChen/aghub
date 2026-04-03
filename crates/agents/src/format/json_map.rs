use crate::{
	errors::{ConfigError, Result},
	models::{AgentConfig, McpServer, McpTransport},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Map-based MCP server configuration ({"mcpServers": {...}} style)
#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct MapMcpServer {
	#[serde(rename = "type", default)]
	pub server_type: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub command: Option<String>,
	#[serde(default, skip_serializing_if = "Vec::is_empty")]
	pub args: Vec<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub env: Option<HashMap<String, String>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub url: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub headers: Option<HashMap<String, String>>,
}

fn get_nested<'a>(
	root: &'a serde_json::Value,
	path: &str,
) -> Option<&'a serde_json::Value> {
	path.split('.').try_fold(root, |curr, key| curr.get(key))
}

fn set_nested(
	root: &mut serde_json::Value,
	path: &str,
	value: serde_json::Value,
) {
	let keys: Vec<&str> = path.split('.').collect();
	if keys.is_empty() {
		return;
	}
	let mut curr = root;
	for key in &keys[..keys.len() - 1] {
		if let serde_json::Value::Object(ref mut obj) = curr {
			curr = obj.entry(*key).or_insert_with(|| {
				serde_json::Value::Object(serde_json::Map::new())
			});
		}
	}
	if let serde_json::Value::Object(ref mut obj) = curr {
		obj.insert(keys[keys.len() - 1].to_string(), value);
	}
}

pub fn parse(content: &str, server_key: &str) -> Result<AgentConfig> {
	let root: serde_json::Value = serde_json::from_str(content)?;
	let mut config = AgentConfig::new();

	let servers_map = if server_key.contains('.') {
		get_nested(&root, server_key)
	} else {
		root.get(server_key)
	}
	.and_then(|v| v.as_object())
	.cloned()
	.unwrap_or_default();

	for (name, mcp_val) in servers_map {
		let mcp: MapMcpServer =
			serde_json::from_value(mcp_val).unwrap_or_else(|_| MapMcpServer {
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
				if let Some(command) = mcp.command {
					McpTransport::Stdio {
						command,
						args: mcp.args,
						env: mcp.env,
						timeout: None,
					}
				} else if let Some(url) = mcp.url {
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
					continue;
				}
			}
		};
		config.mcps.push(McpServer {
			name,
			enabled: true,
			transport,
			timeout: None,
			config_source: None,
		});
	}

	Ok(config)
}

pub fn serialize(
	config: &AgentConfig,
	original_content: Option<&str>,
	server_key: &str,
) -> Result<String> {
	let mut root: serde_json::Value = if let Some(content) = original_content {
		if content.trim().is_empty() {
			serde_json::Value::Object(serde_json::Map::new())
		} else {
			serde_json::from_str(content).map_err(|e| {
				ConfigError::InvalidConfig(format!(
					"Failed to parse existing config: {e}"
				))
			})?
		}
	} else {
		serde_json::Value::Object(serde_json::Map::new())
	};

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
			McpTransport::StreamableHttp { url, headers, .. } => MapMcpServer {
				server_type: Some("http".to_string()),
				command: None,
				args: vec![],
				env: None,
				url: Some(url.clone()),
				headers: headers.clone(),
			},
		};
		servers_map.insert(
			mcp.name.clone(),
			serde_json::to_value(map_mcp).map_err(ConfigError::Json)?,
		);
	}

	if server_key.contains('.') {
		set_nested(
			&mut root,
			server_key,
			serde_json::Value::Object(servers_map),
		);
	} else if let serde_json::Value::Object(ref mut obj) = root {
		obj.insert(
			server_key.to_string(),
			serde_json::Value::Object(servers_map),
		);
	}

	serde_json::to_string_pretty(&root).map_err(ConfigError::Json)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::models::{McpServer, McpTransport, Skill};

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
	fn test_parse_infers_transport_from_url() {
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
	fn test_serialize_stdio() {
		let config = crate::models::AgentConfig {
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
				content: None,
				tools: vec!["tool1".to_string()],
				source_path: None,
				canonical_path: None,
				config_source: None,
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
					enabled: true,
					transport: McpTransport::stdio("echo", vec![]),
					timeout: None,
					config_source: None,
				},
				McpServer {
					name: "disabled".to_string(),
					enabled: false,
					transport: McpTransport::stdio("echo", vec![]),
					timeout: None,
					config_source: None,
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
		config.mcps = vec![McpServer::new(
			"new",
			McpTransport::stdio("new-cmd", vec![]),
		)];

		let out = serialize(&config, Some(original), "amp.mcpServers").unwrap();
		let val: serde_json::Value = serde_json::from_str(&out).unwrap();

		assert_eq!(val["amp"]["mode"], "strict");
		assert_eq!(val["amp"]["telemetry"]["enabled"], false);
		assert_eq!(val["otherSetting"], 42);
		assert!(val["amp"]["mcpServers"].get("new").is_some());
		assert!(val["amp"]["mcpServers"].get("old").is_none());
	}
}
