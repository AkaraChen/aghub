//! Plugin installer - standalone implementation without Claude CLI dependency

pub mod git;
pub mod registry;

use crate::claude::{
	settings::{ClaudeSettings, InstallScope},
	types::InstalledPluginInfo,
	ClaudePluginManager,
};
use crate::{lockfile::LockedPlugin, PluginId, PluginSource};
use anyhow::{Context, Result};
use chrono::Utc;
use std::path::{Path, PathBuf};

use self::git::GitBasedInstaller;
use self::registry::{
	copy_dir_all, local_source_remote_fallback, normalize_repository_url,
	remote_plugin_candidates, resolve_plugin_dir_with_wrappers, unique_suffix,
	GitHubRegistry, PluginRegistry,
};
use crate::discovery::{MarketplaceConfig, MarketplaceSource};

struct ResolvedRegistry {
	registry: Box<dyn PluginRegistry>,
	storage_key: String,
}

struct PreparedInstall {
	registry: Box<dyn PluginRegistry>,
	target_dir: PathBuf,
	staging_dir: PathBuf,
	version_label: String,
	registry_commit_sha: Option<String>,
}

/// Plugin installer that manages installation without Claude CLI
pub struct PluginInstaller {
	/// Cache root directory (~/.claude/plugins/cache)
	cache_root: PathBuf,
	/// Marketplace root directory
	marketplace_root: PathBuf,
	/// HTTP client for downloads
	client: reqwest::Client,
}

impl PluginInstaller {
	fn storage_key_for_source(&self, source: &str) -> String {
		if self.is_marketplace_source(source) {
			return source.to_string();
		}

		match PluginSource::parse(source) {
			Ok(PluginSource::OfficialRegistry) => source.to_string(),
			Ok(PluginSource::ThirdParty { url }) => {
				format!("{:x}", md5::compute(url))
			}
			Ok(PluginSource::Local { path }) => {
				format!(
					"local-{:x}",
					md5::compute(path.to_string_lossy().as_bytes())
				)
			}
			Err(_) => format!("{:x}", md5::compute(source.as_bytes())),
		}
	}

	fn marketplace_path_for(&self, marketplace: &str) -> PathBuf {
		self.marketplace_root
			.parent()
			.unwrap_or(&self.marketplace_root)
			.join(marketplace)
	}

	fn common_marketplace_subdirs() -> Vec<String> {
		vec!["plugins/".to_string(), "external_plugins/".to_string()]
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

		let marketplace_path = self.marketplace_path_for(marketplace);
		let marketplace_json =
			marketplace_path.join(".claude-plugin/marketplace.json");
		if !marketplace_json.exists() {
			anyhow::bail!("Marketplace '{}' not found", marketplace);
		}

		Ok(registry::MarketplaceRegistry::new(
			marketplace_path,
			Self::common_marketplace_subdirs(),
		))
	}

	fn is_marketplace_source(&self, source: &str) -> bool {
		self.marketplace_path_for(source)
			.join(".claude-plugin/marketplace.json")
			.exists()
	}

