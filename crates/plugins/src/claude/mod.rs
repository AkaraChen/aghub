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
use semver::Version;
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Claude Code Plugin Manager
pub struct ClaudePluginManager {
	settings: settings::ClaudeSettings,
	installed: Vec<ClaudePluginInfo>,
}

#[derive(Debug)]
struct CacheInstallCandidate {
	path: PathBuf,
	version: String,
	modified: SystemTime,
	timestamp: String,
	git_commit_sha: Option<String>,
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
	/// Searches primary path, all scopes, and `.claude/skills`
	pub fn has_skills(&self) -> bool {
		for path in self.all_install_paths() {
			if path.join("skills").is_dir()
				|| path.join(".claude/skills").is_dir()
			{
				return true;
			}
		}
		false
	}

	/// Check if this plugin has hooks directory
	/// Searches primary path and all scopes
	pub fn has_hooks(&self) -> bool {
		for path in self.all_install_paths() {
			if path.join("hooks").is_dir() {
				return true;
			}
		}
		false
	}

	/// Check if this plugin has MCP configuration
	/// Searches `.mcp.json` across all scopes and
	/// `mcpServers` in plugin manifest
	pub fn has_mcp(&self) -> bool {
		self.read_mcp_config()
			.ok()
			.flatten()
			.is_some_and(|c| !c.mcp_servers.is_empty())
	}

	/// Get the hooks directory path
	pub fn hooks_path(&self) -> PathBuf {
		self.install_path.join("hooks")
	}

	/// Get the MCP config path
	pub fn mcp_path(&self) -> PathBuf {
		self.install_path.join(".mcp.json")
	}

	/// Get the manifest path
	pub fn manifest_path(&self) -> PathBuf {
		let path = self.install_path.join("plugin.json");
		if !path.exists() {
			let fallback =
				self.install_path.join(".claude-plugin").join("plugin.json");
			if fallback.exists() {
				return fallback;
			}
		}
		path
	}

	/// Read plugin manifest (plugin.json)
	/// Searches primary path and all scopes
	pub fn read_manifest(&self) -> Result<Option<types::PluginManifest>> {
		for path in self.all_install_paths() {
			if let Some(manifest) = read_manifest(&path)? {
				return Ok(Some(manifest));
			}
		}
		Ok(None)
	}

	/// Read hooks configuration (hooks/hooks.json)
	/// Searches primary path and all scopes
	pub fn read_hooks(&self) -> Result<Option<types::HooksManifest>> {
		for path in self.all_install_paths() {
			let hooks_path = path.join("hooks/hooks.json");
			if hooks_path.exists() {
				let content = std::fs::read_to_string(hooks_path)?;
				let manifest = serde_json::from_str(&content)?;
				return Ok(Some(manifest));
			}
		}
		Ok(None)
	}

	/// Read MCP configuration
	/// Searches `.mcp.json` across all scope paths,
	/// handles both `{ "mcpServers": {...} }` and legacy
	/// flat `{ "serverName": {...} }` formats.
	/// Falls back to `plugin.json` manifest.
	pub fn read_mcp_config(&self) -> Result<Option<types::McpConfig>> {
		// Search .mcp.json across all scope paths
		for path in self.all_install_paths() {
			let mcp_path = path.join(".mcp.json");
			if !mcp_path.exists() {
				continue;
			}
			let content = std::fs::read_to_string(&mcp_path)?;
			if let Some(config) = parse_mcp_json(&content) {
				return Ok(Some(config));
			}
		}

		// Fallback: check plugin.json manifest for mcpServers
		for path in self.all_install_paths() {
			if let Ok(Some(config)) = parse_mcp_from_manifest(&path) {
				return Ok(Some(config));
			}
		}

		Ok(None)
	}

	/// Collect all candidate install paths for capability discovery.
	///
	/// Claude caches multiple versions under the same plugin
	/// directory (e.g. `.../context7/{unknown,decc737a,b091cb,...}`).
	/// The primary `install_path` may point to an empty `unknown/`
	/// directory while the actual `.mcp.json` / `skills/` live in
	/// a sibling version directory.  We scan the parent to find all
	/// version subdirectories.
	pub fn all_install_paths(&self) -> Vec<PathBuf> {
		let mut paths: Vec<PathBuf> = Vec::new();
		let mut seen = std::collections::HashSet::new();

		// Helper: add a path if not yet seen
		let mut push = |p: PathBuf| {
			if p.is_dir() && seen.insert(p.clone()) {
				paths.push(p);
			}
		};

		// 1. Primary install path
		push(self.install_path.clone());

		// 2. All scope install paths
		for scope in &self.scopes {
			push(scope.install_path.clone());
		}

		// 3. Sibling version directories under the parent
		//    e.g. parent = .../cache/claude-plugins-official/context7/
		// Only scan siblings if the installation is in the cache directory
		// to avoid scanning large user directories for local installs by Claude CLI.
		if self
			.install_path
			.to_string_lossy()
			.contains(".claude/plugins/cache")
		{
			if let Some(parent) = self.install_path.parent() {
				if let Ok(entries) = std::fs::read_dir(parent) {
					for entry in entries.flatten() {
						let p = entry.path();
						if p.is_dir() {
							push(p);
						}
					}
				}
			}
		}

		paths
	}

