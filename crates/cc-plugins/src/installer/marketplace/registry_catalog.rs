use super::super::git;
use super::super::registry::{
	copy_dir_all, extract_repository_archive, fetch_github_raw_manifest,
	find_plugin_manifest_path, first_manifest_dir, git_clone, git_ok,
	git_output, is_git_repository, manifest_candidate_paths,
	normalize_repository_url, read_plugin_manifest, remote_plugin_candidates,
	resolve_plugin_dir_with_wrappers, temp_dir,
};
use super::source::{
	github_owner_repo, local_source_remote_fallback,
	manifest_from_marketplace_plugin, materialize_marketplace_plugin,
};
use crate::claude::types::PluginManifest;
use crate::discovery::{
	MarketplaceConfig, MarketplacePlugin, MarketplaceSource,
};
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

const OFFICIAL_MARKETPLACE_REPO: &str =
	"https://github.com/anthropics/claude-plugins-official.git";

pub struct MarketplaceRegistry {
	pub(super) marketplace_path: PathBuf,
	pub(super) plugins_subdirs: Vec<String>,
	pub(super) upstream_repo: Option<String>,
	pub(super) client: reqwest::Client,
	pub(super) git_installer: git::GitBasedInstaller,
}

impl MarketplaceRegistry {
	pub fn new(
		marketplace_path: PathBuf,
		plugins_subdirs: Vec<String>,
	) -> Result<Self> {
		Self::new_with_upstream(marketplace_path, plugins_subdirs, None)
	}

	pub fn new_with_upstream(
		marketplace_path: PathBuf,
		plugins_subdirs: Vec<String>,
		upstream_repo: Option<String>,
	) -> Result<Self> {
		let client = git::build_http_client(60)?;

		Ok(Self {
			marketplace_path,
			plugins_subdirs,
			upstream_repo,
			client,
			git_installer: git::GitBasedInstaller::new()?,
		})
	}

	pub fn new_official() -> Result<Self> {
		let marketplace_path = dirs::home_dir()
			.ok_or_else(|| anyhow::anyhow!("Cannot find home directory"))?
			.join(".claude/plugins/marketplaces/claude-plugins-official");
		Self::new_with_upstream(
			marketplace_path,
			vec!["plugins/".to_string(), "external_plugins/".to_string()],
			Some(OFFICIAL_MARKETPLACE_REPO.to_string()),
		)
	}
}

enum MarketplaceEntry {
	Definition(Box<MarketplacePlugin>),
	Directory(PathBuf),
}

impl MarketplaceRegistry {
	async fn load_marketplace_config(&self) -> Result<MarketplaceConfig> {
		let marketplace_json = self
			.marketplace_path
			.join(".claude-plugin/marketplace.json");

		if !marketplace_json.exists() {
			anyhow::bail!(
				"Marketplace configuration not found at {:?}",
				marketplace_json
			);
		}

		let content = tokio::fs::read_to_string(&marketplace_json).await?;
		let config: MarketplaceConfig = serde_json::from_str(&content)?;
		Ok(config)
	}

	async fn find_plugin_entry(
		&self,
		name: &str,
	) -> Result<Option<MarketplaceEntry>> {
		let config = self.load_marketplace_config().await?;
		if let Some(plugin) = config
			.plugins
			.into_iter()
			.find(|plugin| plugin.name == name)
		{
			return Ok(Some(MarketplaceEntry::Definition(Box::new(plugin))));
		}

		Ok(self
			.plugin_source_dir(name)
			.map(MarketplaceEntry::Directory))
	}

	fn plugin_source_dir(&self, name: &str) -> Option<PathBuf> {
		self.plugins_subdirs.iter().find_map(|subdir| {
			let path = self.marketplace_path.join(subdir).join(name);
			path.exists().then_some(path)
		})
	}

	fn local_source_dir(&self, path: &str) -> PathBuf {
		self.marketplace_path.join(path.trim_start_matches("./"))
	}

	fn remote_source(
		&self,
		plugin: &MarketplacePlugin,
	) -> Option<(String, Vec<PathBuf>)> {
		match &plugin.source {
			MarketplaceSource::Local(path) => {
				let (repo_url, subdir) =
					local_source_remote_fallback(plugin, path)?;
				Some((repo_url, vec![PathBuf::from(subdir)]))
			}
			MarketplaceSource::Url { url, .. } => Some((
				normalize_repository_url(url),
				remote_plugin_candidates(&plugin.name),
			)),
			MarketplaceSource::GitHub { repo, .. } => Some((
				normalize_repository_url(repo),
				remote_plugin_candidates(&plugin.name),
			)),
			MarketplaceSource::GitSubdir { url, path, .. } => Some((
				normalize_repository_url(url),
				vec![PathBuf::from(path.trim_matches('/'))],
			)),
			MarketplaceSource::Npm { .. } => None,
		}
	}

