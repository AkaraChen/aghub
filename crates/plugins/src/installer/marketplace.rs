use super::git::{build_http_client, GitBasedInstaller};
use super::registry::{
	copy_dir_all, extract_repository_archive, fetch_github_raw_manifest,
	find_plugin_manifest_path, first_manifest_dir, git_clone, git_ok,
	git_output, is_git_repository, manifest_candidate_paths,
	normalize_repository_url, read_plugin_manifest, remote_plugin_candidates,
	resolve_plugin_dir_with_wrappers, temp_dir, PluginRegistry,
};
use crate::claude::types::{PluginAuthor, PluginManifest};
use crate::discovery::{
	MarketplaceConfig, MarketplacePlugin, MarketplaceSource,
};
use anyhow::{Context, Result};
use async_trait::async_trait;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const OFFICIAL_MARKETPLACE_REPO: &str =
	"https://github.com/anthropics/claude-plugins-official.git";

pub(super) fn marketplace_path_for(
	marketplace_root: &Path,
	marketplace: &str,
) -> PathBuf {
	marketplace_root
		.parent()
		.unwrap_or(marketplace_root)
		.join(marketplace)
}

fn marketplace_git_config_path(
	marketplace_root: &Path,
	marketplace: &str,
) -> Option<PathBuf> {
	let git_path =
		marketplace_path_for(marketplace_root, marketplace).join(".git");
	if git_path.is_dir() {
		return Some(git_path.join("config"));
	}

	let gitdir = std::fs::read_to_string(&git_path).ok()?;
	let path = gitdir.strip_prefix("gitdir:")?.trim();
	let resolved = git_path.parent()?.join(path);
	Some(resolved.join("config"))
}

fn marketplace_origin_url_from_git(
	marketplace_root: &Path,
	marketplace: &str,
) -> Option<String> {
	let config_path =
		marketplace_git_config_path(marketplace_root, marketplace)?;
	let content = std::fs::read_to_string(config_path).ok()?;
	let mut in_origin = false;

	for line in content.lines() {
		let trimmed = line.trim();
		if trimmed.starts_with('[') {
			in_origin = trimmed == r#"[remote "origin"]"#;
			continue;
		}

		if !in_origin {
			continue;
		}

		let (key, value) = trimmed.split_once('=')?;
		if key.trim() == "url" {
			return Some(normalize_repository_url(value.trim()));
		}
	}

	None
}

pub(super) fn load_marketplace_repository_urls(
	marketplace_root: &Path,
	marketplace: &str,
) -> HashMap<String, String> {
	let manifest_path = marketplace_path_for(marketplace_root, marketplace)
		.join(".claude-plugin/marketplace.json");
	let content = match std::fs::read_to_string(&manifest_path) {
		Ok(content) => content,
		Err(_) => return HashMap::new(),
	};
	let config: MarketplaceConfig = match serde_json::from_str(&content) {
		Ok(config) => config,
		Err(_) => return HashMap::new(),
	};
	let origin = marketplace_origin_url_from_git(marketplace_root, marketplace);

	config
		.plugins
		.into_iter()
		.filter_map(|plugin| {
			let url = match plugin.source {
				MarketplaceSource::GitHub { repo, .. } => {
					Some(normalize_repository_url(&repo))
				}
				MarketplaceSource::Url { url, .. } => {
					Some(normalize_repository_url(&url))
				}
				MarketplaceSource::GitSubdir { url, path, .. } => {
					Some(format!(
						"{}/tree/HEAD/{}",
						normalize_repository_url(&url),
						path.trim_start_matches("./"),
					))
				}
				MarketplaceSource::Local(path) => {
					plugin.homepage.or_else(|| {
						origin.as_ref().map(|repo| {
							format!(
								"{repo}/tree/HEAD/{}",
								path.trim_start_matches("./"),
							)
						})
					})
				}
				MarketplaceSource::Npm { .. } => plugin.homepage,
			}?;
			Some((plugin.name, url.trim_end_matches('/').to_string()))
		})
		.collect()
}

pub(super) fn is_marketplace_source(
	marketplace_root: &Path,
	source: &str,
) -> bool {
	marketplace_path_for(marketplace_root, source)
		.join(".claude-plugin/marketplace.json")
		.exists()
}

fn local_source_remote_fallback(
	plugin: &MarketplacePlugin,
	local_path: &str,
) -> Option<(String, String)> {
	let homepage = plugin.homepage.as_deref()?;
	let (repo_url, subdir) = parse_github_tree_url(homepage)?;
	if subdir == local_path.trim_start_matches("./") {
		return Some((repo_url, subdir));
	}

	None
}

