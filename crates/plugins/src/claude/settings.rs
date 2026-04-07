//! Claude Code settings.json management
//!
//! Handles reading and writing the ~/.claude/settings.json file,
//! specifically the "enabledPlugins" configuration.

use crate::PluginId;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Plugin installation scope
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallScope {
	User,
	Project,
	Local,
}

impl fmt::Display for InstallScope {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		match self {
			InstallScope::User => write!(f, "user"),
			InstallScope::Project => write!(f, "project"),
			InstallScope::Local => write!(f, "local"),
		}
	}
}

impl From<&str> for InstallScope {
	fn from(s: &str) -> Self {
		match s {
			"user" => InstallScope::User,
			"project" => InstallScope::Project,
			"local" => InstallScope::Local,
			_ => InstallScope::User, // Default to user scope
		}
	}
}

/// Plugin-related configuration from settings.json
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ClaudeSettings {
	#[serde(rename = "enabledPlugins", default)]
	pub enabled_plugins: HashMap<String, bool>,
	/// Per-plugin user configuration
	#[serde(rename = "pluginConfig", default)]
	pub plugin_config: HashMap<String, serde_json::Value>,
}

static SETTINGS_FILE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

impl ClaudeSettings {
	/// Load settings from ~/.claude/settings.json
	pub fn load() -> Result<Self> {
		let path = Self::settings_path()?;
		Self::load_from_path(&path)
	}

	/// Save settings back to ~/.claude/settings.json
	/// Preserves all other fields in the file
	pub fn save(&self) -> Result<()> {
		let path = Self::settings_path()?;
		let _guard = Self::settings_lock()
			.lock()
			.map_err(|_| anyhow::anyhow!("Failed to lock settings.json"))?;
		self.save_to_path(&path)
	}

	/// Update settings atomically to avoid concurrent write races
	pub fn update<F>(mutate: F) -> Result<()>
	where
		F: FnOnce(&mut Self),
	{
		let path = Self::settings_path()?;
		Self::update_with_path(&path, mutate)
	}

	/// Check if a plugin is enabled (defaults to true if not set)
	pub fn is_enabled(&self, id: &PluginId) -> bool {
		self.enabled_plugins
			.get(&id.to_string())
			.copied()
			.unwrap_or(true) // Default to enabled
	}

	/// Set plugin enabled status
	pub fn set_enabled(&mut self, id: &PluginId, enabled: bool) {
		self.enabled_plugins.insert(id.to_string(), enabled);
	}

	/// Get plugin configuration
	pub fn get_plugin_config(
		&self,
		id: &PluginId,
	) -> Option<&serde_json::Value> {
		self.plugin_config.get(&id.to_string())
	}

	/// Set plugin configuration
	pub fn set_plugin_config(
		&mut self,
		id: &PluginId,
		config: serde_json::Value,
	) {
		self.plugin_config.insert(id.to_string(), config);
	}

	/// Remove plugin configuration
	pub fn remove_plugin_config(&mut self, id: &PluginId) {
		self.plugin_config.remove(&id.to_string());
	}

	fn settings_path() -> Result<PathBuf> {
		Ok(dirs::home_dir()
			.ok_or_else(|| anyhow::anyhow!("Cannot find home directory"))?
			.join(".claude/settings.json"))
	}

	fn settings_lock() -> &'static Mutex<()> {
		SETTINGS_FILE_LOCK.get_or_init(|| Mutex::new(()))
	}

	fn load_from_path(path: &Path) -> Result<Self> {
		if !path.exists() {
			return Ok(Self::default());
		}

		let content = fs::read_to_string(path).with_context(|| {
			format!("Failed to read settings from {}", path.display())
		})?;

		let full_settings: serde_json::Value =
			serde_json::from_str(&content)
				.with_context(|| "Failed to parse settings.json".to_string())?;

		let enabled_plugins = full_settings
			.get("enabledPlugins")
			.and_then(|value| serde_json::from_value(value.clone()).ok())
			.unwrap_or_default();

		let plugin_config = full_settings
			.get("pluginConfig")
			.and_then(|value| serde_json::from_value(value.clone()).ok())
			.unwrap_or_default();

		Ok(Self {
			enabled_plugins,
			plugin_config,
		})
	}

	fn save_to_path(&self, path: &Path) -> Result<()> {
		if let Some(parent) = path.parent() {
			fs::create_dir_all(parent)?;
		}

		let mut full_settings: serde_json::Value = if path.exists() {
			let content = fs::read_to_string(path)?;
			serde_json::from_str(&content)
				.unwrap_or_else(|_| serde_json::json!({}))
		} else {
			serde_json::json!({})
		};

		full_settings["enabledPlugins"] =
			serde_json::to_value(&self.enabled_plugins)?;
		full_settings["pluginConfig"] =
			serde_json::to_value(&self.plugin_config)?;

		let temp_path = Self::temp_path_for(path);
		fs::write(&temp_path, serde_json::to_string_pretty(&full_settings)?)
			.with_context(|| {
				format!(
					"Failed to write temporary settings to {}",
					temp_path.display()
				)
			})?;
		fs::rename(&temp_path, path).with_context(|| {
			format!("Failed to replace settings at {}", path.display())
		})?;

		Ok(())
	}

	fn update_with_path<F>(path: &Path, mutate: F) -> Result<()>
	where
		F: FnOnce(&mut Self),
	{
		let _guard = Self::settings_lock()
			.lock()
			.map_err(|_| anyhow::anyhow!("Failed to lock settings.json"))?;
		let mut settings = Self::load_from_path(path)?;
		mutate(&mut settings);
		settings.save_to_path(path)
	}

	fn temp_path_for(path: &Path) -> PathBuf {
		let timestamp = SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.map(|duration| duration.as_nanos())
			.unwrap_or(0);
		let file_name = path
			.file_name()
			.and_then(|value| value.to_str())
			.unwrap_or("settings.json");
		path.with_file_name(format!(
			".{}.{}.{}.tmp",
			file_name,
			std::process::id(),
			timestamp
		))
	}
}

#[cfg(test)]
mod tests {
	use super::ClaudeSettings;
	use crate::PluginId;
	use std::sync::Arc;

	#[test]
	fn update_with_path_preserves_concurrent_plugin_changes() {
		let temp_dir = tempfile::tempdir().unwrap();
		let settings_path = temp_dir.path().join("settings.json");
		let path = Arc::new(settings_path);
		let plugin_ids = vec![
			PluginId::parse("alpha@example").unwrap(),
			PluginId::parse("beta@example").unwrap(),
			PluginId::parse("gamma@example").unwrap(),
			PluginId::parse("delta@example").unwrap(),
		];

		std::thread::scope(|scope| {
			for plugin_id in plugin_ids {
				let path = Arc::clone(&path);
				scope.spawn(move || {
					ClaudeSettings::update_with_path(&path, |settings| {
						settings.set_enabled(&plugin_id, false);
					})
					.unwrap();
				});
			}
		});

		let settings = ClaudeSettings::load_from_path(&path).unwrap();

		assert_eq!(settings.enabled_plugins.len(), 4);
		assert_eq!(settings.enabled_plugins.get("alpha@example"), Some(&false));
		assert_eq!(settings.enabled_plugins.get("beta@example"), Some(&false));
		assert_eq!(settings.enabled_plugins.get("gamma@example"), Some(&false));
		assert_eq!(settings.enabled_plugins.get("delta@example"), Some(&false));
	}
}