	async fn manifest_from_local_source(
		&self,
		plugin: &MarketplacePlugin,
		path: &str,
	) -> Result<Option<PluginManifest>> {
		let plugin_dir = self.local_source_dir(path);
		if !plugin_dir.exists() {
			return Ok(None);
		}

		match find_plugin_manifest_path(&plugin_dir) {
			Some(manifest_path) => {
				let content = tokio::fs::read_to_string(&manifest_path).await?;
				let manifest: PluginManifest = serde_json::from_str(&content)?;
				Ok(Some(manifest))
			}
			None => Ok(Some(manifest_from_marketplace_plugin(plugin))),
		}
	}

	async fn fetch_manifest_for_plugin(
		&self,
		plugin: &MarketplacePlugin,
	) -> Result<PluginManifest> {
		match &plugin.source {
			MarketplaceSource::Local(path) => {
				if let Some(manifest) =
					self.manifest_from_local_source(plugin, path).await?
				{
					return Ok(manifest);
				}
			}
			MarketplaceSource::Npm { package, .. } => {
				anyhow::bail!(
					"NPM package source not yet supported: {}",
					package
				);
			}
			_ => {}
		}

		if let Some((url, candidates)) = self.remote_source(plugin) {
			if let Some(manifest) =
				self.try_fetch_github_raw_manifest(&url, &candidates).await
			{
				return Ok(manifest);
			}

			return self.fetch_manifest_from_tarball(&url, &candidates).await;
		}

		anyhow::bail!("plugin.json not found for local plugin: {}", plugin.name)
	}

	async fn install_plugin_def(
		&self,
		plugin: &MarketplacePlugin,
		target_dir: &Path,
	) -> Result<Option<String>> {
		match &plugin.source {
			MarketplaceSource::Local(path) => {
				let source_dir = self.local_source_dir(path);
				if source_dir.exists() {
					if find_plugin_manifest_path(&source_dir).is_some() {
						copy_dir_all(&source_dir, target_dir).await?;
					} else {
						materialize_marketplace_plugin(
							plugin,
							Some(&source_dir),
							target_dir,
						)
						.await?;
					}
					return self.get_marketplace_commit().await;
				}
			}
			MarketplaceSource::Npm { package, .. } => {
				anyhow::bail!(
					"NPM package source not yet supported: {}",
					package
				);
			}
			_ => {}
		}

		if let Some((url, candidates)) = self.remote_source(plugin) {
			if candidates.len() == 1 && !candidates[0].as_os_str().is_empty() {
				return self
					.install_remote_candidates(
						&url,
						&candidates[0].to_string_lossy(),
						target_dir,
						&candidates,
						format!(
							"Subdirectory '{}' not found in remote repository",
							candidates[0].display()
						),
						false,
					)
					.await;
			}
			return self
				.install_remote_candidates(
					&url,
					&plugin.name,
					target_dir,
					&remote_plugin_candidates(&plugin.name),
					format!(
						"Plugin directory not found in remote repository for '{}'",
						plugin.name
					),
					true,
				)
				.await;
		}

		anyhow::bail!("Plugin not found in marketplace: {}", plugin.name)
	}

	async fn source_version_and_commit(
		&self,
		plugin: &MarketplacePlugin,
	) -> Result<(String, Option<String>)> {
		let commit = match &plugin.source {
			MarketplaceSource::Local(_) => {
				self.get_marketplace_commit().await?
			}
			MarketplaceSource::Url { sha, .. }
			| MarketplaceSource::GitHub { sha, .. }
			| MarketplaceSource::GitSubdir { sha, .. } => match sha {
				Some(pinned) => Some(pinned.clone()),
				None => self.get_marketplace_commit().await?,
			},
			MarketplaceSource::Npm { .. } => None,
		};

		let version = if let Some(version) = plugin.version.clone() {
			version
		} else {
			self.fetch_manifest_for_plugin(plugin)
				.await
				.inspect_err(|e| {
					log::debug!(
						"Failed to fetch manifest for {}: {e}",
						plugin.name
					)
				})
				.ok()
				.and_then(|manifest| manifest.version)
				.unwrap_or_else(|| "latest".to_string())
		};
		Ok((version, commit))
	}

