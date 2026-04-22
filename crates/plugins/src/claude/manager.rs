use super::{settings, ClaudePluginInfo};
use crate::PluginId;
use anyhow::Result;
use std::path::Path;

/// Claude Code Plugin Manager
pub struct ClaudePluginManager {
	pub(super) settings: settings::ClaudeSettings,
	pub(super) installed: Vec<ClaudePluginInfo>,
}

impl ClaudePluginManager {
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

	pub fn plugin_owning_path(&self, path: &Path) -> Option<&ClaudePluginInfo> {
		self.installed.iter().find(|plugin| plugin.owns_path(path))
	}

	/// Check if a plugin is enabled
	pub fn is_enabled(&self, id: &PluginId) -> bool {
		self.settings.is_enabled(id)
	}

	/// Enable a plugin
	/// Returns error if plugin is not installed
	pub fn enable(&mut self, id: &PluginId) -> Result<()> {
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
}
