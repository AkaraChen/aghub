use super::super::manifest::{extract_version_from_path, read_manifest};
use super::super::{settings, types, ClaudePluginManager};
use crate::PluginId;
use anyhow::Result;
use semver::Version;
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

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
			);
		}
	}

	let candidate = match select_best_cache_install(candidates) {
		Some(candidate) => candidate,
		None => return Ok(None),
	};

	Ok(Some(types::InstalledPluginInfo {
		scope: "user".to_string(),
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
) {
	collect_cache_install_candidates_with_depth(plugin_root, candidates, 0);
}

fn collect_cache_install_candidates_with_depth(
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

		let manifest = read_manifest(&path).ok().flatten();
		if manifest.is_none() {
			collect_cache_install_candidates_with_depth(
				&path,
				candidates,
				depth + 1,
			);
			continue;
		}

		let version = manifest
			.as_ref()
			.and_then(|plugin_manifest| plugin_manifest.version.clone())
			.and_then(|value| {
				if !value.is_empty() && value != "unknown" {
					Some(value)
				} else {
					None
				}
			})
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