	async fn try_fetch_github_raw_manifest(
		&self,
		url: &str,
		candidates: &[PathBuf],
	) -> Option<PluginManifest> {
		let (owner, repo) = github_owner_repo(url)?;
		fetch_github_raw_manifest(
			&self.client,
			&owner,
			&repo,
			&manifest_candidate_paths(candidates),
		)
		.await
	}

	async fn fetch_manifest_from_tarball(
		&self,
		url: &str,
		candidates: &[PathBuf],
	) -> Result<PluginManifest> {
		let temp_dir = temp_dir("aghub-plugin-manifest-")?;

		extract_repository_archive(&self.git_installer, url, temp_dir.path())
			.await
			.map_err(|error| {
				anyhow::anyhow!(
					"Failed to download remote plugin manifest: {}",
					error
				)
			})?;

		let plugin_dir =
			resolve_plugin_dir_with_wrappers(temp_dir.path(), candidates)
				.ok_or_else(|| {
					anyhow::anyhow!(
						"plugin root not found in remote repository"
					)
				})?;

		read_plugin_manifest(&plugin_dir).await.map_err(|error| {
			anyhow::anyhow!(
				"plugin.json not found in remote plugin from '{}': {}",
				url,
				error
			)
		})
	}

	async fn install_remote_candidates(
		&self,
		url: &str,
		temp_name: &str,
		target_dir: &Path,
		candidates: &[PathBuf],
		missing_message: String,
		allow_fallback: bool,
	) -> Result<Option<String>> {
		log::info!("Installing remote plugin from {} to {:?}", url, target_dir);
		let temp_dir = temp_dir(&format!(
			"aghub-plugin-temp-{}-",
			temp_name.replace('/', "_")
		))?;

		let commit = extract_repository_archive(
			&self.git_installer,
			url,
			temp_dir.path(),
		)
		.await?;

		let source_dir =
			resolve_plugin_dir_with_wrappers(temp_dir.path(), candidates)
				.or_else(|| {
					allow_fallback
						.then(|| first_manifest_dir(temp_dir.path()))
						.flatten()
				})
				.ok_or_else(|| anyhow::anyhow!(missing_message.clone()))?;

		copy_dir_all(&source_dir, target_dir).await?;
		Ok(Some(commit))
	}
}

impl MarketplaceRegistry {
	pub async fn fetch_manifest(&self, name: &str) -> Result<PluginManifest> {
		match self.find_plugin_entry(name).await? {
			Some(MarketplaceEntry::Definition(plugin)) => {
				self.fetch_manifest_for_plugin(&plugin).await
			}
			Some(MarketplaceEntry::Directory(path)) => {
				read_plugin_manifest(&path).await
			}
			None => anyhow::bail!("Plugin not found in marketplace: {}", name),
		}
	}

	pub async fn install(
		&self,
		name: &str,
		target_dir: &Path,
	) -> Result<Option<String>> {
		match self.find_plugin_entry(name).await? {
			Some(MarketplaceEntry::Definition(plugin)) => {
				self.install_plugin_def(&plugin, target_dir).await
			}
			Some(MarketplaceEntry::Directory(path)) => {
				copy_dir_all(&path, target_dir).await?;
				self.get_marketplace_commit().await
			}
			None => anyhow::bail!("Plugin not found in marketplace: {}", name),
		}
	}

	pub async fn get_latest_version(
		&self,
		name: &str,
	) -> Result<Option<(String, Option<String>)>> {
		match self.find_plugin_entry(name).await? {
			Some(MarketplaceEntry::Definition(plugin)) => {
				self.source_version_and_commit(&plugin).await.map(Some)
			}
			Some(MarketplaceEntry::Directory(path)) => {
				let version = read_plugin_manifest(&path)
					.await
					.inspect_err(|e| {
						log::debug!(
							"Failed to read manifest at {}: {e}",
							path.display()
						)
					})
					.ok()
					.and_then(|manifest| manifest.version)
					.unwrap_or_else(|| "latest".to_string());
				Ok(Some((version, self.get_marketplace_commit().await?)))
			}
			None => Ok(None),
		}
	}
}

// ── Sync ──

impl MarketplaceRegistry {
	pub async fn update(&self) -> Result<()> {
		if !self.marketplace_path.exists() {
			return self.clone_marketplace().await;
		}

		if is_git_repository(&self.marketplace_path) {
			git_ok(
				&["pull"],
				Some(&self.marketplace_path),
				"Failed to execute git pull",
				"Git pull failed",
			)
			.await?;

			log::info!("Marketplace updated successfully");
			return Ok(());
		}

		log::info!(
			"Marketplace at {:?} is a snapshot, refreshing from upstream clone",
			self.marketplace_path
		);
		self.replace_snapshot_from_upstream().await?;

		log::info!("Marketplace updated successfully");
		Ok(())
	}

