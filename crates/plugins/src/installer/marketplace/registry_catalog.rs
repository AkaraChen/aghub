use super::super::registry::{
	copy_dir_all, extract_repository_archive, fetch_github_raw_manifest,
	find_plugin_manifest_path, first_manifest_dir, manifest_candidate_paths,
	normalize_repository_url, read_plugin_manifest, remote_plugin_candidates,
	resolve_plugin_dir_with_wrappers, temp_dir, PluginRegistry,
};
use super::registry_impl::MarketplaceRegistry;
use super::source::{
	github_owner_repo, local_source_remote_fallback,
	manifest_from_marketplace_plugin, materialize_marketplace_plugin,
};
use crate::claude::types::PluginManifest;
use crate::discovery::{
	MarketplaceConfig, MarketplacePlugin, MarketplaceSource,
};
use anyhow::Result;
use async_trait::async_trait;
use std::path::{Path, PathBuf};

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
			| MarketplaceSource::GitSubdir { sha, .. } => sha.clone(),
			MarketplaceSource::Npm { .. } => None,
		};

		let version = if let Some(version) = plugin.version.clone() {
			version
		} else {
			self.fetch_manifest_for_plugin(plugin)
				.await
				.ok()
				.and_then(|manifest| manifest.version)
				.unwrap_or_else(|| "latest".to_string())
		};
		Ok((version, commit))
	}

	pub fn list_plugins(&self) -> Result<Vec<(String, PathBuf)>> {
		let mut plugins = Vec::new();

		for subdir in &self.plugins_subdirs {
			let plugins_dir = self.marketplace_path.join(subdir);

			if !plugins_dir.exists() {
				continue;
			}

			for entry in std::fs::read_dir(&plugins_dir)? {
				let path = entry?.path();
				if !path.is_dir() || find_plugin_manifest_path(&path).is_none()
				{
					continue;
				}

				if let Some(name) =
					path.file_name().and_then(|value| value.to_str())
				{
					plugins.push((name.to_string(), path));
				}
			}
		}

		plugins.sort_by(|left, right| left.0.cmp(&right.0));
		Ok(plugins)
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

#[async_trait]
impl PluginRegistry for MarketplaceRegistry {
	async fn fetch_manifest(&self, name: &str) -> Result<PluginManifest> {
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

	async fn install(
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

	async fn get_latest_version(
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
					.ok()
					.and_then(|manifest| manifest.version)
					.unwrap_or_else(|| "latest".to_string());
				Ok(Some((version, self.get_marketplace_commit().await?)))
			}
			None => Ok(None),
		}
	}
}
