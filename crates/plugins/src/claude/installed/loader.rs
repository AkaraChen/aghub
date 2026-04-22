use super::super::manifest::{
	extract_version_from_path, find_latest_manifest_in_siblings, read_manifest,
};
use super::super::{
	settings, types, ClaudePluginInfo, ClaudePluginManager, PluginScopeInfo,
};
use crate::{PluginId, PluginSource};
use anyhow::Result;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

impl ClaudePluginManager {
	pub fn new() -> Result<Self> {
		let plugins_dir = default_plugins_dir()?;
		Self::new_with_plugins_dir(&plugins_dir)
	}

	pub(crate) fn new_with_plugins_dir(plugins_dir: &Path) -> Result<Self> {
		let settings_path = plugins_dir
			.parent()
			.ok_or_else(|| {
				anyhow::anyhow!(
					"Plugins directory has no parent: {}",
					plugins_dir.display()
				)
			})?
			.join("settings.json");
		let settings =
			settings::ClaudeSettings::load_from_path(&settings_path)?;
		let installed =
			Self::load_installed_plugins_from_dir(&settings, plugins_dir)?;

		Ok(Self {
			settings,
			installed,
		})
	}

	fn load_installed_plugins_from_dir(
		settings: &settings::ClaudeSettings,
		plugins_dir: &Path,
	) -> Result<Vec<ClaudePluginInfo>> {
		let manifest_path = plugins_dir.join("installed_plugins.json");

		let mut manifest_plugins = if manifest_path.exists() {
			types::InstalledPluginsManifest::load(&manifest_path)?.plugins
		} else {
			HashMap::new()
		};

		Self::supplement_missing_installations(
			settings,
			&mut manifest_plugins,
			plugins_dir,
		)?;

		if manifest_plugins.is_empty() {
			return Ok(Vec::new());
		}

		let mut plugins = Vec::new();

		for (id_str, installations) in manifest_plugins {
			if installations.is_empty() {
				continue;
			}

			let id = PluginId::parse(&id_str)?;
			let source_str = id_str.split('@').nth(1).unwrap_or("unknown");
			let source = PluginSource::parse(source_str)?;
			let display_name =
				id_str.split('@').next().unwrap_or(&id_str).to_string();

			let mut scopes = Vec::with_capacity(installations.len());
			for info in &installations {
				scopes.push(PluginScopeInfo {
					scope: info.scope.clone(),
					install_path: PathBuf::from(&info.install_path),
					version: info.version.clone(),
					installed_at: info.installed_at.clone(),
					last_updated: info.last_updated.clone(),
					git_commit_sha: info.git_commit_sha.clone(),
				});
			}

			let primary = &installations[0];
			let install_path = PathBuf::from(&primary.install_path);
			let manifest = read_manifest(&install_path)
				.ok()
				.flatten()
				.or_else(|| find_latest_manifest_in_siblings(&install_path));

			let description = manifest.as_ref().map(|m| m.description.clone());
			let author = manifest.as_ref().and_then(|manifest| {
				(!manifest.author.is_empty()).then_some(manifest.author.clone())
			});
			let repository =
				manifest.as_ref().and_then(|m| m.repository.clone());
			let license = manifest.as_ref().and_then(|m| m.license.clone());
			let keywords = manifest.as_ref().and_then(|m| m.keywords.clone());

			let version = manifest
				.as_ref()
				.and_then(|m| {
					let version = m.version.clone()?;
					if version == "unknown" || version.is_empty() {
						None
					} else {
						Some(version)
					}
				})
				.or_else(|| {
					if primary.version != "unknown"
						&& !primary.version.is_empty()
					{
						Some(primary.version.clone())
					} else {
						None
					}
				})
				.or_else(|| extract_version_from_path(&install_path))
				.or_else(|| {
					primary
						.git_commit_sha
						.as_ref()
						.map(|sha| sha[..7.min(sha.len())].to_string())
				})
				.unwrap_or_else(|| "unknown".to_string());

			plugins.push(ClaudePluginInfo {
				id: id.clone(),
				display_name,
				version,
				description,
				author,
				repository,
				license,
				keywords,
				source,
				install_path,
				enabled: settings.is_enabled(&id),
				commit_hash: primary.git_commit_sha.clone().unwrap_or_default(),
				scopes,
			});
		}

		Ok(plugins)
	}
}

fn default_plugins_dir() -> Result<PathBuf> {
	Ok(dirs::home_dir()
		.ok_or_else(|| anyhow::anyhow!("Cannot find home directory"))?
		.join(".claude/plugins"))
}