fn parse_github_tree_url(url: &str) -> Option<(String, String)> {
	let normalized = normalize_repository_url(url);
	let marker = "/tree/";
	let (repo_url, rest) = normalized.split_once(marker)?;
	let mut parts = rest.split('/');
	let branch = parts.next()?;
	let subdir = parts.collect::<Vec<_>>().join("/");
	if branch.is_empty() || subdir.is_empty() {
		return None;
	}

	Some((repo_url.to_string(), subdir))
}

fn github_owner_repo(url: &str) -> Option<(String, String)> {
	let mut normalized = normalize_repository_url(url);
	if let Some((repo_url, _)) = parse_github_tree_url(&normalized) {
		normalized = repo_url;
	}

	let path = normalized
		.strip_prefix("https://github.com/")
		.or_else(|| normalized.strip_prefix("http://github.com/"))?;
	let mut segments = path.split('/');
	let owner = segments.next()?.trim();
	let repo = segments.next()?.trim();
	if owner.is_empty() || repo.is_empty() {
		return None;
	}

	Some((owner.to_string(), repo.to_string()))
}

fn marketplace_plugin_repository(plugin: &MarketplacePlugin) -> Option<String> {
	match &plugin.source {
		MarketplaceSource::GitHub { repo, .. } => {
			Some(normalize_repository_url(repo))
		}
		MarketplaceSource::Url { url, .. }
		| MarketplaceSource::GitSubdir { url, .. } => {
			Some(normalize_repository_url(url))
		}
		MarketplaceSource::Local(_) => plugin
			.homepage
			.as_deref()
			.and_then(|url| parse_github_tree_url(url).map(|(repo, _)| repo))
			.or_else(|| plugin.homepage.clone()),
		MarketplaceSource::Npm { .. } => plugin.homepage.clone(),
	}
}

fn json_string_list(value: &serde_json::Value) -> Option<Vec<String>> {
	match value {
		serde_json::Value::Array(items) => {
			let values: Vec<_> = items
				.iter()
				.filter_map(|item| item.as_str().map(str::trim))
				.filter(|item| !item.is_empty())
				.map(str::to_string)
				.collect();
			(!values.is_empty()).then_some(values)
		}
		serde_json::Value::String(item) => {
			let trimmed = item.trim();
			(!trimmed.is_empty()).then_some(vec![trimmed.to_string()])
		}
		_ => None,
	}
}

fn manifest_from_marketplace_plugin(
	plugin: &MarketplacePlugin,
) -> PluginManifest {
	let keywords = plugin
		.extra
		.get("keywords")
		.and_then(json_string_list)
		.or_else(|| plugin.extra.get("tags").and_then(json_string_list));

	PluginManifest {
		name: plugin.name.clone(),
		version: plugin.version.clone(),
		description: plugin.description.clone(),
		author: PluginAuthor {
			name: plugin
				.author
				.as_ref()
				.map(|author| author.name.clone())
				.unwrap_or_else(|| "Unknown".to_string()),
			email: plugin
				.author
				.as_ref()
				.and_then(|author| author.email.clone()),
			url: plugin.homepage.clone(),
		},
		homepage: plugin.homepage.clone(),
		repository: marketplace_plugin_repository(plugin),
		license: None,
		keywords,
		logo: None,
		skills: None,
		agents: None,
		commands: None,
		user_config: None,
	}
}

fn build_materialized_manifest(
	plugin: &MarketplacePlugin,
) -> serde_json::Value {
	let mut manifest = serde_json::Map::new();

	manifest.insert(
		"name".to_string(),
		serde_json::Value::String(plugin.name.clone()),
	);
	manifest.insert(
		"description".to_string(),
		serde_json::Value::String(plugin.description.clone()),
	);

	if let Some(version) = plugin.version.clone() {
		manifest
			.insert("version".to_string(), serde_json::Value::String(version));
	}

	if let Some(author) = &plugin.author {
		let mut author_value = serde_json::Map::new();
		author_value.insert(
			"name".to_string(),
			serde_json::Value::String(author.name.clone()),
		);
		if let Some(email) = &author.email {
			author_value.insert(
				"email".to_string(),
				serde_json::Value::String(email.clone()),
			);
		}
		manifest.insert(
			"author".to_string(),
			serde_json::Value::Object(author_value),
		);
	}

	if let Some(homepage) = &plugin.homepage {
		manifest.insert(
			"homepage".to_string(),
			serde_json::Value::String(homepage.clone()),
		);
	}

	if let Some(repository) = marketplace_plugin_repository(plugin) {
		manifest.insert(
			"repository".to_string(),
			serde_json::Value::String(repository),
		);
	}

	for (key, value) in &plugin.extra {
		if matches!(key.as_str(), "source" | "category" | "tags") {
			continue;
		}
		manifest.insert(key.clone(), value.clone());
	}

	serde_json::Value::Object(manifest)
}

