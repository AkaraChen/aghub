//! Claude Code Plugin System Support
//!
//! Handles Claude Code's plugin v2 format:
//! - `~/.claude/plugins/installed_plugins.json` - Plugin manifest
//! - `~/.claude/settings.json` - `enabledPlugins` configuration
//! - `~/.claude/plugins/cache/<source>/<name>/` - Plugin cache directory

mod capabilities;
mod info;
mod installed;
mod manager;
mod manifest;

pub mod settings;
pub mod types;

pub use self::info::{ClaudePluginInfo, PluginScopeInfo};
pub use self::manager::ClaudePluginManager;

#[cfg(test)]
mod tests {
	use super::*;
	use crate::test_support::env_lock;
	use crate::PluginId;
	use anyhow::Result;
	use std::path::PathBuf;
	use std::time::{SystemTime, UNIX_EPOCH};

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
