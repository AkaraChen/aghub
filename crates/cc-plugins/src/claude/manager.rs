use super::manifest::read_manifest;
use super::{settings, ClaudePluginInfo, PluginScopeInfo};
use crate::cli::types::CliInstalledPlugin;
use crate::cli::ClaudeCli;
use crate::{PluginId, PluginSource};
use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub struct ClaudePluginManager {
	pub(super) settings: settings::ClaudeSettings,
	pub(super) installed: Vec<ClaudePluginInfo>,
}

impl ClaudePluginManager {
	pub async fn new() -> Result<Self> {
		let settings_path = dirs::home_dir()
			.context("Cannot find home directory")?
			.join(".claude/settings.json");
		let settings =
			settings::ClaudeSettings::load_from_path(&settings_path)?;
		let installed = load_via_cli().await?;
		Ok(Self {
			settings,
			installed,
		})
	}

	pub fn get_plugin(&self, id: &PluginId) -> Option<&ClaudePluginInfo> {
		self.installed.iter().find(|p| p.id == *id)
	}

	pub fn list_plugins(&self) -> &[ClaudePluginInfo] {
		&self.installed
	}

	pub fn plugin_owning_path(&self, path: &Path) -> Option<&ClaudePluginInfo> {
		self.installed.iter().find(|plugin| plugin.owns_path(path))
	}

	pub fn is_enabled(&self, id: &PluginId) -> bool {
		self.installed
			.iter()
			.find(|p| p.id == *id)
			.map(|p| p.enabled)
			.unwrap_or(false)
	}

	pub async fn enable(
		&mut self,
		id: &PluginId,
		scope: Option<settings::InstallScope>,
	) -> Result<()> {
		let cli = ClaudeCli::new()?;
		cli.plugin_enable(id, scope).await?;
		self.refresh_after_toggle().await
	}

	pub async fn disable(
		&mut self,
		id: &PluginId,
		scope: Option<settings::InstallScope>,
	) -> Result<()> {
		let cli = ClaudeCli::new()?;
		cli.plugin_disable(id, scope).await?;
		self.refresh_after_toggle().await
	}

	async fn refresh_after_toggle(&mut self) -> Result<()> {
		self.installed = load_via_cli().await?;
		Ok(())
	}

	pub fn get_plugin_config(
		&self,
		id: &PluginId,
	) -> Option<&serde_json::Value> {
		self.settings.get_plugin_config(id)
	}

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

	pub fn remove_plugin_config(&mut self, id: &PluginId) -> Result<()> {
		settings::ClaudeSettings::update(|settings| {
			settings.remove_plugin_config(id);
		})?;
		self.settings.remove_plugin_config(id);
		Ok(())
	}
}

async fn load_via_cli() -> Result<Vec<ClaudePluginInfo>> {
	let cli = ClaudeCli::new()?;
	let cli_plugins = cli.plugin_list().await?;

	let mut by_id: HashMap<String, Vec<CliInstalledPlugin>> = HashMap::new();
	for plugin in cli_plugins {
		by_id.entry(plugin.id.clone()).or_default().push(plugin);
	}

	let mut plugins = Vec::with_capacity(by_id.len());
	for (id_str, scope_entries) in by_id {
		if let Some(plugin) = build_plugin_info(id_str, scope_entries) {
			plugins.push(plugin);
		}
	}
	Ok(plugins)
}

fn build_plugin_info(
	id_str: String,
	scope_entries: Vec<CliInstalledPlugin>,
) -> Option<ClaudePluginInfo> {
	let id = PluginId::parse(&id_str).ok()?;
	let source = PluginSource::parse(&id.source)
		.unwrap_or(PluginSource::OfficialRegistry);
	let display_name = id.name.clone();

	let primary = &scope_entries[0];
	let install_path = PathBuf::from(&primary.install_path);
	let manifest = read_manifest(&install_path).ok().flatten();

	let scopes = scope_entries
		.iter()
		.map(|entry| PluginScopeInfo {
			scope: cli_scope_to_aghub(&entry.scope),
			install_path: PathBuf::from(&entry.install_path),
			version: entry.version.clone(),
			installed_at: entry.installed_at.clone(),
			last_updated: entry.last_updated.clone(),
			git_commit_sha: None,
		})
		.collect();

	let enabled = scope_entries.iter().any(|entry| entry.enabled);
	Some(ClaudePluginInfo {
		id,
		display_name,
		version: primary.version.clone(),
		description: manifest.as_ref().map(|m| m.description.clone()),
		author: manifest
			.as_ref()
			.and_then(|m| (!m.author.is_empty()).then(|| m.author.clone())),
		repository: manifest.as_ref().and_then(|m| m.repository.clone()),
		license: manifest.as_ref().and_then(|m| m.license.clone()),
		keywords: manifest.as_ref().and_then(|m| m.keywords.clone()),
		source,
		install_path,
		enabled,
		commit_hash: String::new(),
		scopes,
	})
}

fn cli_scope_to_aghub(cli_scope: &str) -> String {
	match cli_scope {
		"user" => "global".to_string(),
		// project, local, managed map through as-is
		other => other.to_string(),
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::cli::types::CliInstalledPlugin;

	fn make_cli_entry(id: &str, enabled: bool) -> CliInstalledPlugin {
		CliInstalledPlugin {
			id: id.to_string(),
			version: "1.0.0".to_string(),
			scope: "user".to_string(),
			enabled,
			install_path: "/tmp/x".to_string(),
			installed_at: "2026-01-01T00:00:00.000Z".to_string(),
			last_updated: "2026-01-02T00:00:00.000Z".to_string(),
		}
	}

	#[test]
	fn build_plugin_info_carries_cli_enabled_through() {
		let info = build_plugin_info(
			"foo@bar".to_string(),
			vec![make_cli_entry("foo@bar", true)],
		)
		.expect("plugin info");
		assert!(info.enabled);

		let info = build_plugin_info(
			"foo@bar".to_string(),
			vec![make_cli_entry("foo@bar", false)],
		)
		.expect("plugin info");
		assert!(!info.enabled);
	}

	#[test]
	fn build_plugin_info_aggregates_multiple_scopes_enabled() {
		let info = build_plugin_info(
			"foo@bar".to_string(),
			vec![
				make_cli_entry("foo@bar", false),
				make_cli_entry("foo@bar", true),
			],
		)
		.expect("plugin info");
		assert!(info.enabled);

		let info = build_plugin_info(
			"foo@bar".to_string(),
			vec![
				make_cli_entry("foo@bar", false),
				make_cli_entry("foo@bar", false),
			],
		)
		.expect("plugin info");
		assert!(!info.enabled);
	}
}
