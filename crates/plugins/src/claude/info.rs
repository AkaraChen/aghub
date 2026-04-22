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
	pub author: Option<super::types::PluginAuthor>,
	pub repository: Option<String>,
	pub license: Option<String>,
	pub keywords: Option<Vec<String>>,
	pub source: PluginSource,
	pub install_path: PathBuf,
	pub enabled: bool,
	/// Commit hash for version fallback
	pub commit_hash: String,
	/// All scopes where this plugin is installed
	pub scopes: Vec<PluginScopeInfo>,
}
