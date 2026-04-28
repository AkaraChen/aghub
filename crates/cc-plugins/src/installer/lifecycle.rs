use super::marketplace::is_marketplace_source;
use super::paths::{
	cleanup_empty_dirs, manifest_path, plugin_install_root, staging_dir_for,
	storage_key_for_source,
};
use super::registry::{GitHubRegistry, PluginRegistryKind};
use super::source::{classify_registry_source, RegistrySource};
use super::PluginInstaller;
use crate::claude::{
	settings::{ClaudeSettings, InstallScope},
	types::{InstalledPluginInfo, InstalledPluginsManifest},
	ClaudePluginInfo, ClaudePluginManager, PluginScopeInfo,
};
use crate::errors::PluginError;
use crate::PluginId;
use anyhow::Result;
use chrono::Utc;
use std::path::{Path, PathBuf};

// ── Version helpers ──

fn is_semantic_version(ver: &str) -> bool {
	ver.chars()
		.next()
		.map(|c| c.is_ascii_digit())
		.unwrap_or(false)
		&& ver.contains('.')
}

fn compare_versions(a: &str, b: &str) -> i32 {
	let a_clean = a.split('+').next().unwrap_or(a);
	let b_clean = b.split('+').next().unwrap_or(b);

	match (
		semver::Version::parse(a_clean),
		semver::Version::parse(b_clean),
	) {
		(Ok(a_ver), Ok(b_ver)) => match a_ver.cmp(&b_ver) {
			std::cmp::Ordering::Less => -1,
			std::cmp::Ordering::Equal => 0,
			std::cmp::Ordering::Greater => 1,
		},
		_ => {
			let parse = |s: &str| {
				s.split('.')
					.filter_map(|part| part.parse::<u32>().ok())
					.collect::<Vec<_>>()
			};

			let a_parts = parse(a);
			let b_parts = parse(b);

			for (a_part, b_part) in a_parts.iter().zip(b_parts.iter()) {
				match a_part.cmp(b_part) {
					std::cmp::Ordering::Less => return -1,
					std::cmp::Ordering::Greater => return 1,
					std::cmp::Ordering::Equal => continue,
				}
			}

			match a_parts.len().cmp(&b_parts.len()) {
				std::cmp::Ordering::Less => -1,
				std::cmp::Ordering::Equal => 0,
				std::cmp::Ordering::Greater => 1,
			}
		}
	}
}

// ── State helpers ──

impl PluginInstaller {
	fn scope_is_installed(plugin: &ClaudePluginInfo, scope: &str) -> bool {
		plugin.scopes.iter().any(|item| item.scope == scope)
	}

