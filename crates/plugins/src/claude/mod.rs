//! Claude Code Plugin System Support
//!
//! Handles Claude Code's plugin v2 format:
//! - `~/.claude/plugins/installed_plugins.json` - Plugin manifest
//! - `~/.claude/settings.json` - `enabledPlugins` configuration
//! - `~/.claude/plugins/cache/<source>/<name>/` - Plugin cache directory

pub mod settings;
pub mod types;

use crate::{PluginId, PluginSource};
use anyhow::Result;
use std::path::{Path, PathBuf};

/// Claude Code Plugin Manager
pub struct ClaudePluginManager {
	settings: settings::ClaudeSettings,
	installed: Vec<ClaudePluginInfo>,
}

/// Scope information for a plugin installation
#[derive(Debug, Clone)]
pub struct PluginScopeInfo {
	pub scope: String,
	pub install_path: PathBuf,
	pub version: String,
	pub installed_at: String,
	pub last_updated: String,
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
	/// Commit hash for version fallback
	pub commit_hash: String,
	/// All scopes where this plugin is installed
	pub scopes: Vec<PluginScopeInfo>,
}

impl ClaudePluginInfo {
	pub fn effective_repository(&self) -> Option<String> {
		self.repository.clone()
	}

	/// Get the effective author name
	/// Prioritizes manifest.author.name, falls back to source
	pub fn effective_author(&self) -> String {
		self.author
			.as_ref()
			.map(|a| a.name.clone())
			.unwrap_or_else(|| self.source.to_string())
	}

	/// Get the skills directory path for this plugin
	pub fn skills_path(&self) -> PathBuf {
		self.install_path.join("skills")
	}

	/// Check if this plugin has skills directory
	pub fn has_skills(&self) -> bool {
		self.skills_path().exists()
	}

	/// Check if this plugin has hooks directory
	pub fn has_hooks(&self) -> bool {
		self.install_path.join("hooks").exists()
	}

	/// Check if this plugin has MCP configuration
	pub fn has_mcp(&self) -> bool {
		self.install_path.join(".mcp.json").exists()
	}

	/// Get the hooks directory path
	pub fn hooks_path(&self) -> PathBuf {
		self.install_path.join("hooks")
	}

	/// Get the MCP config path
	pub fn mcp_path(&self) -> PathBuf {
		self.install_path.join(".mcp.json")
	}

	/// Read plugin manifest (plugin.json)
	pub fn read_manifest(&self) -> Result<Option<types::PluginManifest>> {
		read_manifest(&self.install_path)
	}

	/// Read hooks configuration (hooks/hooks.json)
	pub fn read_hooks(&self) -> Result<Option<types::HooksManifest>> {
		let hooks_path = self.hooks_path().join("hooks.json");
		if !hooks_path.exists() {
			return Ok(None);
		}

		let content = std::fs::read_to_string(hooks_path)?;
		let manifest = serde_json::from_str(&content)?;
		Ok(Some(manifest))
	}

	/// Read MCP configuration (.mcp.json)
	pub fn read_mcp_config(&self) -> Result<Option<types::McpConfig>> {
		let mcp_path = self.mcp_path();
		if !mcp_path.exists() {
			return Ok(None);
		}

		let content = std::fs::read_to_string(mcp_path)?;
		let config = serde_json::from_str(&content)?;
		Ok(Some(config))
	}
}

impl ClaudePluginManager {
	/// Create a new plugin manager
	pub fn new() -> Result<Self> {
		let settings = settings::ClaudeSettings::load()?;
		let installed = Self::load_installed_plugins(&settings)?;

		Ok(Self {
			settings,
			installed,
		})
	}

	/// Get a specific plugin by ID
	pub fn get_plugin(&self, id: &PluginId) -> Option<&ClaudePluginInfo> {
		self.installed.iter().find(|p| p.id == *id)
	}

	/// Check if Claude plugin system is available
	pub fn is_available() -> bool {
		dirs::home_dir()
			.map(|h| h.join(".claude/plugins/installed_plugins.json").exists())
			.unwrap_or(false)
	}

	/// List all installed plugins
	pub fn list_plugins(&self) -> &[ClaudePluginInfo] {
		&self.installed
	}

	/// Check if a plugin is enabled
	pub fn is_enabled(&self, id: &PluginId) -> bool {
		self.settings.is_enabled(id)
	}

	/// Enable a plugin
	/// Returns error if plugin is not installed
	pub fn enable(&mut self, id: &PluginId) -> Result<()> {
		// Check plugin exists first to avoid dirty data
		let plugin = self
			.installed
			.iter_mut()
			.find(|p| p.id == *id)
			.ok_or_else(|| anyhow::anyhow!("Plugin '{}' not found", id))?;

		self.settings.set_enabled(id, true);
		self.settings.save()?;
		plugin.enabled = true;

		Ok(())
	}

	/// Disable a plugin
	/// Returns error if plugin is not installed
	pub fn disable(&mut self, id: &PluginId) -> Result<()> {
		// Check plugin exists first to avoid dirty data
		let plugin = self
			.installed
			.iter_mut()
			.find(|p| p.id == *id)
			.ok_or_else(|| anyhow::anyhow!("Plugin '{}' not found", id))?;

		self.settings.set_enabled(id, false);
		self.settings.save()?;
		plugin.enabled = false;

		Ok(())
	}

