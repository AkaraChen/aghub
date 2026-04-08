//! Plugin lockfile management
//!
//! Provides deterministic plugin version tracking similar to package-lock.json
//! Ensures reproducible installations across different machines and times.

use crate::PluginId;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// Plugin lockfile structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginLockfile {
	/// Lockfile version for migration
	pub lockfile_version: u32,
	/// When the lockfile was generated
	pub generated_at: String,
	/// Installed plugins with exact versions
	pub plugins: HashMap<String, LockedPlugin>,
}

/// A locked plugin entry with exact version information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LockedPlugin {
	/// Plugin ID (name@source)
	pub id: String,
	/// Plugin name
	pub name: String,
	/// Exact semantic version
	pub version: String,
	/// Git commit SHA (for git-based sources)
	pub commit_sha: Option<String>,
	/// Source (registry or URL)
	pub source: String,
	/// Download URL or local path
	pub resolved: String,
	/// Integrity hash (SHA-256 of tarball)
	pub integrity: Option<String>,
	/// Installation scope
	pub scope: String,
	/// Installation timestamp
	pub installed_at: String,
	/// Dependencies on other plugins
	#[serde(default)]
	pub dependencies: Vec<String>,
}

impl PluginLockfile {
	fn entry_key(id: &str, scope: &str) -> String {
		format!("{id}#{scope}")
	}

	/// Load lockfile from disk
	pub fn load() -> Result<Self> {
		let path = Self::lockfile_path()?;

		if !path.exists() {
			return Ok(Self::default());
		}

		let content = std::fs::read_to_string(&path).with_context(|| {
			format!("Failed to read lockfile from {}", path.display())
		})?;

		let lockfile: PluginLockfile = serde_json::from_str(&content)
			.with_context(|| "Failed to parse plugin lockfile")?;

		Ok(lockfile)
	}

	/// Save lockfile to disk
	pub fn save(&self) -> Result<()> {
		let path = Self::lockfile_path()?;

		// Ensure parent directory exists
		if let Some(parent) = path.parent() {
			std::fs::create_dir_all(parent)?;
		}

		let content = serde_json::to_string_pretty(self)?;
		std::fs::write(&path, content).with_context(|| {
			format!("Failed to write lockfile to {}", path.display())
		})?;

		Ok(())
	}

	/// Lockfile path (~/.claude/plugins/plugin-lock.json)
	fn lockfile_path() -> Result<PathBuf> {
		Ok(dirs::home_dir()
			.ok_or_else(|| anyhow::anyhow!("Cannot find home directory"))?
			.join(".claude/plugins/plugin-lock.json"))
	}

	/// Get locked plugin by ID
	pub fn get(&self, id: &str) -> Option<&LockedPlugin> {
		self.plugins
			.get(id)
			.or_else(|| self.plugins.values().find(|plugin| plugin.id == id))
	}

	/// Add or update a locked plugin
	pub fn insert(&mut self, plugin: LockedPlugin) {
		let key = Self::entry_key(&plugin.id, &plugin.scope);
		self.plugins.insert(key, plugin);
	}

	/// Remove a plugin from lockfile
	pub fn remove(&mut self, id: &str) {
		if self.plugins.remove(id).is_some() {
			return;
		}

		self.plugins.retain(|_, plugin| plugin.id != id);
	}

	/// Check if a plugin is locked
	pub fn is_locked(&self, id: &str) -> bool {
		self.plugins.contains_key(id)
			|| self.plugins.values().any(|plugin| plugin.id == id)
	}

	/// Get all locked plugins
	pub fn list(&self) -> Vec<&LockedPlugin> {
		self.plugins.values().collect()
	}

	/// Update timestamp
	fn touch(&mut self) {
		self.generated_at = chrono::Utc::now().to_rfc3339();
	}

