use super::manifest::{
	extract_version_from_path, find_latest_manifest_in_siblings, read_manifest,
};
use super::{
	settings, types, ClaudePluginInfo, ClaudePluginManager, PluginScopeInfo,
};
use crate::{PluginId, PluginSource};
use anyhow::Result;
use semver::Version;
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

fn normalize_version(version: Option<&str>) -> Option<String> {
	version
		.filter(|v| !v.is_empty() && *v != "unknown")
		.map(|v| v.to_string())
}

// ── Cache ──

#[derive(Debug)]
struct CacheInstallCandidate {
	path: PathBuf,
	version: String,
	modified: SystemTime,
	timestamp: String,
	git_commit_sha: Option<String>,
}

impl ClaudePluginManager {
	pub(super) fn supplement_missing_installations(
		settings: &settings::ClaudeSettings,
		manifest_plugins: &mut HashMap<String, Vec<types::InstalledPluginInfo>>,
		plugins_dir: &Path,
	) -> Result<()> {
		let mut plugin_ids = BTreeSet::new();
		plugin_ids.extend(
			settings
				.enabled_plugins
				.iter()
				.filter_map(|(id, enabled)| enabled.then_some(id.clone())),
		);

		for id_str in plugin_ids {
			if manifest_plugins
				.get(&id_str)
				.is_some_and(|installations| !installations.is_empty())
			{
				continue;
			}

			let Ok(id) = PluginId::parse(&id_str) else {
				continue;
			};

			if let Some(installation) =
				discover_cache_installation(&id, plugins_dir)?
			{
				manifest_plugins.insert(id_str, vec![installation]);
			}
		}

		Ok(())
	}
}

fn discover_cache_installation(
	id: &PluginId,
	plugins_dir: &Path,
) -> Result<Option<types::InstalledPluginInfo>> {
	let cache_root = plugins_dir.join("cache");

	if !cache_root.exists() {
		return Ok(None);
	}

	let mut candidates = Vec::new();
	collect_cache_install_candidates(
		&cache_root.join(&id.source).join(&id.name),
		&mut candidates,
		0,
	);

	if candidates.is_empty() {
		let entries = match std::fs::read_dir(&cache_root) {
			Ok(entries) => entries,
			Err(_) => return Ok(None),
		};

		for entry in entries.flatten() {
			collect_cache_install_candidates(
				&entry.path().join(&id.name),
				&mut candidates,
				0,
			);
		}
	}

	let candidate = match select_best_cache_install(candidates) {
		Some(candidate) => candidate,
		None => return Ok(None),
	};

	Ok(Some(types::InstalledPluginInfo {
		scope: "global".to_string(),
		install_path: candidate.path.display().to_string(),
		version: candidate.version,
		installed_at: candidate.timestamp.clone(),
		last_updated: candidate.timestamp,
		git_commit_sha: candidate.git_commit_sha,
	}))
}

fn collect_cache_install_candidates(
	plugin_root: &Path,
	candidates: &mut Vec<CacheInstallCandidate>,
	depth: usize,
) {
	if !plugin_root.is_dir() || depth > 4 {
		return;
	}

	let Ok(entries) = std::fs::read_dir(plugin_root) else {
		return;
	};

	for entry in entries.flatten() {
		let path = entry.path();
		if !path.is_dir() {
			continue;
		}

		let manifest = read_manifest(&path)
			.inspect_err(|e| {
				log::debug!(
					"Failed to read manifest at {}: {e}",
					path.display()
				)
			})
			.ok()
			.flatten();
		if manifest.is_none() {
			collect_cache_install_candidates(&path, candidates, depth + 1);
			continue;
		}

		let version = manifest
			.as_ref()
			.and_then(|m| normalize_version(m.version.as_deref()))
			.or_else(|| extract_version_from_path(&path))
			.unwrap_or_else(|| {
				path.file_name()
					.and_then(|value| value.to_str())
					.unwrap_or("unknown")
					.to_string()
			});
		let modified = entry
			.metadata()
			.and_then(|metadata| metadata.modified())
			.unwrap_or(SystemTime::UNIX_EPOCH);
		let timestamp =
			chrono::DateTime::<chrono::Utc>::from(modified).to_rfc3339();

		candidates.push(CacheInstallCandidate {
			path: path.clone(),
			version,
			modified,
			timestamp,
			git_commit_sha: infer_commit_from_path(&path),
		});
	}
}

fn select_best_cache_install(
	mut candidates: Vec<CacheInstallCandidate>,
) -> Option<CacheInstallCandidate> {
	candidates.sort_by(|a, b| {
		let a_name = a.path.file_name().and_then(|value| value.to_str());
		let b_name = b.path.file_name().and_then(|value| value.to_str());
		let a_is_latest = a_name == Some("latest");
		let b_is_latest = b_name == Some("latest");

		b_is_latest
			.cmp(&a_is_latest)
			.then_with(|| {
				match (Version::parse(&a.version), Version::parse(&b.version)) {
					(Ok(a_ver), Ok(b_ver)) => b_ver.cmp(&a_ver),
					(Ok(_), Err(_)) => std::cmp::Ordering::Less,
					(Err(_), Ok(_)) => std::cmp::Ordering::Greater,
					(Err(_), Err(_)) => b.modified.cmp(&a.modified),
				}
			})
			.then_with(|| b.modified.cmp(&a.modified))
	});

	candidates.into_iter().next()
}

fn infer_commit_from_path(path: &Path) -> Option<String> {
	let name = path.file_name()?.to_str()?;

	if name == "latest"
		|| name == "unknown"
		|| extract_version_from_path(path).is_some()
	{
		return None;
	}

	if name.len() >= 7 && name.chars().all(|ch| ch.is_ascii_hexdigit()) {
		return Some(name.to_string());
	}

	None
}

// ── Loader ──

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
				.and_then(|m| normalize_version(m.version.as_deref()))
				.or_else(|| normalize_version(Some(&primary.version)))
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