	/// Filter skill paths based on plugin enabled status
	pub fn filter_skills(&self, paths: Vec<PathBuf>) -> Vec<PathBuf> {
		paths
			.into_iter()
			.filter(|path| self.should_include_skill(path))
			.collect()
	}

	/// Get plugin skills directory
	pub fn get_plugin_skills_path(&self, id: &PluginId) -> Option<PathBuf> {
		self.installed
			.iter()
			.find(|p| p.id == *id)
			.map(|p| p.install_path.join("skills"))
	}

	/// Get plugin user configuration
	pub fn get_plugin_config(
		&self,
		id: &PluginId,
	) -> Option<&serde_json::Value> {
		self.settings.get_plugin_config(id)
	}

	/// Set plugin user configuration
	pub fn set_plugin_config(
		&mut self,
		id: &PluginId,
		config: serde_json::Value,
	) -> Result<()> {
		self.settings.set_plugin_config(id, config);
		self.settings.save()
	}

	/// Remove plugin user configuration
	pub fn remove_plugin_config(&mut self, id: &PluginId) -> Result<()> {
		self.settings.remove_plugin_config(id);
		self.settings.save()
	}

	fn load_installed_plugins(
		settings: &settings::ClaudeSettings,
	) -> Result<Vec<ClaudePluginInfo>> {
		use std::fs;

		let manifest_path = dirs::home_dir()
			.ok_or_else(|| anyhow::anyhow!("Cannot find home directory"))?
			.join(".claude/plugins/installed_plugins.json");

		if !manifest_path.exists() {
			return Ok(Vec::new());
		}

		let content = fs::read_to_string(&manifest_path)?;
		let manifest: types::InstalledPluginsManifest =
			serde_json::from_str(&content)?;

		let mut plugins = Vec::new();

		for (id_str, installations) in manifest.plugins {
			if installations.is_empty() {
				continue;
			}

			let id = PluginId::parse(&id_str)?;

			// Extract source from plugin ID (part after @)
			let source_str = id_str.split('@').nth(1).unwrap_or("unknown");
			let source = PluginSource::parse(source_str)?;

			// Extract display name from plugin ID (part before @)
			let display_name =
				id_str.split('@').next().unwrap_or(&id_str).to_string();

			// Collect all scope information
			let mut scopes = Vec::with_capacity(installations.len());
			for info in &installations {
				scopes.push(PluginScopeInfo {
					scope: info.scope.clone(),
					install_path: PathBuf::from(&info.install_path),
					version: info.version.clone(),
					installed_at: info.installed_at.clone(),
					last_updated: info.last_updated.clone(),
				});
			}

			// Use the first installation as primary (user scope is typically first)
			let primary = &installations[0];

			// Try to read metadata from plugin.json (using primary install path)
			let install_path = PathBuf::from(&primary.install_path);
			let manifest = read_manifest(&install_path).ok().flatten();

			let description = manifest.as_ref().map(|m| m.description.clone());
			let author = manifest.as_ref().map(|m| m.author.clone());
			let repository =
				manifest.as_ref().and_then(|m| m.repository.clone());
			let license = manifest.as_ref().and_then(|m| m.license.clone());
			let keywords = manifest.as_ref().and_then(|m| m.keywords.clone());

			// Use version from plugin.json if available and not "unknown"
			// Priority: plugin.json version > installed_plugins.json version (if valid) > path extract > git commit sha
			let version = manifest
				.as_ref()
				.and_then(|m| {
					let v = m.version.clone()?;
					if v == "unknown" || v.is_empty() {
						None
					} else {
						Some(v)
					}
				})
				.or_else(|| {
					if primary.version != "unknown"
						&& !primary.version.is_empty()
					{
						Some(primary.version.clone())
					} else {
						None
					}
				})
				.or_else(|| extract_version_from_path(&install_path))
				.or_else(|| {
					primary
						.git_commit_sha
						.as_ref()
						.map(|sha| sha[..7.min(sha.len())].to_string())
				})
				.unwrap_or_else(|| "unknown".to_string());

			plugins.push(ClaudePluginInfo {
				id: id.clone(),
				display_name,
				version,
				description,
				author,
				repository,
				license,
				keywords,
				source,
				install_path,
				enabled: settings.is_enabled(&id),
				commit_hash: primary.git_commit_sha.clone().unwrap_or_default(),
				scopes,
			});
		}

		Ok(plugins)
	}

	fn should_include_skill(&self, skill_path: &Path) -> bool {
		// Check if skill is in any plugin's directory
		for plugin in &self.installed {
			if skill_path.starts_with(&plugin.install_path) {
				// It's a plugin skill, only include if enabled
				return plugin.enabled;
			}
		}

		// Not a plugin skill, always include
		true
	}
}

/// Read plugin manifest from install path
fn read_manifest(install_path: &Path) -> Result<Option<types::PluginManifest>> {
	// Try multiple locations for plugin.json
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

/// Extract version from install path if it's a semantic version (e.g., /1.0.0/)
/// Returns None if the parent folder looks like a commit hash
fn extract_version_from_path(path: &Path) -> Option<String> {
	let parent = path.file_name()?.to_str()?;

	// Check if it looks like a semantic version (e.g., 1.0.0, 2.1.0-beta)
	// Must start with a digit and contain at least one dot
	if parent.chars().next()?.is_ascii_digit() && parent.contains('.') {
		return Some(parent.to_string());
	}

	None
}
