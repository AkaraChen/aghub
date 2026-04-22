use super::paths::manifest_path;
use super::PluginInstaller;
use crate::claude::{
	settings::ClaudeSettings,
	types::{InstalledPluginInfo, InstalledPluginsManifest},
	ClaudePluginInfo, ClaudePluginManager, PluginScopeInfo,
};
use crate::errors::PluginError;
use crate::PluginId;
use anyhow::Result;
use std::path::{Path, PathBuf};

impl PluginInstaller {
	pub(super) fn scope_is_installed(
		plugin: &ClaudePluginInfo,
		scope: &str,
	) -> bool {
		plugin.scopes.iter().any(|item| item.scope == scope)
	}

	pub(super) fn ensure_scope_not_installed(
		manager: &ClaudePluginManager,
		id: &PluginId,
		scope: &str,
	) -> Result<()> {
		if manager
			.get_plugin(id)
			.is_some_and(|plugin| Self::scope_is_installed(plugin, scope))
		{
			return Err(PluginError::AlreadyInstalled {
				id: id.clone(),
				scope: scope.to_string(),
			}
			.into());
		}

		Ok(())
	}

	pub(super) fn installed_scope<'a>(
		manager: &'a ClaudePluginManager,
		id: &PluginId,
		scope: &str,
	) -> Result<(&'a ClaudePluginInfo, &'a PluginScopeInfo)> {
		let plugin = manager
			.get_plugin(id)
			.ok_or_else(|| anyhow::anyhow!("Plugin '{}' not found", id))?;
		let scope_info = plugin
			.scopes
			.iter()
			.find(|item| item.scope == scope)
			.ok_or_else(|| {
				anyhow::anyhow!(
					"Plugin '{}' is not installed for scope '{}'",
					id,
					scope
				)
			})?;

		Ok((plugin, scope_info))
	}

	pub(super) async fn replace_installation_dir(
		target_dir: &Path,
		staging_dir: &Path,
	) -> Result<()> {
		if target_dir.exists() {
			tokio::fs::remove_dir_all(target_dir).await?;
		}
		if let Some(parent) = target_dir.parent() {
			tokio::fs::create_dir_all(parent).await?;
		}
		tokio::fs::rename(staging_dir, target_dir).await?;
		Ok(())
	}

	pub(super) async fn activate_installation(
		&self,
		id: &PluginId,
		target_dir: &Path,
		staging_dir: &Path,
		install_info: InstalledPluginInfo,
		replaced_path: Option<PathBuf>,
	) -> Result<InstalledPluginInfo> {
		Self::replace_installation_dir(target_dir, staging_dir).await?;
		let previous =
			Self::update_installed_manifest(id, install_info.clone())?;

		ClaudeSettings::update(|settings| {
			settings.set_enabled(id, true);
		})?;

		if let Some(path) = replaced_path
			.or_else(|| previous.map(|info| PathBuf::from(info.install_path)))
		{
			self.cleanup_installation_path_if_unused(&path).await?;
		}

		Ok(install_info)
	}

	pub(super) fn update_installed_manifest(
		id: &PluginId,
		info: InstalledPluginInfo,
	) -> Result<Option<InstalledPluginInfo>> {
		let plugin_id_str = id.to_string();
		let manifest_path = manifest_path()?;
		let mut replaced = None;
		InstalledPluginsManifest::update(&manifest_path, |manifest| {
			replaced = manifest.upsert_installation(plugin_id_str, info);
		})?;
		Ok(replaced)
	}

	pub(super) fn remove_from_manifest(
		id: &PluginId,
		scope: &str,
	) -> Result<Option<InstalledPluginInfo>> {
		let plugin_id_str = id.to_string();
		let manifest_path = manifest_path()?;
		let mut removed = None;
		InstalledPluginsManifest::update(&manifest_path, |manifest| {
			removed = manifest.remove_installation(&plugin_id_str, scope);
		})?;
		Ok(removed)
	}
}
