use super::types;
use crate::MANIFEST_CANDIDATE_PATHS;
use anyhow::Result;
use std::path::Path;

pub(super) fn read_manifest(
	install_path: &Path,
) -> Result<Option<types::PluginManifest>> {
	for name in MANIFEST_CANDIDATE_PATHS {
		let path = install_path.join(name);
		if path.exists() {
			let content = std::fs::read_to_string(path)?;
			let manifest = serde_json::from_str(&content)?;
			return Ok(Some(manifest));
		}
	}

	Ok(None)
}

pub(super) fn parse_mcp_json(content: &str) -> Option<types::McpConfig> {
	use std::collections::HashMap;

	if let Ok(config) = serde_json::from_str::<types::McpConfig>(content) {
		return Some(config);
	}

	let value: serde_json::Value = serde_json::from_str(content)
		.inspect_err(|e| log::debug!("Failed to parse MCP JSON: {e}"))
		.ok()?;
	let obj = value.as_object()?;

	let mut servers = HashMap::new();
	for (name, server_val) in obj {
		if name.starts_with('_') || name == "version" {
			continue;
		}
		if !server_val.is_object() {
			continue;
		}
		if let Ok(config) =
			serde_json::from_value::<types::McpServerConfig>(server_val.clone())
		{
			servers.insert(name.clone(), config);
		}
	}

	if servers.is_empty() {
		return None;
	}

	Some(types::McpConfig {
		mcp_servers: servers,
	})
}

pub(super) fn parse_mcp_from_manifest(
	install_path: &Path,
) -> Result<Option<types::McpConfig>> {
	for name in MANIFEST_CANDIDATE_PATHS {
		let path = install_path.join(name);
		if !path.exists() {
			continue;
		}
		let content = std::fs::read_to_string(path)?;
		let value: serde_json::Value = serde_json::from_str(&content)?;

		if let Some(mcp) =
			value.get("mcpServers").or_else(|| value.get("mcp_servers"))
		{
			if let Ok(servers) = serde_json::from_value(mcp.clone()) {
				return Ok(Some(types::McpConfig {
					mcp_servers: servers,
				}));
			}
		}
	}

	Ok(None)
}