	/// Create a new plugin installer
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
		})
	}

	/// Create installer with custom cache root (for testing)
	pub fn with_roots(
		cache_root: PathBuf,
		marketplace_root: PathBuf,
	) -> Result<Self> {
		let client = Self::build_client()?;

		Ok(Self {
			cache_root,
			marketplace_root,
			client,
		})
	}

	fn build_client() -> Result<reqwest::Client> {
		reqwest::Client::builder()
			.user_agent("aghub-plugin-installer")
			.timeout(std::time::Duration::from_secs(60))
			.build()
			.context("Failed to create plugin installer HTTP client")
	}

	fn manifest_path() -> Result<PathBuf> {
		Ok(dirs::home_dir()
			.context("Cannot find home directory")?
			.join(".claude/plugins/installed_plugins.json"))
	}

	fn scope_root(
		&self,
		storage_key: &str,
		name: &str,
		scope: InstallScope,
	) -> PathBuf {
		self.cache_root
			.join(storage_key)
			.join(name)
			.join("scopes")
			.join(scope.to_string())
	}

	fn staging_dir_for(target_dir: &Path) -> Result<PathBuf> {
		let parent = target_dir.parent().ok_or_else(|| {
			anyhow::anyhow!(
				"Invalid install target without parent: {}",
				target_dir.display()
			)
		})?;
		let unique = Utc::now().timestamp_nanos_opt().unwrap_or_default();
		Ok(parent.join(format!(".staging-{unique}")))
	}

	async fn resolve_registry(
		&self,
		id: &PluginId,
	) -> Result<ResolvedRegistry> {
		if self.is_marketplace_source(&id.source) {
			let (resolved_source, is_remote) = self
				.resolve_marketplace_source(&id.source, &id.name)
				.await?;
			let storage_key = if is_remote {
				format!("{:x}", md5::compute(&resolved_source))
			} else {
				id.source.clone()
			};
			let registry = Box::new(self.marketplace_registry(&id.source)?)
				as Box<dyn PluginRegistry>;
			return Ok(ResolvedRegistry {
				registry,
				storage_key,
			});
		}

		let storage_key = self.storage_key_for_source(&id.source);
		let registry = self.get_registry(&id.source)?;
		Ok(ResolvedRegistry {
			registry,
			storage_key,
		})
	}

	async fn prepare_install(
		&self,
		id: &PluginId,
		scope: InstallScope,
	) -> Result<PreparedInstall> {
		let ResolvedRegistry {
			registry,
			storage_key,
		} = self.resolve_registry(id).await?;
		let manifest = registry.fetch_manifest(&id.name).await?;
		let version_info = registry.get_latest_version(&id.name).await?;
		let (version_dir, registry_commit_sha) = match version_info {
			Some((version, commit_sha)) => (version, commit_sha),
			None => ("latest".to_string(), None),
		};
		let target_dir = self
			.scope_root(&storage_key, &id.name, scope)
			.join(&version_dir);
		let staging_dir = Self::staging_dir_for(&target_dir)?;

		Ok(PreparedInstall {
			registry,
			target_dir,
			staging_dir,
			version_label: manifest.version.clone().unwrap_or(version_dir),
			registry_commit_sha,
		})
	}

	async fn install_into_scope(
		&self,
		id: &PluginId,
		scope: InstallScope,
		replaced_path: Option<PathBuf>,
	) -> Result<InstalledPluginInfo> {
		let PreparedInstall {
			registry,
			target_dir,
			staging_dir,
			version_label,
			registry_commit_sha,
		} = self.prepare_install(id, scope).await?;

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

		if target_dir.exists() {
			tokio::fs::remove_dir_all(&target_dir).await?;
		}
		if let Some(parent) = target_dir.parent() {
			tokio::fs::create_dir_all(parent).await?;
		}
		tokio::fs::rename(&staging_dir, &target_dir).await?;

		let now = Utc::now().to_rfc3339();
		let install_info = InstalledPluginInfo {
			scope: scope.to_string(),
			install_path: target_dir.to_string_lossy().to_string(),
			version: version_label,
			installed_at: now.clone(),
			last_updated: now,
			git_commit_sha: actual_commit.or(registry_commit_sha),
		};

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

		let temp_dir = std::env::temp_dir()
			.join(format!("aghub-plugin-restore-{}", unique_suffix()));
		if temp_dir.exists() {
			tokio::fs::remove_dir_all(&temp_dir).await.ok();
		}

		let tarball_urls =
			if let Some(commit_sha) = locked.commit_sha.as_deref() {
				if normalized_repository.contains("github.com") {
					vec![format!(
						"{}/tarball/{}",
						normalized_repository.trim_end_matches('/'),
						commit_sha
					)]
				} else {
					vec![normalized_repository.clone()]
				}
			} else if normalized_repository.contains("github.com") {
				vec![
					format!(
						"{}/tarball/refs/heads/main",
						normalized_repository.trim_end_matches('/')
					),
					format!(
						"{}/tarball/refs/heads/master",
						normalized_repository.trim_end_matches('/')
					),
				]
			} else {
				vec![normalized_repository.clone()]
			};

		let git_installer = GitBasedInstaller::new();
		let mut last_error = None;
		for tarball_url in tarball_urls {
			match git_installer
				.download_and_extract(&tarball_url, "", &temp_dir)
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
						&temp_dir,
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
					tokio::fs::remove_dir_all(&temp_dir).await.ok();
					copy_result?;
					return Ok(locked.commit_sha.clone());
				}
				Err(error) => last_error = Some(error),
			}
		}

		tokio::fs::remove_dir_all(&temp_dir).await.ok();
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
		if manager.get_plugin(id).is_some_and(|plugin| {
			plugin.scopes.iter().any(|item| item.scope == scope_str)
		}) {
			anyhow::bail!(
				"Plugin '{}' is already installed for scope '{}'",
				id,
				scope
			);
		}

		let storage_key = self.storage_key_for_source(&locked.source);
		let version_dir = if locked.version.trim().is_empty() {
			"latest"
		} else {
			locked.version.as_str()
		};
		let target_dir = self
			.scope_root(&storage_key, &id.name, scope)
			.join(version_dir);
		let staging_dir = Self::staging_dir_for(&target_dir)?;

		if staging_dir.exists() {
			tokio::fs::remove_dir_all(&staging_dir).await.ok();
		}

		if let Err(error) =
			self.install_locked_artifact(id, locked, &staging_dir).await
		{
			tokio::fs::remove_dir_all(&staging_dir).await.ok();
			return Err(error);
		}

		if target_dir.exists() {
			tokio::fs::remove_dir_all(&target_dir).await?;
		}
		if let Some(parent) = target_dir.parent() {
			tokio::fs::create_dir_all(parent).await?;
		}
		tokio::fs::rename(&staging_dir, &target_dir).await?;

		let now = Utc::now().to_rfc3339();
		let install_info = InstalledPluginInfo {
			scope: scope_str.clone(),
			install_path: target_dir.to_string_lossy().to_string(),
			version: version_dir.to_string(),
			installed_at: now.clone(),
			last_updated: now,
			git_commit_sha: locked.commit_sha.clone(),
		};

		let previous =
			Self::update_installed_manifest(id, install_info.clone())?;

		ClaudeSettings::update(|settings| {
			settings.set_enabled(id, true);
		})?;

		if let Some(path) =
			previous.map(|info| PathBuf::from(info.install_path))
		{
			self.cleanup_installation_path_if_unused(&path).await?;
		}

		Ok(install_info)
	}

	async fn cleanup_installation_path_if_unused(
		&self,
		install_path: &Path,
	) -> Result<()> {
		let manifest_path = Self::manifest_path()?;
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
		self.cleanup_empty_dirs(install_path).await
	}

	/// Check if a plugin is installed for the given scope
	pub async fn is_installed(
		&self,
		id: &PluginId,
		scope: InstallScope,
	) -> bool {
		let manager = match ClaudePluginManager::new() {
			Ok(m) => m,
			Err(_) => return false,
		};

		if let Some(plugin) = manager.get_plugin(id) {
			let scope_str = scope.to_string();
			return plugin.scopes.iter().any(|s| s.scope == scope_str);
		}

		false
	}

	/// Install a plugin
	pub async fn install(
		&self,
		id: &PluginId,
		scope: InstallScope,
	) -> Result<InstalledPluginInfo> {
		let manager = ClaudePluginManager::new()?;
		let scope_str = scope.to_string();
		if manager.get_plugin(id).is_some_and(|plugin| {
			plugin.scopes.iter().any(|item| item.scope == scope_str)
		}) {
			anyhow::bail!(
				"Plugin '{}' is already installed for scope '{}'",
				id,
				scope
			);
		}

		self.install_into_scope(id, scope, None).await
	}

	/// Uninstall a plugin
	pub async fn uninstall(
		&self,
		id: &PluginId,
		scope: InstallScope,
		keep_data: bool,
	) -> Result<()> {
		let manager = ClaudePluginManager::new()?;

		// Get plugin info before removing
		let plugin = manager
			.get_plugin(id)
			.ok_or_else(|| anyhow::anyhow!("Plugin '{}' not found", id))?;

		let scope_str = scope.to_string();
		let scope_info = plugin
			.scopes
			.iter()
			.find(|s| s.scope == scope_str)
			.ok_or_else(|| {
				anyhow::anyhow!(
					"Plugin '{}' is not installed for scope '{}'",
					id,
					scope
				)
			})?;

		let removed = Self::remove_from_manifest(id, &scope_str)?;
		let removed_path = removed
			.as_ref()
			.map(|info| PathBuf::from(&info.install_path))
			.unwrap_or_else(|| scope_info.install_path.clone());

		// Remove files unless keep_data
		if !keep_data {
			self.cleanup_installation_path_if_unused(&removed_path)
				.await?;
		}

		// Check if this was the last scope - if so, disable plugin
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

	/// Update a plugin
	pub async fn update(
		&self,
		id: &PluginId,
		scope: InstallScope,
	) -> Result<InstalledPluginInfo> {
		// Check if update is available
		let update_info = self.check_update(id).await?;

		if update_info.is_none() {
			anyhow::bail!("Plugin '{}' is already up to date", id);
		}

		let manager = ClaudePluginManager::new()?;
		let scope_str = scope.to_string();
		let existing_path = manager
			.get_plugin(id)
			.and_then(|plugin| {
				plugin
					.scopes
					.iter()
					.find(|item| item.scope == scope_str)
					.map(|item| item.install_path.clone())
			})
			.ok_or_else(|| {
				anyhow::anyhow!(
					"Plugin '{}' is not installed for scope '{}'",
					id,
					scope
				)
			})?;

		self.install_into_scope(id, scope, Some(existing_path))
			.await
	}

	/// Check if update is available
	pub async fn check_update(
		&self,
		id: &PluginId,
	) -> Result<Option<(String, Option<String>)>> {
		let manager = ClaudePluginManager::new()?;

		let plugin = manager
			.get_plugin(id)
			.ok_or_else(|| anyhow::anyhow!("Plugin '{}' not found", id))?;

		let registry = self.get_registry(&id.source)?;

		// Get latest version from registry
		let latest = registry.get_latest_version(&id.name).await?;

		if let Some((latest_ver, latest_sha)) = latest {
			let current_ver = &plugin.version;

			// Compare versions
			// If versions are semantic, compare them properly
			// Otherwise compare commit SHAs
			let needs_update = if Self::is_semantic_version(current_ver)
				&& Self::is_semantic_version(&latest_ver)
			{
				Self::compare_versions(&latest_ver, current_ver) > 0
			} else {
				// Compare commit SHAs
				match &latest_sha {
					Some(new) => new != &plugin.commit_hash,
					None => latest_ver != *current_ver,
				}
			};

			if needs_update {
				return Ok(Some((latest_ver, latest_sha)));
			}
		}

		Ok(None)
	}

	/// Get registry for a plugin source
	fn get_registry(
		&self,
		source: &str,
	) -> anyhow::Result<Box<dyn PluginRegistry>> {
		match source {
			source if self.is_marketplace_source(source) => {
				Ok(Box::new(self.marketplace_registry(source)?))
			}
			url if url.starts_with("http") => {
				// Parse GitHub URL: https://github.com/owner/repo
				let parts: Vec<_> =
					url.trim_end_matches('/').split('/').collect();
				if parts.len() >= 2 {
					let owner = parts[parts.len() - 2];
					let repo = parts[parts.len() - 1].trim_end_matches(".git");
					Ok(Box::new(GitHubRegistry::new(
						self.client.clone(),
						owner,
						repo,
						None,
					)))
				} else {
					anyhow::bail!("Invalid GitHub URL: {}", url)
				}
			}
			path => {
				Ok(Box::new(registry::LocalRegistry::new(PathBuf::from(path))))
			}
		}
	}

	/// Resolve the actual source for a plugin from marketplace.json
	/// Returns (actual_source, is_remote) where actual_source is the source string
	/// and is_remote indicates if it needs to be fetched from remote
	async fn resolve_marketplace_source(
		&self,
		marketplace: &str,
		plugin_name: &str,
	) -> anyhow::Result<(String, bool)> {
		let marketplace_path = self.marketplace_path_for(marketplace);

		let marketplace_json =
			marketplace_path.join(".claude-plugin/marketplace.json");

		if !marketplace_json.exists() {
			anyhow::bail!("Marketplace configuration not found");
		}

		let content = tokio::fs::read_to_string(&marketplace_json).await?;
		let config: MarketplaceConfig = serde_json::from_str(&content)?;

		// Find the plugin in marketplace.json
		for plugin in config.plugins {
			if plugin.name == plugin_name {
				return match &plugin.source {
					// Local source - check if it exists locally
					MarketplaceSource::Local(path) => {
						let full_path = marketplace_path
							.join(path.trim_start_matches("./"));
						if full_path.exists() {
							Ok((full_path.to_string_lossy().to_string(), false))
						} else if let Some((repo_url, subdir)) =
							local_source_remote_fallback(&plugin, path)
						{
							Ok((format!("{repo_url}#{subdir}"), true))
						} else {
							// Local path doesn't exist, treat as needing download
							// This shouldn't happen for local sources, but handle gracefully
							anyhow::bail!(
								"Local plugin path not found: {}",
								full_path.display()
							);
						}
					}
					// Remote URL source - return the URL
					MarketplaceSource::Url { url, .. } => {
						Ok((normalize_repository_url(url), true))
					}
					// GitHub source - construct GitHub URL
					MarketplaceSource::GitHub { repo, .. } => {
						Ok((normalize_repository_url(repo), true))
					}
					// Git subdirectory - return the URL
					MarketplaceSource::GitSubdir { url, path, .. } => {
						let url = normalize_repository_url(url);
						let subdir = path.trim_matches('/');
						Ok((format!("{url}#{subdir}"), true))
					}
					// NPM source - not supported yet
					MarketplaceSource::Npm { package, .. } => {
						anyhow::bail!(
							"NPM package source not yet supported: {}",
							package
						);
					}
				};
			}
		}

		anyhow::bail!("Plugin '{}' not found in marketplace", plugin_name)
	}

	/// Update installed_plugins.json with new installation
	fn update_installed_manifest(
		id: &PluginId,
		info: InstalledPluginInfo,
	) -> Result<Option<InstalledPluginInfo>> {
		use crate::claude::types::InstalledPluginsManifest;

		let plugin_id_str = id.to_string();
		let manifest_path = Self::manifest_path()?;
		let mut replaced = None;
		InstalledPluginsManifest::update(&manifest_path, |manifest| {
			replaced = manifest.upsert_installation(plugin_id_str, info);
		})?;
		Ok(replaced)
	}

	/// Remove installation from manifest
	fn remove_from_manifest(
		id: &PluginId,
		scope: &str,
	) -> Result<Option<InstalledPluginInfo>> {
		use crate::claude::types::InstalledPluginsManifest;

		let plugin_id_str = id.to_string();
		let manifest_path = Self::manifest_path()?;
		let mut removed = None;
		InstalledPluginsManifest::update(&manifest_path, |manifest| {
			removed = manifest.remove_installation(&plugin_id_str, scope);
		})?;
		Ok(removed)
	}

	/// Clean up empty parent directories after uninstall
	async fn cleanup_empty_dirs(
		&self,
		install_path: &std::path::Path,
	) -> Result<()> {
		let mut current = install_path.parent();

		while let Some(dir) = current {
			// Stop at cache root
			if dir == self.cache_root {
				break;
			}

			if dir.exists() {
				let is_empty = tokio::fs::read_dir(dir)
					.await?
					.next_entry()
					.await?
					.is_none();

				if is_empty {
					tokio::fs::remove_dir(dir).await.ok();
				} else {
					break;
				}
			}

			current = dir.parent();
		}

		Ok(())
	}

	/// Check if version string looks like semantic version
	fn is_semantic_version(ver: &str) -> bool {
		// Simple check: starts with digit and contains at least one dot
		ver.chars()
			.next()
			.map(|c| c.is_ascii_digit())
			.unwrap_or(false)
			&& ver.contains('.')
	}

	/// Compare semantic versions using semver crate
	fn compare_versions(a: &str, b: &str) -> i32 {
		// Strip build metadata (everything after '+') as per SemVer spec
		let a_clean = a.split('+').next().unwrap_or(a);
		let b_clean = b.split('+').next().unwrap_or(b);

		// Try to parse as semver first
		match (
			semver::Version::parse(a_clean),
			semver::Version::parse(b_clean),
		) {
			(Ok(a_ver), Ok(b_ver)) => match a_ver.cmp(&b_ver) {
				std::cmp::Ordering::Less => -1,
				std::cmp::Ordering::Equal => 0,
				std::cmp::Ordering::Greater => 1,
			},
			// Fallback: simple numeric comparison
			_ => {
				let parse = |s: &str| {
					s.split('.')
						.filter_map(|p| p.parse::<u32>().ok())
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

				a_parts.len().cmp(&b_parts.len()) as i32
			}
		}
	}
}

impl Default for PluginInstaller {
	fn default() -> Self {
		Self::new().expect("Failed to create PluginInstaller")
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_compare_versions() {
		// Basic semver comparisons
		assert_eq!(PluginInstaller::compare_versions("1.0.0", "1.0.0"), 0);
		assert_eq!(PluginInstaller::compare_versions("1.1.0", "1.0.0"), 1);
		assert_eq!(PluginInstaller::compare_versions("1.0.0", "1.1.0"), -1);
		assert_eq!(PluginInstaller::compare_versions("2.0.0", "1.9.9"), 1);

		// Semver with pre-release
		assert_eq!(
			PluginInstaller::compare_versions("1.0.0-alpha", "1.0.0"),
			-1
		);
		assert_eq!(
			PluginInstaller::compare_versions("1.0.0-beta", "1.0.0-alpha"),
			1
		);

		// Build metadata (should be ignored in comparison)
		assert_eq!(
			PluginInstaller::compare_versions("1.0.0+build1", "1.0.0+build2"),
			0
		);

		// Fallback for non-semver strings
		assert_eq!(PluginInstaller::compare_versions("1.0", "1.0.0"), -1);
		assert_eq!(PluginInstaller::compare_versions("abc", "def"), 0); // Both fail to parse
	}

	#[test]
	fn test_is_semantic_version() {
		assert!(PluginInstaller::is_semantic_version("1.0.0"));
		assert!(PluginInstaller::is_semantic_version("2.1.0-beta"));
		assert!(!PluginInstaller::is_semantic_version("abc123"));
		assert!(!PluginInstaller::is_semantic_version("latest"));
	}

	#[tokio::test]
	async fn test_resolve_marketplace_source_local() {
		let temp_root = std::env::temp_dir()
			.join(format!("aghub-mod-test-{}", std::process::id()));
		if temp_root.exists() {
			std::fs::remove_dir_all(&temp_root).unwrap();
		}
		std::fs::create_dir_all(&temp_root).unwrap();
		let marketplace_dir = temp_root.join("claude-plugins-official");

		let plugin_dir = marketplace_dir.join("plugins/test-plugin");
		std::fs::create_dir_all(&plugin_dir).unwrap();
		std::fs::create_dir_all(marketplace_dir.join(".claude-plugin"))
			.unwrap();

		std::fs::write(
			marketplace_dir.join(".claude-plugin/marketplace.json"),
			r#"{
				"name": "test-marketplace",
				"description": "test",
				"owner": { "name": "owner" },
				"plugins": [
					{
						"name": "test-plugin",
						"description": "desc",
						"source": "./plugins/test-plugin"
					}
				]
			}"#,
		)
		.unwrap();

		let installer = PluginInstaller::with_roots(
			temp_root.join("cache"),
			marketplace_dir.clone(),
		)
		.unwrap();

		let (source, is_remote) = installer
			.resolve_marketplace_source(
				"claude-plugins-official",
				"test-plugin",
			)
			.await
			.unwrap();

		assert_eq!(
			source,
			marketplace_dir
				.join("plugins/test-plugin")
				.to_string_lossy()
				.to_string()
		);
		assert!(!is_remote);

		std::fs::remove_dir_all(&temp_root).unwrap();
	}

	#[tokio::test]
	async fn test_resolve_marketplace_source_github() {
		let temp_root = std::env::temp_dir()
			.join(format!("aghub-mod-test-git-{}", std::process::id()));
		let marketplace_dir = temp_root.join("claude-plugins-official");
		std::fs::create_dir_all(marketplace_dir.join(".claude-plugin"))
			.unwrap();

		std::fs::write(
			marketplace_dir.join(".claude-plugin/marketplace.json"),
			r#"{
				"name": "test-marketplace",
				"description": "test",
				"owner": { "name": "owner" },
				"plugins": [
					{
						"name": "test-github",
						"description": "desc",
						"source": {
							"source": "github",
							"repo": "owner/repo"
						}
					}
				]
			}"#,
		)
		.unwrap();

		let installer = PluginInstaller::with_roots(
			temp_root.join("cache"),
			marketplace_dir,
		)
		.unwrap();

		let (source, is_remote) = installer
			.resolve_marketplace_source(
				"claude-plugins-official",
				"test-github",
			)
			.await
			.unwrap();

		assert_eq!(source, "https://github.com/owner/repo");
		assert!(is_remote);

		std::fs::remove_dir_all(&temp_root).unwrap();
	}

	#[tokio::test]
	async fn test_resolve_marketplace_source_local_fallback_remote() {
		let temp_root = std::env::temp_dir().join(format!(
			"aghub-mod-test-local-fallback-{}",
			std::process::id()
		));
		let marketplace_dir = temp_root.join("claude-plugins-official");
		std::fs::create_dir_all(marketplace_dir.join(".claude-plugin"))
			.unwrap();

		std::fs::write(
			marketplace_dir.join(".claude-plugin/marketplace.json"),
			r#"{
				"name": "test-marketplace",
				"description": "test",
				"owner": { "name": "owner" },
				"plugins": [
					{
						"name": "autofix-bot",
						"description": "desc",
						"homepage": "https://github.com/anthropics/claude-plugins-public/tree/main/external_plugins/autofix-bot",
						"source": "./external_plugins/autofix-bot"
					}
				]
			}"#,
		)
		.unwrap();

		let installer = PluginInstaller::with_roots(
			temp_root.join("cache"),
			marketplace_dir,
		)
		.unwrap();

		let (source, is_remote) = installer
			.resolve_marketplace_source(
				"claude-plugins-official",
				"autofix-bot",
			)
			.await
			.unwrap();

		assert_eq!(
			source,
			"https://github.com/anthropics/claude-plugins-public#external_plugins/autofix-bot"
		);
		assert!(is_remote);

		std::fs::remove_dir_all(&temp_root).unwrap();
	}

	#[tokio::test]
	async fn test_resolve_marketplace_source_for_custom_marketplace_root() {
		let temp_root = std::env::temp_dir().join(format!(
			"aghub-mod-test-custom-marketplace-{}",
			std::process::id()
		));
		let marketplaces_dir = temp_root.join("marketplaces");
		let marketplace_dir = marketplaces_dir.join("impeccable");
		std::fs::create_dir_all(marketplace_dir.join(".claude-plugin"))
			.unwrap();

		std::fs::write(
			marketplace_dir.join(".claude-plugin/marketplace.json"),
			r#"{
				"name": "impeccable",
				"description": "test",
				"owner": { "name": "owner" },
				"plugins": [
					{
						"name": "impeccable",
						"description": "desc",
						"version": "1.5.1",
						"source": "./"
					}
				]
			}"#,
		)
		.unwrap();
		std::fs::write(
			marketplace_dir.join(".claude-plugin/plugin.json"),
			r#"{"name":"impeccable","description":"test","author":{"name":"A"}}"#,
		)
		.unwrap();

		let installer = PluginInstaller::with_roots(
			temp_root.join("cache"),
			marketplaces_dir.join("claude-plugins-official"),
		)
		.unwrap();

		assert!(installer.is_marketplace_source("impeccable"));

		let (source, is_remote) = installer
			.resolve_marketplace_source("impeccable", "impeccable")
			.await
			.unwrap();

		assert_eq!(PathBuf::from(source), marketplace_dir);
		assert!(!is_remote);

		std::fs::remove_dir_all(&temp_root).unwrap();
	}
}
