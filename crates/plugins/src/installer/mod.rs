pub mod git;
mod lifecycle;
mod marketplace;
mod marketplaces;
mod paths;
pub mod registry;
mod source;
mod state;
mod version;

use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::RwLock;

use self::git::build_http_client;

pub struct PluginInstaller {
	cache_root: PathBuf,
	marketplace_root: PathBuf,
	client: reqwest::Client,
	marketplace_urls: RwLock<HashMap<String, HashMap<String, String>>>,
}

impl PluginInstaller {
	pub fn new() -> Result<Self> {
		let home = dirs::home_dir().context("Cannot find home directory")?;
		let cache_root = home.join(".claude/plugins/cache");
		let marketplace_root =
			home.join(".claude/plugins/marketplaces/claude-plugins-official");

		let client = Self::build_client()?;

		Ok(Self {
			cache_root,
			marketplace_root,
			client,
			marketplace_urls: RwLock::new(HashMap::new()),
		})
	}

	pub fn with_roots(
		cache_root: PathBuf,
		marketplace_root: PathBuf,
	) -> Result<Self> {
		let client = Self::build_client()?;

		Ok(Self {
			cache_root,
			marketplace_root,
			client,
			marketplace_urls: RwLock::new(HashMap::new()),
		})
	}

	fn build_client() -> Result<reqwest::Client> {
		build_http_client(60)
			.context("Failed to create plugin installer HTTP client")
	}
}

#[cfg(test)]
mod tests {
	use super::PluginInstaller;
	use crate::test_support::env_lock;
	use crate::{claude::settings::InstallScope, PluginId};
	use std::path::PathBuf;
	use std::time::{SystemTime, UNIX_EPOCH};
	use tempfile::tempdir;

	fn create_installer(
		marketplace_root: std::path::PathBuf,
	) -> PluginInstaller {
		let cache_root = marketplace_root
			.parent()
			.unwrap_or(marketplace_root.as_path())
			.join("cache");
		PluginInstaller::with_roots(cache_root, marketplace_root)
			.expect("installer")
	}

	fn make_temp_dir(prefix: &str) -> PathBuf {
		let unique = SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.expect("system time")
			.as_nanos();
		let path = std::env::temp_dir().join(format!("{prefix}-{unique}"));
		std::fs::create_dir_all(&path).expect("temp dir");
		path
	}

	#[test]
	fn discover_marketplaces_skips_missing_official_snapshot() {
		let temp = tempdir().expect("tempdir");
		let marketplaces_dir = temp.path().join("marketplaces");
		let official_root = marketplaces_dir.join("claude-plugins-official");
		let custom_marketplace = marketplaces_dir.join("custom-market");

		std::fs::create_dir_all(custom_marketplace.join(".claude-plugin"))
			.expect("custom marketplace dir");
		std::fs::write(
			custom_marketplace.join(".claude-plugin/marketplace.json"),
			"{}",
		)
		.expect("custom marketplace manifest");

		let installer = create_installer(official_root);

		assert_eq!(
			installer.discover_marketplaces().expect("discover"),
			vec!["custom-market".to_string()],
		);
	}

	#[test]
	fn discover_marketplaces_includes_official_when_snapshot_exists() {
		let temp = tempdir().expect("tempdir");
		let marketplaces_dir = temp.path().join("marketplaces");
		let official_root = marketplaces_dir.join("claude-plugins-official");
		let custom_marketplace = marketplaces_dir.join("custom-market");

		std::fs::create_dir_all(&official_root)
			.expect("official marketplace dir");
		std::fs::create_dir_all(custom_marketplace.join(".claude-plugin"))
			.expect("custom marketplace dir");
		std::fs::write(
			custom_marketplace.join(".claude-plugin/marketplace.json"),
			"{}",
		)
		.expect("custom marketplace manifest");

		let installer = create_installer(official_root);

		assert_eq!(
			installer.discover_marketplaces().expect("discover"),
			vec![
				"claude-plugins-official".to_string(),
				"custom-market".to_string(),
			],
		);
	}

	#[tokio::test]
	async fn local_source_install_reinstall_uninstall_flow_succeeds() {
		let _guard = env_lock().lock().await;
		let temp_home = make_temp_dir("aghub-plugin-install-home");
		let previous_home = std::env::var_os("HOME");

		std::env::set_var("HOME", &temp_home);

		let result = async {
			let plugin_source = temp_home.join("plugin-source");
			let manifest_dir = plugin_source.join(".claude-plugin");
			std::fs::create_dir_all(&manifest_dir).expect("manifest dir");
			std::fs::create_dir_all(plugin_source.join("skills/demo-skill"))
				.expect("skill dir");
			std::fs::write(
				manifest_dir.join("plugin.json"),
				r#"{"name":"demo","version":"1.2.3","description":"test","author":{"name":"A"}}"#,
			)
			.expect("manifest");
			std::fs::write(
				plugin_source.join("skills/demo-skill/SKILL.md"),
				"# demo\n",
			)
			.expect("skill");

			let installer = PluginInstaller::new().expect("installer");
			let plugin_id = PluginId::parse(&format!(
				"demo@{}",
				plugin_source.display()
			))
			.expect("plugin id");

			let info = installer
				.install(&plugin_id, InstallScope::User)
				.await
				.expect("install local plugin");
			let install_path = PathBuf::from(&info.install_path);

			assert_eq!(info.scope, "user");
			assert_eq!(info.version, "1.2.3");
			assert!(install_path.join(".claude-plugin/plugin.json").exists());
			assert!(installer.is_installed(&plugin_id, InstallScope::User).await);

			installer
				.uninstall(&plugin_id, InstallScope::User, true)
				.await
				.expect("uninstall local plugin but keep data");

			assert!(!installer
				.is_installed(&plugin_id, InstallScope::User)
				.await);
			assert!(install_path.exists());

			let reinstalled = installer
				.install(&plugin_id, InstallScope::User)
				.await
				.expect("reinstall local plugin");

			assert_eq!(reinstalled.version, "1.2.3");
			assert_eq!(reinstalled.install_path, info.install_path);
			assert!(installer.is_installed(&plugin_id, InstallScope::User).await);

			installer
				.uninstall(&plugin_id, InstallScope::User, false)
				.await
				.expect("uninstall local plugin and remove data");

			assert!(!installer
				.is_installed(&plugin_id, InstallScope::User)
				.await);
			assert!(!install_path.exists());
		}
		.await;

		match previous_home {
			Some(value) => std::env::set_var("HOME", value),
			None => std::env::remove_var("HOME"),
		}
		std::fs::remove_dir_all(&temp_home).expect("cleanup temp home");

		result
	}
}
