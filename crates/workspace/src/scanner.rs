use std::path::{Path, PathBuf};

use aghub_core::models::AgentType;
use aghub_core::registry;

use crate::blacklist::is_visible;
use crate::model::{AgentWorkspaceResponse, ConfigFileNode, ConfigFileType};

/// Maximum directory recursion depth.
const MAX_DEPTH: usize = 10;

/// Maximum entries per directory to prevent massive responses.
const MAX_ENTRIES_PER_DIR: usize = 10_000;

/// Scan the workspace of a given agent, returning the file tree.
pub fn scan_workspace(
	agent_id: &str,
) -> Result<AgentWorkspaceResponse, ScanError> {
	let agent_type: AgentType = agent_id
		.parse()
		.map_err(|_| ScanError::UnknownAgent(agent_id.to_string()))?;

	let descriptor = registry::get(agent_type);
	let root = (descriptor.global_data_dir)()
		.ok_or_else(|| ScanError::NoGlobalDir(agent_id.to_string()))?;

	if !root.exists() {
		return Err(ScanError::RootNotFound(root.display().to_string()));
	}

	let files = scan_directory(&root, agent_id, "", 0)?;

	let display_root = format_path_with_tilde(&root);

	Ok(AgentWorkspaceResponse {
		agent_id: agent_id.to_string(),
		root_path: display_root,
		files,
	})
}

/// Resolve the root directory for an agent. Returns the canonical path.
pub fn resolve_agent_root(agent_id: &str) -> Result<PathBuf, ScanError> {
	let agent_type: AgentType = agent_id
		.parse()
		.map_err(|_| ScanError::UnknownAgent(agent_id.to_string()))?;

	let descriptor = registry::get(agent_type);
	let root = (descriptor.global_data_dir)()
		.ok_or_else(|| ScanError::NoGlobalDir(agent_id.to_string()))?;

	if !root.exists() {
		return Err(ScanError::RootNotFound(root.display().to_string()));
	}

	Ok(root)
}

fn scan_directory(
	dir: &Path,
	agent_id: &str,
	relative_prefix: &str,
	depth: usize,
) -> Result<Vec<ConfigFileNode>, ScanError> {
	if depth >= MAX_DEPTH {
		return Ok(Vec::new());
	}

	let mut entries: Vec<_> = std::fs::read_dir(dir)
		.map_err(|e| ScanError::Io(dir.display().to_string(), e))?
		.filter_map(|entry| entry.ok())
		.filter(|entry| {
			let name = entry.file_name().to_string_lossy().to_string();
			let is_dir =
				entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
			is_visible(&name, is_dir, agent_id, depth)
		})
		.collect();

	if entries.len() > MAX_ENTRIES_PER_DIR {
		log::warn!(
			"directory '{}' has {} entries, truncating to {}",
			dir.display(),
			entries.len(),
			MAX_ENTRIES_PER_DIR
		);
		entries.truncate(MAX_ENTRIES_PER_DIR);
	}

	// Sort: directories first, then alphabetically (case-insensitive)
	entries.sort_by(|a, b| {
		let a_is_dir = a.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
		let b_is_dir = b.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
		b_is_dir.cmp(&a_is_dir).then_with(|| {
			a.file_name()
				.to_string_lossy()
				.to_lowercase()
				.cmp(&b.file_name().to_string_lossy().to_lowercase())
		})
	});

	let mut nodes = Vec::new();

	for entry in entries {
		let name = entry.file_name().to_string_lossy().to_string();
		let path = entry.path();
		let relative_path = if relative_prefix.is_empty() {
			name.clone()
		} else {
			format!("{relative_prefix}/{name}")
		};

		let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);

		if is_dir {
			let children =
				scan_directory(&path, agent_id, &relative_path, depth + 1)?;
			let link_to = link_for_directory(&name);

			nodes.push(ConfigFileNode {
				path: relative_path,
				name,
				file_type: ConfigFileType::Directory,
				link_to: link_to.map(String::from),
				children,
			});
		} else {
			let file_type = detect_file_type(&name);

			nodes.push(ConfigFileNode {
				path: relative_path,
				name,
				file_type,
				link_to: None,
				children: Vec::new(),
			});
		}
	}

	Ok(nodes)
}

/// Map well-known directory names to internal navigation paths.
fn link_for_directory(name: &str) -> Option<&'static str> {
	match name {
		"skills" => Some("/skills"),
		"plugins" => Some("/plugins"),
		_ => None,
	}
}

/// Detect file type based on extension.
pub fn detect_file_type(name: &str) -> ConfigFileType {
	match name.rsplit('.').next() {
		Some("json") => ConfigFileType::Json,
		Some("toml") => ConfigFileType::Toml,
		Some("md") => ConfigFileType::Markdown,
		Some("yaml" | "yml") => ConfigFileType::Yaml,
		_ => ConfigFileType::Text,
	}
}

/// Format a path with ~ prefix for display.
fn format_path_with_tilde(path: &Path) -> String {
	if let Some(home) = dirs::home_dir() {
		if let Ok(stripped) = path.strip_prefix(&home) {
			return format!("~/{}", stripped.display());
		}
	}
	path.display().to_string()
}

#[derive(Debug, thiserror::Error)]
pub enum ScanError {
	#[error("Unknown agent: {0}")]
	UnknownAgent(String),

	#[error("Agent '{0}' has no global data directory configured")]
	NoGlobalDir(String),

	#[error("Agent root directory not found: {0}")]
	RootNotFound(String),

	#[error("Failed to read directory '{0}': {1}")]
	Io(String, std::io::Error),
}