	/// Check if this plugin owns a given path (is it within any of install paths)
	pub fn owns_path(&self, target: &Path) -> bool {
		for path in self.all_install_paths() {
			if target.starts_with(&path) {
				return true;
			}
		}
		false
	}

	/// Get all possible skill directories for this plugin
	pub fn all_skills_dirs(&self) -> Vec<PathBuf> {
		let mut paths = Vec::new();

		for install_path in self.all_install_paths() {
			// Standard skills folders
			paths.push(install_path.join("skills"));
			paths.push(install_path.join(".claude/skills"));
		}

		// Also check manifest for custom skills dir
		if let Ok(Some(manifest)) = self.read_manifest() {
			if let Some(ref skills_path) = manifest.skills {
				for install_path in self.all_install_paths() {
					paths.push(install_path.join(skills_path));
				}
			}
		}

		paths
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

		settings::ClaudeSettings::update(|settings| {
			settings.set_enabled(id, true);
		})?;
		self.settings.set_enabled(id, true);
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

		settings::ClaudeSettings::update(|settings| {
			settings.set_enabled(id, false);
		})?;
		self.settings.set_enabled(id, false);
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
		settings::ClaudeSettings::update(|settings| {
			settings.set_plugin_config(id, config.clone());
		})?;
		self.settings.set_plugin_config(id, config);
		Ok(())
	}

	/// Remove plugin user configuration
	pub fn remove_plugin_config(&mut self, id: &PluginId) -> Result<()> {
		settings::ClaudeSettings::update(|settings| {
			settings.remove_plugin_config(id);
		})?;
		self.settings.remove_plugin_config(id);
		Ok(())
	}