	/// Sync with installed plugins
	/// This updates the lockfile to match currently installed plugins
	pub fn sync(
		&mut self,
		installed: &[crate::claude::ClaudePluginInfo],
	) -> Result<()> {
		let mut new_plugins = HashMap::new();

		for plugin in installed {
			for scope in &plugin.scopes {
				let resolved = plugin
					.effective_repository()
					.unwrap_or_else(|| plugin.source.to_string());
				let locked = LockedPlugin {
					id: plugin.id.to_string(),
					name: plugin.display_name.clone(),
					version: scope.version.clone(),
					commit_sha: (!plugin.commit_hash.is_empty())
						.then(|| plugin.commit_hash.clone()),
					source: plugin.id.source.clone(),
					resolved,
					integrity: None,
					scope: scope.scope.clone(),
					installed_at: scope.installed_at.clone(),
					dependencies: Vec::new(),
				};
				new_plugins
					.insert(Self::entry_key(&locked.id, &locked.scope), locked);
			}
		}

		self.plugins = new_plugins;
		self.touch();
		self.save()?;

		Ok(())
	}

	/// Verify lockfile integrity
	/// Checks that all locked plugins are actually installed
	pub fn verify(&self) -> Result<Vec<String>> {
		use crate::claude::ClaudePluginManager;

		let manager = ClaudePluginManager::new()?;
		let installed: std::collections::HashSet<String> = manager
			.list_plugins()
			.iter()
			.flat_map(|plugin| {
				plugin.scopes.iter().map(move |scope| {
					Self::entry_key(&plugin.id.to_string(), &scope.scope)
				})
			})
			.collect();

		let mut missing = Vec::new();
		for (key, locked) in &self.plugins {
			if !installed.contains(key) {
				missing.push(Self::entry_key(&locked.id, &locked.scope));
			}
		}

		Ok(missing)
	}

	/// Restore from lockfile
	/// This would reinstall all plugins from the lockfile
	pub async fn restore(&self) -> Result<Vec<RestoreResult>> {
		use crate::installer::PluginInstaller;

		let installer = PluginInstaller::new()?;
		let mut results = Vec::new();

		for locked in self.plugins.values() {
			let plugin_id = PluginId::parse(&locked.id)?;
			let scope = crate::claude::settings::InstallScope::from(
				locked.scope.as_str(),
			);

			// Check if already installed
			if installer.is_installed(&plugin_id, scope).await {
				results.push(RestoreResult {
					id: locked.id.clone(),
					success: true,
					message: "Already installed".to_string(),
				});
				continue;
			}

			// Install from lockfile
			match installer.install_locked(&plugin_id, scope, locked).await {
				Ok(_) => results.push(RestoreResult {
					id: locked.id.clone(),
					success: true,
					message: "Installed from lockfile".to_string(),
				}),
				Err(e) => results.push(RestoreResult {
					id: locked.id.clone(),
					success: false,
					message: e.to_string(),
				}),
			}
		}

		Ok(results)
	}
}

impl Default for PluginLockfile {
	fn default() -> Self {
		Self {
			lockfile_version: 1,
			generated_at: chrono::Utc::now().to_rfc3339(),
			plugins: HashMap::new(),
		}
	}
}

/// Result of a restore operation
#[derive(Debug)]
pub struct RestoreResult {
	pub id: String,
	pub success: bool,
	pub message: String,
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_lockfile_operations() {
		let mut lockfile = PluginLockfile::default();

		let plugin = LockedPlugin {
			id: "test@claude-plugins-official".to_string(),
			name: "Test Plugin".to_string(),
			version: "1.0.0".to_string(),
			commit_sha: Some("abc123".to_string()),
			source: "claude-plugins-official".to_string(),
			resolved: "https://github.com/...".to_string(),
			integrity: Some("sha256-...".to_string()),
			scope: "user".to_string(),
			installed_at: "2024-01-01T00:00:00Z".to_string(),
			dependencies: vec![],
		};
		let plugin_key = PluginLockfile::entry_key(&plugin.id, &plugin.scope);

		// Test insert
		lockfile.insert(plugin.clone());
		assert!(lockfile.is_locked(&plugin.id));
		assert!(lockfile.get(&plugin_key).is_some());

		// Test get
		let retrieved = lockfile.get(&plugin.id);
		assert!(retrieved.is_some());
		assert_eq!(retrieved.unwrap().version, "1.0.0");

		// Test remove
		lockfile.remove(&plugin.id);
		assert!(!lockfile.is_locked(&plugin.id));
	}
}
