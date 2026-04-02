//! Claude Code settings.json management
//!
//! Handles reading and writing the ~/.claude/settings.json file,
//! specifically the "enabledPlugins" configuration.

use crate::PluginId;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

/// Plugin-related configuration from settings.json
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ClaudeSettings {
	#[serde(rename = "enabledPlugins", default)]
	pub enabled_plugins: HashMap<String, bool>,
	/// Per-plugin user configuration
	#[serde(rename = "pluginConfig", default)]
	pub plugin_config: HashMap<String, serde_json::Value>,
}

impl ClaudeSettings {
	/// Load settings from ~/.claude/settings.json
	pub fn load() -> Result<Self> {
		let path = Self::settings_path()?;

		if !path.exists() {
			return Ok(Self::default());
		}

		let content = fs::read_to_string(&path).with_context(|| {
			format!("Failed to read settings from {}", path.display())
		})?;

		// Parse full settings to preserve other fields when saving
		let full_settings: serde_json::Value =
			serde_json::from_str(&content)
				.with_context(|| "Failed to parse settings.json".to_string())?;

		// Extract only the enabledPlugins field
		let enabled_plugins = full_settings
			.get("enabledPlugins")
			.and_then(|v| serde_json::from_value(v.clone()).ok())
			.unwrap_or_default();

		// Extract pluginConfig field
		let plugin_config = full_settings
			.get("pluginConfig")
			.and_then(|v| serde_json::from_value(v.clone()).ok())
			.unwrap_or_default();

		Ok(Self {
			enabled_plugins,
			plugin_config,
		})
	}

	/// Save settings back to ~/.claude/settings.json
	/// Preserves all other fields in the file
	pub fn save(&self) -> Result<()> {
		let path = Self::settings_path()?;

		// Ensure parent directory exists
		if let Some(parent) = path.parent() {
			fs::create_dir_all(parent)?;
		}

		// Load existing settings or create empty
		let mut full_settings: serde_json::Value = if path.exists() {
			let content = fs::read_to_string(&path)?;
			serde_json::from_str(&content)
				.unwrap_or_else(|_| serde_json::json!({}))
		} else {
			serde_json::json!({})
		};

		// Update enabledPlugins
		full_settings["enabledPlugins"] =
			serde_json::to_value(&self.enabled_plugins)?;

		// Update pluginConfig
		full_settings["pluginConfig"] =
			serde_json::to_value(&self.plugin_config)?;

		// Write back
		fs::write(&path, serde_json::to_string_pretty(&full_settings)?)
			.with_context(|| {
				format!("Failed to write settings to {}", path.display())
			})?;

		Ok(())
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
	pub fn get_plugin_config(&self, id: &PluginId) -> Option<&serde_json::Value> {
		self.plugin_config.get(&id.to_string())
	}

	/// Set plugin configuration
	pub fn set_plugin_config(&mut self, id: &PluginId, config: serde_json::Value) {
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
}