	fn load_installed_plugins(
		settings: &settings::ClaudeSettings,
	) -> Result<Vec<ClaudePluginInfo>> {
		use std::fs;

		let manifest_path = dirs::home_dir()
			.ok_or_else(|| anyhow::anyhow!("Cannot find home directory"))?
			.join(".claude/plugins/installed_plugins.json");

		let mut manifest_plugins = if manifest_path.exists() {
			let content = fs::read_to_string(&manifest_path)?;
			let manifest: types::InstalledPluginsManifest =
				serde_json::from_str(&content)?;
			manifest.plugins
		} else {
			HashMap::new()
		};

		Self::supplement_missing_installations(
			settings,
			&mut manifest_plugins,
		)?;

		if manifest_plugins.is_empty() {
			return Ok(Vec::new());
		}

		let mut plugins = Vec::new();

		for (id_str, installations) in manifest_plugins {
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
			let manifest = read_manifest(&install_path)
				.ok()
				.flatten()
				.or_else(|| find_latest_manifest_in_siblings(&install_path));

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

	fn supplement_missing_installations(
		settings: &settings::ClaudeSettings,
		manifest_plugins: &mut HashMap<String, Vec<types::InstalledPluginInfo>>,
	) -> Result<()> {
		let mut plugin_ids = BTreeSet::new();
		plugin_ids.extend(
			settings
				.enabled_plugins
				.iter()
				.filter_map(|(id, enabled)| enabled.then_some(id.clone())),
		);

		for id_str in plugin_ids {
			if manifest_plugins
				.get(&id_str)
				.is_some_and(|installations| !installations.is_empty())
			{
				continue;
			}

			let Ok(id) = PluginId::parse(&id_str) else {
				continue;
			};

			if let Some(installation) = discover_cache_installation(&id)? {
				manifest_plugins.insert(id_str, vec![installation]);
			}
		}

		Ok(())
	}

	fn should_include_skill(&self, skill_path: &Path) -> bool {
		// Check if skill is in any plugin's directory
		for plugin in &self.installed {
			if plugin.owns_path(skill_path) {
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

fn discover_cache_installation(
	id: &PluginId,
) -> Result<Option<types::InstalledPluginInfo>> {
	let cache_root = dirs::home_dir()
		.ok_or_else(|| anyhow::anyhow!("Cannot find home directory"))?
		.join(".claude/plugins/cache");

	if !cache_root.exists() {
		return Ok(None);
	}

	let mut candidates = Vec::new();
	collect_cache_install_candidates(
		&cache_root.join(&id.source).join(&id.name),
		&mut candidates,
	);

	if candidates.is_empty() {
		let entries = match std::fs::read_dir(&cache_root) {
			Ok(entries) => entries,
			Err(_) => return Ok(None),
		};

		for entry in entries.flatten() {
			collect_cache_install_candidates(
				&entry.path().join(&id.name),
				&mut candidates,
			);
		}
	}

	let candidate = match select_best_cache_install(candidates) {
		Some(candidate) => candidate,
		None => return Ok(None),
	};

	Ok(Some(types::InstalledPluginInfo {
		scope: "user".to_string(),
		install_path: candidate.path.display().to_string(),
		version: candidate.version,
		installed_at: candidate.timestamp.clone(),
		last_updated: candidate.timestamp,
		git_commit_sha: candidate.git_commit_sha,
	}))
}

fn collect_cache_install_candidates(
	plugin_root: &Path,
	candidates: &mut Vec<CacheInstallCandidate>,
) {
	if !plugin_root.is_dir() {
		return;
	}

	let Ok(entries) = std::fs::read_dir(plugin_root) else {
		return;
	};

	for entry in entries.flatten() {
		let path = entry.path();
		if !path.is_dir() {
			continue;
		}

		let manifest = read_manifest(&path).ok().flatten();

		let version = manifest
			.as_ref()
			.and_then(|plugin_manifest| plugin_manifest.version.clone())
			.and_then(|value| {
				if !value.is_empty() && value != "unknown" {
					Some(value)
				} else {
					None
				}
			})
			.or_else(|| extract_version_from_path(&path))
			.unwrap_or_else(|| {
				path.file_name()
					.and_then(|value| value.to_str())
					.unwrap_or("unknown")
					.to_string()
			});
		let modified = entry
			.metadata()
			.and_then(|metadata| metadata.modified())
			.unwrap_or(SystemTime::UNIX_EPOCH);
		let timestamp =
			chrono::DateTime::<chrono::Utc>::from(modified).to_rfc3339();

		candidates.push(CacheInstallCandidate {
			path: path.clone(),
			version,
			modified,
			timestamp,
			git_commit_sha: infer_commit_from_path(&path),
		});
	}
}

fn select_best_cache_install(
	mut candidates: Vec<CacheInstallCandidate>,
) -> Option<CacheInstallCandidate> {
	candidates.sort_by(|a, b| {
		let a_name = a.path.file_name().and_then(|value| value.to_str());
		let b_name = b.path.file_name().and_then(|value| value.to_str());
		let a_is_latest = a_name == Some("latest");
		let b_is_latest = b_name == Some("latest");

		b_is_latest
			.cmp(&a_is_latest)
			.then_with(|| {
				match (Version::parse(&a.version), Version::parse(&b.version)) {
					(Ok(a_ver), Ok(b_ver)) => b_ver.cmp(&a_ver),
					(Ok(_), Err(_)) => std::cmp::Ordering::Less,
					(Err(_), Ok(_)) => std::cmp::Ordering::Greater,
					(Err(_), Err(_)) => b.modified.cmp(&a.modified),
				}
			})
			.then_with(|| b.modified.cmp(&a.modified))
	});

	candidates.into_iter().next()
}

fn infer_commit_from_path(path: &Path) -> Option<String> {
	let name = path.file_name()?.to_str()?;

	if name == "latest"
		|| name == "unknown"
		|| extract_version_from_path(path).is_some()
	{
		return None;
	}

	if name.len() >= 7 && name.chars().all(|ch| ch.is_ascii_hexdigit()) {
		return Some(name.to_string());
	}

	None
}

/// Find the latest manifest from sibling version directories.
/// Claude caches multiple versions under the same plugin directory
/// (e.g. `.../context7/{unknown,decc737a,b091cb,...}`).
/// This function searches all sibling directories and returns the
/// manifest from the most recently modified one.
fn find_latest_manifest_in_siblings(
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

	// Collect all sibling directories that have a valid manifest
	if let Ok(entries) = std::fs::read_dir(parent) {
		for entry in entries.flatten() {
			let path = entry.path();
			if path.is_dir() {
				if let Ok(Some(manifest)) = read_manifest(&path) {
					// Get modification time
					let modified =
						entry.metadata().and_then(|m| m.modified()).ok()?;
					candidates.push((modified, manifest));
				}
			}
		}
	}

	// Sort by modification time (newest first) and return the manifest
	candidates.sort_by(|a, b| b.0.cmp(&a.0));
	candidates.into_iter().next().map(|(_, manifest)| manifest)
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

/// Parse `.mcp.json` content, handling two formats:
/// 1. Standard: `{ "mcpServers": { "name": { ... } } }`
/// 2. Legacy flat: `{ "serverName": { "command": ... } }`
fn parse_mcp_json(content: &str) -> Option<types::McpConfig> {
	use std::collections::HashMap;

	// Try standard format first
	if let Ok(config) = serde_json::from_str::<types::McpConfig>(content) {
		return Some(config);
	}

	// Try legacy flat format: each top-level key is a server
	let value: serde_json::Value = serde_json::from_str(content).ok()?;
	let obj = value.as_object()?;

	let mut servers = HashMap::new();
	for (name, server_val) in obj {
		// Skip metadata keys that aren't server configs
		if name.starts_with('_') || name == "version" {
			continue;
		}
		// Each value must be an object with server config
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

/// Extract MCP servers from plugin.json manifest
fn parse_mcp_from_manifest(
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

#[cfg(test)]
mod tests {
	use super::*;
	use std::sync::{Mutex, OnceLock};
	use std::time::{SystemTime, UNIX_EPOCH};

	fn env_lock() -> &'static Mutex<()> {
		static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
		LOCK.get_or_init(|| Mutex::new(()))
	}

	fn make_temp_dir(prefix: &str) -> PathBuf {
		let unique = SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.unwrap()
			.as_nanos();
		let path = std::env::temp_dir().join(format!("{prefix}-{unique}"));
		std::fs::create_dir_all(&path).unwrap();
		path
	}

	#[test]
	fn manager_discovers_plugins_missing_from_manifest_via_cache() {
		let _guard = env_lock().lock().unwrap();
		let temp_home = make_temp_dir("aghub-claude-home");
		let previous_home = std::env::var_os("HOME");

		std::env::set_var("HOME", &temp_home);

		let result = (|| -> Result<()> {
			let settings_dir = temp_home.join(".claude");
			let plugins_dir = settings_dir.join("plugins");
			let cache_dir = plugins_dir
				.join("cache")
				.join("claude-plugins-official")
				.join("figma")
				.join("2.0.7")
				.join(".claude-plugin");

			std::fs::create_dir_all(&cache_dir)?;
			std::fs::write(
				settings_dir.join("settings.json"),
				r#"{"enabledPlugins":{"figma@claude-plugins-official":true}}"#,
			)?;
			std::fs::create_dir_all(&plugins_dir)?;
			std::fs::write(
				plugins_dir.join("installed_plugins.json"),
				r#"{"version":2,"plugins":{}}"#,
			)?;
			std::fs::write(
				cache_dir.join("plugin.json"),
				r#"{"name":"figma","version":"2.0.7","description":"test","author":{"name":"A"}}"#,
			)?;

			let manager = ClaudePluginManager::new()?;
			let plugin = manager
				.get_plugin(&PluginId::parse("figma@claude-plugins-official")?)
				.ok_or_else(|| {
					anyhow::anyhow!("figma plugin not discovered")
				})?;

			assert_eq!(plugin.version, "2.0.7");
			assert_eq!(plugin.install_path, cache_dir.parent().unwrap());
			assert!(plugin.enabled);
			Ok(())
		})();

		match previous_home {
			Some(value) => std::env::set_var("HOME", value),
			None => std::env::remove_var("HOME"),
		}
		std::fs::remove_dir_all(&temp_home).unwrap();

		result.unwrap();
	}

	#[test]
	fn manager_does_not_treat_disabled_cache_plugin_as_installed() {
		let _guard = env_lock().lock().unwrap();
		let temp_home = make_temp_dir("aghub-claude-home-disabled");
		let previous_home = std::env::var_os("HOME");

		std::env::set_var("HOME", &temp_home);

		let result = (|| -> Result<()> {
			let settings_dir = temp_home.join(".claude");
			let plugins_dir = settings_dir.join("plugins");
			let cache_dir = plugins_dir
				.join("cache")
				.join("claude-plugins-official")
				.join("superpowers")
				.join("5.0.7")
				.join(".claude-plugin");

			std::fs::create_dir_all(&cache_dir)?;
			std::fs::write(
				settings_dir.join("settings.json"),
				r#"{"enabledPlugins":{"superpowers@claude-plugins-official":false},"pluginConfig":{"superpowers@claude-plugins-official":{"mode":"test"}}}"#,
			)?;
			std::fs::create_dir_all(&plugins_dir)?;
			std::fs::write(
				plugins_dir.join("installed_plugins.json"),
				r#"{"version":2,"plugins":{}}"#,
			)?;
			std::fs::write(
				cache_dir.join("plugin.json"),
				r#"{"name":"superpowers","version":"5.0.7","description":"test","author":{"name":"A"}}"#,
			)?;

			let manager = ClaudePluginManager::new()?;
			assert!(manager
				.get_plugin(&PluginId::parse(
					"superpowers@claude-plugins-official",
				)?)
				.is_none());
			Ok(())
		})();

		match previous_home {
			Some(value) => std::env::set_var("HOME", value),
			None => std::env::remove_var("HOME"),
		}
		std::fs::remove_dir_all(&temp_home).unwrap();

		result.unwrap();
	}
}
