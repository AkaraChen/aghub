//! Claude Code Plugin System Support
//!
//! Handles Claude Code's plugin v2 format:
//! - install state and enabled flags: sourced from `claude plugin list --json`
//! - `~/.claude/settings.json` `pluginConfig`: per-plugin user config we own
//! - `~/.claude/plugins/cache/<source>/<name>/`: plugin cache directory

mod capabilities;
mod manager;
mod manifest;

pub mod settings;
pub mod types;

pub use self::manager::ClaudePluginManager;

use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn temp_path_for(path: &std::path::Path) -> std::path::PathBuf {
	let timestamp = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|duration| duration.as_nanos())
		.unwrap_or(0);
	let file_name = path
		.file_name()
		.and_then(|value| value.to_str())
		.unwrap_or("config.json");
	path.with_file_name(format!(
		".{}.{}.{}.tmp",
		file_name,
		std::process::id(),
		timestamp
	))
}

use crate::{PluginId, PluginSource};
use std::path::PathBuf;

/// Scope information for a plugin installation
#[derive(Debug, Clone)]
pub struct PluginScopeInfo {
	pub scope: String,
	pub install_path: PathBuf,
	pub version: String,
	pub installed_at: String,
	pub last_updated: String,
	pub git_commit_sha: Option<String>,
}

/// Claude-specific plugin metadata
#[derive(Debug, Clone)]
pub struct ClaudePluginInfo {
	pub id: PluginId,
	pub display_name: String,
	pub version: String,
	pub description: Option<String>,
	pub author: Option<types::PluginAuthor>,
	pub repository: Option<String>,
	pub license: Option<String>,
	pub keywords: Option<Vec<String>>,
	pub source: PluginSource,
	pub install_path: PathBuf,
	pub enabled: bool,
	pub commit_hash: String,
	pub scopes: Vec<PluginScopeInfo>,
}
