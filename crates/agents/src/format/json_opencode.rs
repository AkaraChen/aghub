use crate::{
	errors::{ConfigError, Result},
	models::{AgentConfig, McpServer, McpTransport},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Default, Deserialize)]
struct OpenCodeConfig {
	#[serde(default)]
	mcp: HashMap<String, OpenCodeMcpEntry>,
}

#[derive(Debug, Deserialize)]
struct OpenCodeMcpEntry {
	#[serde(rename = "type")]
	server_type: Option<String>,
	command: Option<Vec<String>>,
	url: Option<String>,
	#[serde(default = "crate::models::default_true")]
	enabled: bool,
	#[serde(alias = "env", default)]
	environment: Option<HashMap<String, String>>,
	headers: Option<HashMap<String, String>>,
	timeout: Option<u64>,
}

#[derive(Debug, Serialize)]
struct OpenCodeMcpOutput {
	#[serde(rename = "type")]
	server_type: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	command: Option<Vec<String>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	url: Option<String>,
	enabled: bool,
	#[serde(skip_serializing_if = "Option::is_none")]
	environment: Option<HashMap<String, String>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	headers: Option<HashMap<String, String>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	timeout: Option<u64>,
}

pub fn parse(content: &str) -> Result<AgentConfig> {
	let oc: OpenCodeConfig = aghub_json::parse_jsonc_opt(content)
		.map_err(|error| ConfigError::InvalidConfig(error.to_string()))?
		.unwrap_or_default();
	let mut config = AgentConfig::new();

	for (name, entry) in oc.mcp {
		if entry
			.server_type
			.as_deref()
			.is_some_and(|kind| !matches!(kind, "local" | "remote"))
		{
			continue;
		}
		let is_remote = entry.server_type.as_deref() == Some("remote")
			|| (entry.server_type.is_none() && entry.url.is_some());
		let transport = if is_remote {
			McpTransport::StreamableHttp {
				url: entry.url.ok_or_else(|| {
					ConfigError::InvalidConfig(format!(
						"MCP '{name}' requires url"
					))
				})?,
				headers: entry.headers,
				timeout: entry.timeout,
			}
		} else {
			let Some(cmd) = entry.command else {
				continue;
			};
			let (command, args) = if cmd.is_empty() {
				return Err(ConfigError::InvalidConfig(format!(
					"MCP '{name}' requires a nonempty command"
				)));
			} else {
				(cmd[0].clone(), cmd[1..].to_vec())
			};
			McpTransport::Stdio {
				command,
				args,
				env: entry.environment,
				timeout: entry.timeout,
			}
		};
		config.mcps.push(McpServer {
			source_name: Some(name.clone()),
			name,
			enabled: entry.enabled,
			transport,
			timeout: None,
			config_source: None,
			origin: None,
		});
	}

	Ok(config)
}

