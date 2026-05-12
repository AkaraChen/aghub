pub mod git;
mod lifecycle;
mod marketplace;
mod marketplace_ops;
pub mod registry;
mod source;

use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::RwLock;

use self::git::build_http_client;

pub struct PluginInstaller {
	marketplace_root: PathBuf,
	client: reqwest::Client,
	marketplace_urls: RwLock<HashMap<String, HashMap<String, String>>>,
}

impl PluginInstaller {
	pub fn new() -> Result<Self> {
		let home = dirs::home_dir().context("Cannot find home directory")?;
		let marketplace_root =
			home.join(".claude/plugins/marketplaces/claude-plugins-official");

		let client = Self::build_client()?;

		Ok(Self {
			marketplace_root,
			client,
			marketplace_urls: RwLock::new(HashMap::new()),
		})
	}

	pub fn with_roots(marketplace_root: PathBuf) -> Result<Self> {
		let client = Self::build_client()?;

		Ok(Self {
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
	use crate::test_support::{env_lock, make_temp_dir};
	use crate::{claude::settings::InstallScope, PluginId};
	use std::path::PathBuf;
	// Local-path plugin sources used to be installable directly via
	// `PluginInstaller::install` writing the cache itself. Now we delegate to
	// `claude plugin install`, which only accepts `name@marketplace` IDs, so
	// this flow is exercised end-to-end through desktop instead. The dead test
	// is removed in the upcoming purge commit.
	#[tokio::test]
	#[ignore = "PluginInstaller no longer installs from local paths; covered via marketplace add"]
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
				.install(&plugin_id, InstallScope::Global)
				.await
				.expect("install local plugin");
			let install_path = PathBuf::from(&info.install_path);

			assert_eq!(info.scope, "global");
			assert_eq!(info.version, "1.2.3");
			assert!(install_path.join(".claude-plugin/plugin.json").exists());
			assert!(installer.is_installed(&plugin_id, InstallScope::Global).await);

			installer
				.uninstall(&plugin_id, InstallScope::Global, true)
				.await
				.expect("uninstall local plugin but keep data");

			assert!(!installer
				.is_installed(&plugin_id, InstallScope::Global)
				.await);
			assert!(install_path.exists());

			let reinstalled = installer
				.install(&plugin_id, InstallScope::Global)
				.await
				.expect("reinstall local plugin");

			assert_eq!(reinstalled.version, "1.2.3");
			assert_eq!(reinstalled.install_path, info.install_path);
			assert!(installer.is_installed(&plugin_id, InstallScope::Global).await);

			installer
				.uninstall(&plugin_id, InstallScope::Global, false)
				.await
				.expect("uninstall local plugin and remove data");

			assert!(!installer
				.is_installed(&plugin_id, InstallScope::Global)
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