async fn materialize_marketplace_plugin(
	plugin: &MarketplacePlugin,
	source_dir: Option<&Path>,
	target_dir: &Path,
) -> Result<()> {
	if let Some(path) = source_dir {
		copy_dir_all(path, target_dir).await?;
	} else {
		tokio::fs::create_dir_all(target_dir).await?;
	}

	let manifest_dir = target_dir.join(".claude-plugin");
	tokio::fs::create_dir_all(&manifest_dir).await?;
	let manifest_path = manifest_dir.join("plugin.json");
	let manifest =
		serde_json::to_string_pretty(&build_materialized_manifest(plugin))?;
	tokio::fs::write(&manifest_path, manifest).await?;
	Ok(())
}

pub(super) async fn resolve_marketplace_source(
	marketplace_root: &Path,
	marketplace: &str,
	plugin_name: &str,
) -> Result<(String, bool)> {
	let marketplace_path = marketplace_path_for(marketplace_root, marketplace);
	let marketplace_json =
		marketplace_path.join(".claude-plugin/marketplace.json");

	if !marketplace_json.exists() {
		anyhow::bail!("Marketplace configuration not found");
	}

	let content = tokio::fs::read_to_string(&marketplace_json).await?;
	let config: MarketplaceConfig = serde_json::from_str(&content)?;

	for plugin in config.plugins {
		if plugin.name == plugin_name {
			return match &plugin.source {
				MarketplaceSource::Local(path) => {
					let full_path = match path.trim_start_matches("./") {
						"" => marketplace_path.clone(),
						relative => marketplace_path.join(relative),
					};
					if full_path.exists() {
						Ok((full_path.to_string_lossy().to_string(), false))
					} else if let Some((repo_url, subdir)) =
						local_source_remote_fallback(&plugin, path)
					{
						Ok((format!("{repo_url}#{subdir}"), true))
					} else {
						anyhow::bail!(
							"Local plugin path not found: {}",
							full_path.display()
						);
					}
				}
				MarketplaceSource::Url { url, .. } => {
					Ok((normalize_repository_url(url), true))
				}
				MarketplaceSource::GitHub { repo, .. } => {
					Ok((normalize_repository_url(repo), true))
				}
				MarketplaceSource::GitSubdir { url, path, .. } => {
					let url = normalize_repository_url(url);
					let subdir = path.trim_matches('/');
					Ok((format!("{url}#{subdir}"), true))
				}
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

pub struct MarketplaceRegistry {
	marketplace_path: PathBuf,
	plugins_subdirs: Vec<String>,
	upstream_repo: Option<String>,
	client: reqwest::Client,
	git_installer: GitBasedInstaller,
}

enum MarketplaceEntry {
	Definition(Box<MarketplacePlugin>),
	Directory(PathBuf),
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
		let client = build_http_client(60)?;

		Ok(Self {
			marketplace_path,
			plugins_subdirs,
			upstream_repo,
			client,
			git_installer: GitBasedInstaller::new()?,
		})
	}

	pub fn new_official() -> anyhow::Result<Self> {
		let marketplace_path = dirs::home_dir()
			.ok_or_else(|| anyhow::anyhow!("Cannot find home directory"))?
			.join(".claude/plugins/marketplaces/claude-plugins-official");
		Self::new_with_upstream(
			marketplace_path,
			vec!["plugins/".to_string(), "external_plugins/".to_string()],
			Some(OFFICIAL_MARKETPLACE_REPO.to_string()),
		)
	}

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
			tokio::fs::remove_dir_all(&clone_path).await.ok();
		}
		if backup_path.exists() {
			tokio::fs::remove_dir_all(&backup_path).await.ok();
		}

		if let Err(error) = git_clone(
			upstream_repo,
			&clone_path,
			"Failed to execute git clone for marketplace refresh",
		)
		.await
		{
			tokio::fs::remove_dir_all(&clone_path).await.ok();
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
			tokio::fs::remove_dir_all(&clone_path).await.ok();
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

		tokio::fs::remove_dir_all(&backup_path).await.ok();
		Ok(())
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

	async fn get_marketplace_commit(&self) -> Result<Option<String>> {
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

#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::json;
	use tempfile::{Builder, TempDir};

	fn write_manifest(path: &Path, value: serde_json::Value) {
		std::fs::create_dir_all(path.parent().unwrap()).unwrap();
		std::fs::write(path, serde_json::to_string_pretty(&value).unwrap())
			.unwrap();
	}

	fn write_marketplace_config(root: &Path, plugins: Vec<serde_json::Value>) {
		write_manifest(
			&root.join(".claude-plugin/marketplace.json"),
			json!({
				"name": "claude-plugins-official",
				"description": "test",
				"owner": { "name": "A" },
				"plugins": plugins,
			}),
		);
	}

	fn init_git_repo(path: &Path) {
		for args in [
			vec!["init"],
			vec!["add", "."],
			vec![
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@example.com",
				"commit",
				"-m",
				"init",
			],
		] {
			let status = std::process::Command::new("git")
				.args(args)
				.current_dir(path)
				.status()
				.unwrap();
			assert!(status.success());
		}
	}

	fn marketplace_fixture(
		name: &str,
		marketplace: &str,
		plugins: Vec<serde_json::Value>,
		plugin_manifest: Option<&str>,
	) -> (TempDir, PathBuf) {
		let temp_root = Builder::new()
			.prefix(&format!("aghub-marketplace-test-{name}-"))
			.tempdir()
			.unwrap();
		let marketplace_dir = temp_root.path().join(marketplace);
		std::fs::create_dir_all(marketplace_dir.join(".claude-plugin"))
			.unwrap();
		write_marketplace_config(&marketplace_dir, plugins);

		if let Some(plugin_manifest) = plugin_manifest {
			std::fs::write(
				marketplace_dir.join(".claude-plugin/plugin.json"),
				plugin_manifest,
			)
			.unwrap();
		}

		(temp_root, marketplace_dir)
	}

	async fn assert_resolved(
		root: &Path,
		marketplace: &str,
		plugin_name: &str,
		expected: &str,
		is_remote: bool,
	) {
		let (source, actual_is_remote) =
			resolve_marketplace_source(root, marketplace, plugin_name)
				.await
				.unwrap();

		assert_eq!(source, expected);
		assert_eq!(actual_is_remote, is_remote);
	}

	#[tokio::test]
	async fn test_resolve_marketplace_source_remote_variants() {
		let cases = [
			(
				"github",
				json!({
					"name": "test-github",
					"description": "desc",
					"source": {
						"source": "github",
						"repo": "owner/repo",
					},
				}),
				"test-github",
				"https://github.com/owner/repo",
			),
			(
				"fallback",
				json!({
					"name": "autofix-bot",
					"description": "desc",
					"homepage": "https://github.com/anthropics/claude-plugins-public/tree/main/external_plugins/autofix-bot",
					"source": "./external_plugins/autofix-bot",
				}),
				"autofix-bot",
				"https://github.com/anthropics/claude-plugins-public#external_plugins/autofix-bot",
			),
		];

		for (name, plugin, plugin_name, expected) in cases {
			let (temp_root, _) = marketplace_fixture(
				name,
				"claude-plugins-official",
				vec![plugin],
				None,
			);

			assert_resolved(
				temp_root.path().join("cache").as_path(),
				"claude-plugins-official",
				plugin_name,
				expected,
				true,
			)
			.await;
		}
	}

	#[tokio::test]
	async fn test_resolve_marketplace_source_for_custom_marketplace_root() {
		let (temp_root, marketplace_dir) = marketplace_fixture(
			"custom",
			"marketplaces/impeccable",
			vec![json!({
				"name": "impeccable",
				"description": "desc",
				"version": "1.5.1",
				"source": "./",
			})],
			Some(
				r#"{"name":"impeccable","description":"test","author":{"name":"A"}}"#,
			),
		);
		let marketplaces_dir = temp_root.path().join("marketplaces");

		assert!(is_marketplace_source(
			marketplaces_dir.join("claude-plugins-official").as_path(),
			"impeccable",
		));

		assert_resolved(
			marketplaces_dir.join("claude-plugins-official").as_path(),
			"impeccable",
			"impeccable",
			&marketplace_dir.to_string_lossy(),
			false,
		)
		.await;
	}

	#[tokio::test]
	async fn test_fetch_manifest_falls_back_to_marketplace_entry_for_local_plugin(
	) {
		let temp_dir =
			temp_dir("aghub-marketplace-local-manifestless-").unwrap();
		let plugins_dir = temp_dir.path().join("plugins/php-lsp");
		std::fs::create_dir_all(&plugins_dir).unwrap();
		std::fs::write(plugins_dir.join("README.md"), "placeholder").unwrap();
		write_marketplace_config(
			temp_dir.path(),
			vec![json!({
				"name": "php-lsp",
				"description": "PHP language server",
				"version": "1.0.0",
				"author": { "name": "Anthropic" },
				"source": "./plugins/php-lsp",
			})],
		);

		let registry = MarketplaceRegistry::new(
			temp_dir.path().to_path_buf(),
			vec!["plugins/".to_string()],
		)
		.unwrap();
		let manifest = registry.fetch_manifest("php-lsp").await.unwrap();

		assert_eq!(manifest.name, "php-lsp");
		assert_eq!(manifest.version.as_deref(), Some("1.0.0"));
		assert_eq!(manifest.author.name, "Anthropic");
	}

	#[tokio::test]
	async fn test_install_materializes_manifestless_marketplace_plugin() {
		let temp_dir = temp_dir("aghub-marketplace-materialized-").unwrap();
		let plugins_dir = temp_dir.path().join("plugins/php-lsp");
		let install_dir = temp_dir.path().join("installed/php-lsp");
		std::fs::create_dir_all(&plugins_dir).unwrap();
		std::fs::write(plugins_dir.join("README.md"), "placeholder").unwrap();
		write_marketplace_config(
			temp_dir.path(),
			vec![json!({
				"name": "php-lsp",
				"description": "PHP language server",
				"version": "1.0.0",
				"author": { "name": "Anthropic" },
				"source": "./plugins/php-lsp",
				"lspServers": {
					"intelephense": {
						"command": "intelephense",
						"args": ["--stdio"]
					}
				}
			})],
		);

		let registry = MarketplaceRegistry::new(
			temp_dir.path().to_path_buf(),
			vec!["plugins/".to_string()],
		)
		.unwrap();
		registry.install("php-lsp", &install_dir).await.unwrap();

		let manifest = std::fs::read_to_string(
			install_dir.join(".claude-plugin/plugin.json"),
		)
		.unwrap();
		let value: serde_json::Value = serde_json::from_str(&manifest).unwrap();
		assert_eq!(
			value.get("name").and_then(|item| item.as_str()),
			Some("php-lsp")
		);
		assert!(value
			.get("lspServers")
			.and_then(|item| item.get("intelephense"))
			.is_some());
	}

	#[tokio::test]
	async fn test_update_replaces_snapshot_marketplace_from_upstream_repo() {
		let source_dir = temp_dir("aghub-marketplace-source-").unwrap();
		std::fs::create_dir_all(source_dir.path().join("plugins/demo"))
			.unwrap();
		write_marketplace_config(source_dir.path(), vec![]);
		std::fs::write(source_dir.path().join("README.md"), "fresh").unwrap();
		init_git_repo(source_dir.path());

		let snapshot_dir = temp_dir("aghub-marketplace-snapshot-").unwrap();
		write_marketplace_config(snapshot_dir.path(), vec![]);
		std::fs::write(snapshot_dir.path().join("README.md"), "stale").unwrap();

		let registry = MarketplaceRegistry::new_with_upstream(
			snapshot_dir.path().to_path_buf(),
			vec!["plugins/".to_string()],
			Some(source_dir.path().display().to_string()),
		)
		.unwrap();

		registry.update().await.unwrap();

		assert!(snapshot_dir.path().join(".git").exists());
		assert_eq!(
			std::fs::read_to_string(snapshot_dir.path().join("README.md"))
				.unwrap(),
			"fresh"
		);
	}

	#[test]
	fn test_load_marketplace_repository_urls_uses_plugin_subdir() {
		let (temp_root, marketplace_dir) = marketplace_fixture(
			"repo-url",
			"glincker-marketplace",
			vec![json!({
				"name": "workflow-composer",
				"description": "desc",
				"source": "./skills/automation/workflow-composer",
			})],
			None,
		);
		std::fs::create_dir_all(marketplace_dir.join(".git")).unwrap();
		std::fs::write(
			marketplace_dir.join(".git/config"),
			r#"[remote "origin"]
	url = https://github.com/GLINCKER/claude-code-marketplace.git
"#,
		)
		.unwrap();

		let urls = load_marketplace_repository_urls(
			temp_root.path().join("cache").as_path(),
			"glincker-marketplace",
		);
		assert_eq!(
			urls.get("workflow-composer").map(String::as_str),
			Some(
				"https://github.com/GLINCKER/claude-code-marketplace/tree/HEAD/skills/automation/workflow-composer"
			)
		);
	}
}