pub fn serialize(
	config: &AgentConfig,
	original_content: Option<&str>,
) -> Result<String> {
	let previous = parse(original_content.unwrap_or(""))?;
	let mut root: serde_json::Map<String, serde_json::Value> =
		aghub_json::parse_jsonc_opt(original_content.unwrap_or(""))
			.map_err(|error| ConfigError::InvalidConfig(error.to_string()))?
			.unwrap_or_default();
	let originals = root
		.get("mcp")
		.and_then(|value| value.as_object())
		.cloned()
		.unwrap_or_default();
	let mut servers = originals.clone();
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
		let mut native = originals
			.get(source_name)
			.and_then(|value| value.as_object())
			.cloned()
			.unwrap_or_default();
		let entry = match &mcp.transport {
			McpTransport::Stdio {
				command,
				args,
				env,
				timeout,
				..
			} => {
				let mut cmd = vec![command.clone()];
				cmd.extend(args.iter().cloned());
				OpenCodeMcpOutput {
					server_type: "local".to_string(),
					command: Some(cmd),
					url: None,
					enabled: mcp.enabled,
					environment: env.clone(),
					headers: None,
					timeout: *timeout,
				}
			}
			McpTransport::Sse {
				url,
				headers,
				timeout,
				..
			}
			| McpTransport::StreamableHttp {
				url,
				headers,
				timeout,
				..
			} => OpenCodeMcpOutput {
				server_type: "remote".to_string(),
				command: None,
				url: Some(url.clone()),
				enabled: mcp.enabled,
				environment: None,
				headers: headers.clone(),
				timeout: *timeout,
			},
		};
		if old.map(|server| &server.transport) != Some(&mcp.transport) {
			for key in [
				"type",
				"command",
				"url",
				"environment",
				"env",
				"headers",
				"timeout",
			] {
				native.remove(key);
			}
			let fields: serde_json::Value = serde_json::to_value(entry)?;
			if let serde_json::Value::Object(fields) = fields {
				native.extend(fields);
			}
		}
		if old.map(|server| server.enabled) != Some(mcp.enabled) {
			native
				.insert("enabled".into(), serde_json::Value::Bool(mcp.enabled));
		}
		servers.insert(mcp.name.clone(), serde_json::Value::Object(native));
	}
	root.insert("mcp".into(), serde_json::Value::Object(servers));
	aghub_json::patch_jsonc_object(original_content, &root)
		.map_err(|error| ConfigError::InvalidConfig(error.to_string()))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn editing_retains_oauth_native_options_and_comments() {
		let original = r#"{
			// Native client authorization, not an aghub credential
			"mcp": {"remote": {"type": "remote", "url": "https://example.test/mcp", "oauth": {"clientId": "public-client", "scopes": ["read"]}, "custom": {"mode": "user"}}}
		}"#;
		let mut config = parse(original).unwrap();
		config.mcps[0].enabled = false;
		let output = serialize(&config, Some(original)).unwrap();
		let after: serde_json::Value =
			aghub_json::parse_jsonc_opt(&output).unwrap().unwrap();
		assert_eq!(
			after["mcp"]["remote"]["oauth"]["clientId"],
			"public-client"
		);
		assert_eq!(after["mcp"]["remote"]["enabled"], false);
		assert_eq!(after["mcp"]["remote"]["custom"]["mode"], "user");
		assert!(output.contains("// Native client authorization"));
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
		let config = parse(original).unwrap();
		assert_eq!(config.mcps.len(), 2);
		let out = serialize(&config, Some(original)).unwrap();
		let val: serde_json::Value = serde_json::from_str(&out).unwrap();
		assert_eq!(
			val.get("$schema").and_then(|v| v.as_str()),
			Some("https://opencode.ai/config.json")
		);
		assert!(val.get("mcp").is_some());
		assert!(val.get("mcp_servers").is_none());
	}

	#[test]
	fn test_opencode_preserves_non_mcp_options_on_serialize() {
		let original = r#"{
			"$schema": "https://opencode.ai/config.json",
			"theme": "system",
			"sandbox": "workspace-write",
			"model": {
				"default": "gpt-5.4-mini"
			},
			"mcp": {
				"old-srv": {
					"type": "local",
					"command": ["old-cmd"],
					"enabled": true
				}
			}
		}"#;

		let mut config = parse(original).unwrap();
		config.mcps = vec![McpServer::new(
			"new-srv",
			McpTransport::stdio("npx", vec!["-y".to_string()]),
		)];

		let out = serialize(&config, Some(original)).unwrap();
		let val: serde_json::Value = serde_json::from_str(&out).unwrap();

		assert_eq!(val["$schema"], "https://opencode.ai/config.json");
		assert_eq!(val["theme"], "system");
		assert_eq!(val["sandbox"], "workspace-write");
		assert_eq!(val["model"]["default"], "gpt-5.4-mini");
		assert!(val["mcp"].get("new-srv").is_some());
		assert!(val["mcp"].get("old-srv").is_none());
	}
}
