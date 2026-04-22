use super::types;
use anyhow::Result;
use std::path::Path;

pub(super) fn read_manifest(
	install_path: &Path,
) -> Result<Option<types::PluginManifest>> {
	let possible_paths = [
		install_path.join(".claude-plugin/plugin.json"),
		install_path.join(".plugin/plugin.json"),
		install_path.join("plugin.json"),
	];

	for path in &possible_paths {
		if path.exists() {
			let content = std::fs::read_to_string(path)?;
			let manifest = serde_json::from_str(&content)?;
			return Ok(Some(manifest));
		}
	}

	Ok(None)
}

pub(super) fn find_latest_manifest_in_siblings(
	install_path: &Path,
) -> Option<types::PluginManifest> {
	if !install_path
		.to_string_lossy()
		.contains(".claude/plugins/cache")
	{
		return None;
	}

	let parent = install_path.parent()?;
	let mut candidates = Vec::new();

	if let Ok(entries) = std::fs::read_dir(parent) {
		for entry in entries.flatten() {
			let path = entry.path();
			if path.is_dir() {
				if let Ok(Some(manifest)) = read_manifest(&path) {
					let modified =
						entry.metadata().and_then(|m| m.modified()).ok()?;
					candidates.push((modified, manifest));
				}
			}
		}
	}

	candidates.sort_by_key(|entry| std::cmp::Reverse(entry.0));
	candidates.into_iter().next().map(|(_, manifest)| manifest)
}

pub(super) fn extract_version_from_path(path: &Path) -> Option<String> {
	let parent = path.file_name()?.to_str()?;

	if parent.chars().next()?.is_ascii_digit() && parent.contains('.') {
		return Some(parent.to_string());
	}

	None
}

pub(super) fn parse_mcp_json(content: &str) -> Option<types::McpConfig> {
	use std::collections::HashMap;

	if let Ok(config) = serde_json::from_str::<types::McpConfig>(content) {
		return Some(config);
	}

	let value: serde_json::Value = serde_json::from_str(content).ok()?;
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
	let possible_paths = [
		install_path.join(".claude-plugin/plugin.json"),
		install_path.join(".plugin/plugin.json"),
		install_path.join("plugin.json"),
	];

	for path in &possible_paths {
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