	fn ensure_scope_not_installed(
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

	fn installed_scope<'a>(
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

	async fn replace_installation_dir(
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

	async fn activate_installation(
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

	fn update_installed_manifest(
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

	fn remove_from_manifest(
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

// ── Lifecycle ──

impl PluginInstaller {
	async fn resolve_registry(
		&self,
		id: &PluginId,
	) -> Result<(PluginRegistryKind, String)> {
		if is_marketplace_source(&self.marketplace_root, &id.source) {
			return Ok((
				PluginRegistryKind::Marketplace(
					self.marketplace_registry(&id.source)?,
				),
				id.source.clone(),
			));
		}

		let storage_key = storage_key_for_source(&id.source, |source| {
			is_marketplace_source(&self.marketplace_root, source)
		});
		Ok((self.get_registry(&id.source)?, storage_key))
	}

	async fn install_into_scope(
		&self,
		id: &PluginId,
		scope: InstallScope,
		replaced_path: Option<PathBuf>,
	) -> Result<InstalledPluginInfo> {
		let (registry, storage_key) = self.resolve_registry(id).await?;
		let manifest = registry.fetch_manifest(&id.name).await?;
		let (mut version_dir, registry_commit_sha) = registry
			.get_latest_version(&id.name)
			.await?
			.map_or(("latest".to_string(), None), |info| info);
		if version_dir == "latest" {
			if let Some(sha) = &registry_commit_sha {
				version_dir = sha.chars().take(12).collect();
			}
		}
		let target_dir =
			plugin_install_root(&self.cache_root, &storage_key, &id.name)
				.join(&version_dir);
		let staging_dir = staging_dir_for(&target_dir)?;

		if staging_dir.exists() {
			if let Err(e) = tokio::fs::remove_dir_all(&staging_dir).await {
				log::warn!(
					"Failed to clean up staging dir {}: {e}",
					staging_dir.display()
				);
			}
		}

		let actual_commit = match registry.install(&id.name, &staging_dir).await
		{
			Ok(commit) => commit,
			Err(error) => {
				if staging_dir.exists() {
					if let Err(e) =
						tokio::fs::remove_dir_all(&staging_dir).await
					{
						log::warn!(
							"Failed to clean up staging dir {}: {e}",
							staging_dir.display()
						);
					}
				}
				return Err(error);
			}
		};

		let now = Utc::now().to_rfc3339();
		let install_info = InstalledPluginInfo {
			scope: scope.to_string(),
			install_path: target_dir.to_string_lossy().to_string(),
			version: manifest.version.unwrap_or(version_dir),
			installed_at: now.clone(),
			last_updated: now,
			git_commit_sha: registry_commit_sha.or(actual_commit),
		};
		self.activate_installation(
			id,
			&target_dir,
			&staging_dir,
			install_info,
			replaced_path,
		)
		.await
	}

	async fn cleanup_installation_path_if_unused(
		&self,
		install_path: &Path,
	) -> Result<()> {
		let manifest_path = manifest_path()?;
		let install_path_string = install_path.to_string_lossy().to_string();
		let is_referenced = InstalledPluginsManifest::load(&manifest_path)?
			.has_install_path_reference(&install_path_string);

		if is_referenced || !install_path.exists() {
			return Ok(());
		}

		tokio::fs::remove_dir_all(install_path).await?;
		cleanup_empty_dirs(&self.cache_root, install_path).await
	}

	pub async fn is_installed(
		&self,
		id: &PluginId,
		scope: InstallScope,
	) -> bool {
		let manager = match ClaudePluginManager::new() {
			Ok(m) => m,
			Err(_) => return false,
		};

		manager.get_plugin(id).is_some_and(|plugin| {
			Self::scope_is_installed(plugin, &scope.to_string())
		})
	}

	pub async fn install(
		&self,
		id: &PluginId,
		scope: InstallScope,
	) -> Result<InstalledPluginInfo> {
		let manager = ClaudePluginManager::new()?;
		let scope_str = scope.to_string();
		Self::ensure_scope_not_installed(&manager, id, &scope_str)?;

		self.install_into_scope(id, scope, None).await
	}

	pub async fn uninstall(
		&self,
		id: &PluginId,
		scope: InstallScope,
		keep_data: bool,
	) -> Result<()> {
		let manager = ClaudePluginManager::new()?;
		let scope_str = scope.to_string();
		let (plugin, scope_info) =
			Self::installed_scope(&manager, id, &scope_str)?;

		let removed = Self::remove_from_manifest(id, &scope_str)?;
		let removed_path = removed
			.as_ref()
			.map(|info| PathBuf::from(&info.install_path))
			.unwrap_or_else(|| scope_info.install_path.clone());

		if !keep_data {
			self.cleanup_installation_path_if_unused(&removed_path)
				.await?;
		}

		let remaining_scopes: Vec<_> = plugin
			.scopes
			.iter()
			.filter(|s| s.scope != scope_str)
			.collect();

		if remaining_scopes.is_empty() {
			ClaudeSettings::update(|settings| {
				settings.set_enabled(id, false);
			})?;
		}

		Ok(())
	}

	pub async fn update(
		&self,
		id: &PluginId,
		scope: InstallScope,
	) -> Result<InstalledPluginInfo> {
		let manager = ClaudePluginManager::new()?;
		let scope_str = scope.to_string();
		let (_, scope_info) = Self::installed_scope(&manager, id, &scope_str)?;
		let update_info = self
			.check_update_against(
				id,
				&scope_info.version,
				scope_info.git_commit_sha.as_deref(),
			)
			.await?;

		if update_info.is_none() {
			return Err(PluginError::AlreadyUpToDate { id: id.clone() }.into());
		}

		self.install_into_scope(
			id,
			scope,
			Some(scope_info.install_path.clone()),
		)
		.await
	}

	pub async fn check_update_against(
		&self,
		id: &PluginId,
		current_ver: &str,
		current_commit: Option<&str>,
	) -> Result<Option<(String, Option<String>)>> {
		let registry = self.get_registry(&id.source)?;
		let latest = registry.get_latest_version(&id.name).await?;

		if let Some((latest_ver, latest_sha)) = latest {
			let needs_update = if is_semantic_version(current_ver)
				&& is_semantic_version(&latest_ver)
			{
				compare_versions(&latest_ver, current_ver) > 0
			} else {
				match latest_sha.as_deref() {
					Some(new) => Some(new) != current_commit,
					None => latest_ver != *current_ver,
				}
			};

			if needs_update {
				return Ok(Some((latest_ver, latest_sha)));
			}
		}

		Ok(None)
	}

	fn get_registry(&self, source: &str) -> Result<PluginRegistryKind> {
		match source {
			source if is_marketplace_source(&self.marketplace_root, source) => {
				Ok(PluginRegistryKind::Marketplace(
					self.marketplace_registry(source)?,
				))
			}
			_ => match classify_registry_source(source) {
				RegistrySource::OfficialRegistry => {
					Ok(PluginRegistryKind::Marketplace(
						self.marketplace_registry("claude-plugins-official")?,
					))
				}
				RegistrySource::GitHub { owner, repo } => {
					Ok(PluginRegistryKind::GitHub(GitHubRegistry::new(
						self.client.clone(),
						&owner,
						&repo,
						None,
					)?))
				}
				RegistrySource::Local { path } => {
					Ok(PluginRegistryKind::Local(
						super::registry::LocalRegistry::new(path),
					))
				}
				RegistrySource::UnsupportedRemote { url } => anyhow::bail!(
					"Unsupported third-party plugin source '{}'. Only GitHub repositories are currently supported",
					url
				),
			},
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_compare_versions() {
		assert_eq!(compare_versions("1.0.0", "1.0.0"), 0);
		assert_eq!(compare_versions("1.1.0", "1.0.0"), 1);
		assert_eq!(compare_versions("1.0.0", "1.1.0"), -1);
		assert_eq!(compare_versions("2.0.0", "1.9.9"), 1);
		assert_eq!(compare_versions("1.0.0-alpha", "1.0.0"), -1);
		assert_eq!(compare_versions("1.0.0-beta", "1.0.0-alpha"), 1);
		assert_eq!(compare_versions("1.0.0+build1", "1.0.0+build2"), 0);
		assert_eq!(compare_versions("1.0", "1.0.0"), -1);
		assert_eq!(compare_versions("1.0.0", "1.0"), 1);
		assert_eq!(compare_versions("1.2", "1.10"), -1);
		assert_eq!(compare_versions("abc", "def"), 0);
	}

	#[test]
	fn test_is_semantic_version() {
		assert!(is_semantic_version("1.0.0"));
		assert!(is_semantic_version("2.1.0-beta"));
		assert!(!is_semantic_version("abc123"));
		assert!(!is_semantic_version("latest"));
	}
}
