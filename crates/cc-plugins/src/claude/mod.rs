//! Claude Code Plugin System Support
//!
//! Handles Claude Code's plugin v2 format:
//! - `~/.claude/plugins/installed_plugins.json` - Plugin manifest
//! - `~/.claude/settings.json` - `enabledPlugins` configuration
//! - `~/.claude/plugins/cache/<source>/<name>/` - Plugin cache directory

mod capabilities;
mod installed;
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

#[cfg(test)]
mod tests {
	use super::*;
	use crate::test_support::{env_lock, make_temp_dir};
	use crate::PluginId;
	use anyhow::Result;

	#[test]
	fn manager_discovers_plugins_missing_from_manifest_via_cache() {
		let _guard = env_lock().blocking_lock();
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

			let manager =
				ClaudePluginManager::new_with_plugins_dir(&plugins_dir)?;
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
		let _guard = env_lock().blocking_lock();
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

	#[test]
	fn manager_discovers_scope_partitioned_cache_installations() {
		let _guard = env_lock().blocking_lock();
		let temp_home = make_temp_dir("aghub-claude-home-scoped");
		let previous_home = std::env::var_os("HOME");

		std::env::set_var("HOME", &temp_home);

		let result = (|| -> Result<()> {
			let settings_dir = temp_home.join(".claude");
			let plugins_dir = settings_dir.join("plugins");
			let cache_dir = plugins_dir
				.join("cache")
				.join("claude-plugins-official")
				.join("context7")
				.join("scopes")
				.join("project")
				.join("1.2.3")
				.join(".claude-plugin");

			std::fs::create_dir_all(&cache_dir)?;
			std::fs::write(
				settings_dir.join("settings.json"),
				r#"{"enabledPlugins":{"context7@claude-plugins-official":true}}"#,
			)?;
			std::fs::create_dir_all(&plugins_dir)?;
			std::fs::write(
				plugins_dir.join("installed_plugins.json"),
				r#"{"version":2,"plugins":{}}"#,
			)?;
			std::fs::write(
				cache_dir.join("plugin.json"),
				r#"{"name":"context7","version":"1.2.3","description":"test","author":{"name":"A"}}"#,
			)?;

			let manager =
				ClaudePluginManager::new_with_plugins_dir(&plugins_dir)?;
			let plugin = manager
				.get_plugin(&PluginId::parse(
					"context7@claude-plugins-official",
				)?)
				.ok_or_else(|| {
					anyhow::anyhow!("context7 plugin not discovered")
				})?;

			assert_eq!(plugin.version, "1.2.3");
			assert_eq!(plugin.install_path, cache_dir.parent().unwrap());
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
