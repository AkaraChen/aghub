pub mod git;
mod marketplace;
mod paths;
pub mod registry;
mod source;
mod version;

use crate::claude::{
	settings::{ClaudeSettings, InstallScope},
	types::InstalledPluginInfo,
	ClaudePluginInfo, ClaudePluginManager, PluginScopeInfo,
};
use crate::{lockfile::LockedPlugin, PluginId};
use anyhow::{Context, Result};
use chrono::Utc;
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use tempfile::Builder;

use self::git::{build_http_client, GitBasedInstaller};
use self::marketplace::{
	is_marketplace_source, load_marketplace_repository_urls,
	marketplace_path_for, resolve_marketplace_source,
};
use self::paths::{
	cleanup_empty_dirs, manifest_path, scope_root, staging_dir_for,
	storage_key_for_source,
};
use self::registry::{
	copy_dir_all, normalize_repository_url, remote_plugin_candidates,
	repository_archive_urls, resolve_plugin_dir_with_wrappers, GitHubRegistry,
	PluginRegistry,
};
use self::source::{classify_registry_source, RegistrySource};
use self::version::{compare_versions, is_semantic_version};

pub struct PluginInstaller {
	cache_root: PathBuf,
	marketplace_root: PathBuf,
	client: reqwest::Client,
	marketplace_urls: RwLock<HashMap<String, HashMap<String, String>>>,
}

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
			anyhow::bail!(
				"Plugin '{}' is already installed for scope '{}'",
				id,
				scope
			);
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

	fn marketplace_registry(
		&self,
		marketplace: &str,
	) -> Result<registry::MarketplaceRegistry> {
		if marketplace == "claude-plugins-official" {
			return registry::MarketplaceRegistry::new_official().context(
				"Official marketplace not found. Please clone it first: git clone https://github.com/anthropics/claude-plugins-official ~/.claude/plugins/marketplaces/claude-plugins-official",
			);
		}

		let marketplace_path =
			marketplace_path_for(&self.marketplace_root, marketplace);
		let marketplace_json =
			marketplace_path.join(".claude-plugin/marketplace.json");
		if !marketplace_json.exists() {
			anyhow::bail!("Marketplace '{}' not found", marketplace);
		}

		registry::MarketplaceRegistry::new(
			marketplace_path,
			vec!["plugins/".to_string(), "external_plugins/".to_string()],
		)
	}

	pub async fn update_marketplaces(&self) -> Result<Vec<String>> {
		let mut updated = Vec::new();
		let mut failed = Vec::new();

		for marketplace in self.discover_marketplaces()? {
			match self.marketplace_registry(&marketplace) {
				Ok(registry) => match registry.update().await {
					Ok(()) => updated.push(marketplace),
					Err(error) => {
						failed.push(format!("{marketplace}: {error}"))
					}
				},
				Err(error) => failed.push(format!("{marketplace}: {error}")),
			}
		}

		if !failed.is_empty() {
			anyhow::bail!(
				"Failed to update marketplaces: {}",
				failed.join("; ")
			);
		}

		Ok(updated)
	}

	fn discover_marketplaces(&self) -> Result<Vec<String>> {
		let marketplaces_dir = self
			.marketplace_root
			.parent()
			.unwrap_or(self.marketplace_root.as_path());
		let mut marketplaces =
			BTreeSet::from(["claude-plugins-official".to_string()]);

		if marketplaces_dir.exists() {
			for entry in std::fs::read_dir(marketplaces_dir)? {
				let path = entry?.path();
				if !path.is_dir()
					|| !path.join(".claude-plugin/marketplace.json").exists()
				{
					continue;
				}
				if let Some(name) =
					path.file_name().and_then(|value| value.to_str())
				{
					marketplaces.insert(name.to_string());
				}
			}
		}

		Ok(marketplaces.into_iter().collect())
	}

	pub fn marketplace_repository_url(&self, id: &PluginId) -> Option<String> {
		if !is_marketplace_source(&self.marketplace_root, &id.source) {
			return None;
		}

		if let Some(url) = self
			.marketplace_urls
			.read()
			.ok()?
			.get(&id.source)
			.and_then(|urls| urls.get(&id.name).cloned())
		{
			return Some(url);
		}

		let urls = load_marketplace_repository_urls(
			&self.marketplace_root,
			&id.source,
		);
		let url = urls.get(&id.name).cloned();
		self.marketplace_urls
			.write()
			.ok()?
			.insert(id.source.clone(), urls);
		url
	}

	pub fn can_reinstall(&self, id: &PluginId) -> bool {
		if is_marketplace_source(&self.marketplace_root, &id.source) {
			return true;
		}

		match classify_registry_source(&id.source) {
			RegistrySource::OfficialRegistry => {
				self.marketplace_registry("claude-plugins-official").is_ok()
			}
			RegistrySource::GitHub { .. } => true,
			RegistrySource::Local { path } => path.exists(),
			RegistrySource::UnsupportedRemote { .. } => false,
		}
	}

	pub fn can_check_updates(&self, id: &PluginId) -> bool {
		if is_marketplace_source(&self.marketplace_root, &id.source) {
			return true;
		}

		match classify_registry_source(&id.source) {
			RegistrySource::OfficialRegistry => {
				self.marketplace_registry("claude-plugins-official").is_ok()
			}
			RegistrySource::GitHub { .. } => true,
			RegistrySource::Local { .. }
			| RegistrySource::UnsupportedRemote { .. } => false,
		}
	}

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

	async fn resolve_registry(
		&self,
		id: &PluginId,
	) -> Result<(Box<dyn PluginRegistry>, String)> {
		if is_marketplace_source(&self.marketplace_root, &id.source) {
			let (resolved_source, is_remote) = resolve_marketplace_source(
				&self.marketplace_root,
				&id.source,
				&id.name,
			)
			.await?;
			let storage_key = if is_remote {
				format!("{:x}", md5::compute(&resolved_source))
			} else {
				id.source.clone()
			};
			return Ok((
				Box::new(self.marketplace_registry(&id.source)?)
					as Box<dyn PluginRegistry>,
				storage_key,
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
		let (version_dir, registry_commit_sha) = registry
			.get_latest_version(&id.name)
			.await?
			.map_or(("latest".to_string(), None), |info| info);
		let target_dir =
			scope_root(&self.cache_root, &storage_key, &id.name, scope)
				.join(&version_dir);
		let staging_dir = staging_dir_for(&target_dir)?;

		if staging_dir.exists() {
			tokio::fs::remove_dir_all(&staging_dir).await.ok();
		}

		let actual_commit = match registry.install(&id.name, &staging_dir).await
		{
			Ok(commit) => commit,
			Err(error) => {
				tokio::fs::remove_dir_all(&staging_dir).await.ok();
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
			git_commit_sha: actual_commit.or(registry_commit_sha),
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

	async fn install_locked_artifact(
		&self,
		id: &PluginId,
		locked: &LockedPlugin,
		target_dir: &Path,
	) -> Result<Option<String>> {
		let resolved = locked.resolved.trim();
		if resolved.is_empty() {
			anyhow::bail!(
				"Locked plugin '{}' has no resolved source",
				locked.id
			);
		}

		let resolved_path = PathBuf::from(resolved);
		if resolved_path.exists() {
			copy_dir_all(&resolved_path, target_dir).await?;
			return Ok(locked.commit_sha.clone());
		}

		let (repository, subdir) = resolved
			.split_once('#')
			.map(|(repo, path)| (repo, Some(path.trim_matches('/'))))
			.unwrap_or((resolved, None));
		let normalized_repository = normalize_repository_url(repository);

		let temp_dir = Builder::new()
			.prefix("aghub-plugin-restore-")
			.tempdir()
			.context("Failed to create restore directory")?;

		let tarball_urls = repository_archive_urls(
			&normalized_repository,
			locked.commit_sha.as_deref(),
		);

		let git_installer = GitBasedInstaller::new()?;
		let mut last_error = None;
		for tarball_url in tarball_urls {
			match git_installer
				.download_and_extract(&tarball_url, "", temp_dir.path())
				.await
			{
				Ok(_) => {
					let candidates = match subdir {
						Some(path) if !path.is_empty() => {
							vec![PathBuf::from(path)]
						}
						_ => remote_plugin_candidates(&id.name),
					};
					let source_dir = resolve_plugin_dir_with_wrappers(
						temp_dir.path(),
						&candidates,
					)
					.ok_or_else(|| {
						anyhow::anyhow!(
							"Plugin root not found while restoring locked plugin '{}'",
							locked.id
						)
					})?;
					let copy_result =
						copy_dir_all(&source_dir, target_dir).await;
					copy_result?;
					return Ok(locked.commit_sha.clone());
				}
				Err(error) => last_error = Some(error),
			}
		}

		if let Some(error) = last_error {
			return Err(error).context(format!(
				"Failed to restore locked plugin '{}'",
				locked.id
			));
		}

		anyhow::bail!(
			"No archive URL available for locked plugin '{}'",
			locked.id
		)
	}

	pub async fn install_locked(
		&self,
		id: &PluginId,
		scope: InstallScope,
		locked: &LockedPlugin,
	) -> Result<InstalledPluginInfo> {
		let manager = ClaudePluginManager::new()?;
		let scope_str = scope.to_string();
		Self::ensure_scope_not_installed(&manager, id, &scope_str)?;

		let storage_key = storage_key_for_source(&locked.source, |source| {
			is_marketplace_source(&self.marketplace_root, source)
		});
		let version_dir = if locked.version.trim().is_empty() {
			"latest"
		} else {
			locked.version.as_str()
		};
		let target_dir =
			scope_root(&self.cache_root, &storage_key, &id.name, scope)
				.join(version_dir);
		let staging_dir = staging_dir_for(&target_dir)?;

		if staging_dir.exists() {
			tokio::fs::remove_dir_all(&staging_dir).await.ok();
		}

		if let Err(error) =
			self.install_locked_artifact(id, locked, &staging_dir).await
		{
			tokio::fs::remove_dir_all(&staging_dir).await.ok();
			return Err(error);
		}

		let now = Utc::now().to_rfc3339();
		let install_info = InstalledPluginInfo {
			scope: scope_str.clone(),
			install_path: target_dir.to_string_lossy().to_string(),
			version: version_dir.to_string(),
			installed_at: now.clone(),
			last_updated: now,
			git_commit_sha: locked.commit_sha.clone(),
		};
		self.activate_installation(
			id,
			&target_dir,
			&staging_dir,
			install_info,
			None,
		)
		.await
	}

	async fn cleanup_installation_path_if_unused(
		&self,
		install_path: &Path,
	) -> Result<()> {
		let manifest_path = manifest_path()?;
		let install_path_string = install_path.to_string_lossy().to_string();
		let is_referenced =
			crate::claude::types::InstalledPluginsManifest::load(
				&manifest_path,
			)?
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
			anyhow::bail!("Plugin '{}' is already up to date", id);
		}
		let existing_path = scope_info.install_path.clone();

		self.install_into_scope(id, scope, Some(existing_path))
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

	fn get_registry(
		&self,
		source: &str,
	) -> anyhow::Result<Box<dyn PluginRegistry>> {
		match source {
			source if is_marketplace_source(&self.marketplace_root, source) => {
				Ok(Box::new(self.marketplace_registry(source)?))
			}
			_ => match classify_registry_source(source) {
				RegistrySource::OfficialRegistry => Ok(Box::new(
					self.marketplace_registry("claude-plugins-official")?,
				)),
				RegistrySource::GitHub { owner, repo } => {
					Ok(Box::new(GitHubRegistry::new(
						self.client.clone(),
						&owner,
						&repo,
						None,
					)?))
				}
				RegistrySource::Local { path } => {
					Ok(Box::new(registry::LocalRegistry::new(path)))
				}
				RegistrySource::UnsupportedRemote { url } => anyhow::bail!(
					"Unsupported third-party plugin source '{}'. Only GitHub repositories are currently supported",
					url
				),
			}
		}
	}

	fn update_installed_manifest(
		id: &PluginId,
		info: InstalledPluginInfo,
	) -> Result<Option<InstalledPluginInfo>> {
		use crate::claude::types::InstalledPluginsManifest;

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
		use crate::claude::types::InstalledPluginsManifest;

		let plugin_id_str = id.to_string();
		let manifest_path = manifest_path()?;
		let mut removed = None;
		InstalledPluginsManifest::update(&manifest_path, |manifest| {
			removed = manifest.remove_installation(&plugin_id_str, scope);
		})?;
		Ok(removed)
	}
}