	async fn clone_marketplace(&self) -> Result<()> {
		let upstream_repo = self.upstream_repo.as_deref().ok_or_else(|| {
			anyhow::anyhow!(
				"Marketplace directory not found and no upstream repo is configured: {:?}",
				self.marketplace_path
			)
		})?;

		let parent_dir = self.marketplace_path.parent().ok_or_else(|| {
			anyhow::anyhow!(
				"Invalid marketplace path: {:?}",
				self.marketplace_path
			)
		})?;

		tokio::fs::create_dir_all(parent_dir).await?;
		git_clone(
			upstream_repo,
			&self.marketplace_path,
			"Failed to execute git clone",
		)
		.await?;

		Ok(())
	}

	async fn replace_snapshot_from_upstream(&self) -> Result<()> {
		let upstream_repo = self.upstream_repo.as_deref().ok_or_else(|| {
			anyhow::anyhow!(
				"Marketplace snapshot cannot be refreshed without an upstream repo"
			)
		})?;

		let parent_dir = self.marketplace_path.parent().ok_or_else(|| {
			anyhow::anyhow!(
				"Invalid marketplace path: {:?}",
				self.marketplace_path
			)
		})?;
		tokio::fs::create_dir_all(parent_dir).await?;

		let name = self
			.marketplace_path
			.file_name()
			.and_then(|value| value.to_str())
			.unwrap_or("marketplace");
		let suffix = chrono::Utc::now()
			.timestamp_nanos_opt()
			.map(|value| value.to_string())
			.unwrap_or_else(|| std::process::id().to_string());
		let clone_path = parent_dir.join(format!(".{name}-clone-{suffix}"));
		let backup_path = parent_dir.join(format!(".{name}-backup-{suffix}"));

		if clone_path.exists() {
			if let Err(e) = tokio::fs::remove_dir_all(&clone_path).await {
				log::warn!(
					"Failed to clean up clone dir {}: {e}",
					clone_path.display()
				);
			}
		}
		if backup_path.exists() {
			if let Err(e) = tokio::fs::remove_dir_all(&backup_path).await {
				log::warn!(
					"Failed to clean up backup dir {}: {e}",
					backup_path.display()
				);
			}
		}

		if let Err(error) = git_clone(
			upstream_repo,
			&clone_path,
			"Failed to execute git clone for marketplace refresh",
		)
		.await
		{
			if clone_path.exists() {
				if let Err(e) = tokio::fs::remove_dir_all(&clone_path).await {
					log::warn!(
						"Failed to clean up clone dir {}: {e}",
						clone_path.display()
					);
				}
			}
			return Err(error);
		}

		tokio::fs::rename(&self.marketplace_path, &backup_path)
			.await
			.with_context(|| {
				format!(
					"Failed to move existing marketplace out of the way: {:?}",
					self.marketplace_path
				)
			})?;

		if let Err(error) =
			tokio::fs::rename(&clone_path, &self.marketplace_path).await
		{
			let restore_result =
				tokio::fs::rename(&backup_path, &self.marketplace_path).await;
			if clone_path.exists() {
				if let Err(e) = tokio::fs::remove_dir_all(&clone_path).await {
					log::warn!(
						"Failed to clean up clone dir {}: {e}",
						clone_path.display()
					);
				}
			}
			match restore_result {
				Ok(_) => {
					return Err(error).with_context(|| {
						"Failed to replace marketplace snapshot".to_string()
					});
				}
				Err(restore_error) => {
					return Err(error).context(format!(
						"Failed to replace marketplace snapshot, and restore also failed: {restore_error}"
					));
				}
			}
		}

		if backup_path.exists() {
			if let Err(e) = tokio::fs::remove_dir_all(&backup_path).await {
				log::warn!(
					"Failed to clean up backup dir {}: {e}",
					backup_path.display()
				);
			}
		}
		Ok(())
	}

	pub(super) async fn get_marketplace_commit(
		&self,
	) -> Result<Option<String>> {
		let output = git_output(
			&["rev-parse", "HEAD"],
			Some(&self.marketplace_path),
			"Failed to get marketplace commit",
		)
		.await?;

		if output.status.success() {
			let commit =
				String::from_utf8_lossy(&output.stdout).trim().to_string();
			return Ok(Some(commit));
		}

		Ok(None)
	}
}
