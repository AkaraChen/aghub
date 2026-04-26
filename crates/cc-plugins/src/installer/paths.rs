use crate::claude::settings::InstallScope;
use crate::PluginSource;
use anyhow::{Context, Result};
use chrono::Utc;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// Produce a short hex digest (first 16 bytes / 32 hex chars) for filesystem paths.
pub(crate) fn short_sha256(data: impl AsRef<[u8]>) -> String {
	let hash = Sha256::digest(data);
	// 16 bytes → 32 hex chars — unique enough for path dedup, shorter than full SHA-256
	hash.iter()
		.take(16)
		.fold(String::with_capacity(32), |mut s, b| {
			use std::fmt::Write;
			let _ = write!(s, "{b:02x}");
			s
		})
}

pub(super) fn storage_key_for_source(
	source: &str,
	is_marketplace_source: impl Fn(&str) -> bool,
) -> String {
	if is_marketplace_source(source) {
		return source.to_string();
	}

	match PluginSource::parse(source) {
		Ok(PluginSource::OfficialRegistry) => source.to_string(),
		Ok(PluginSource::ThirdParty { url }) => short_sha256(url),
		Ok(PluginSource::Local { path }) => {
			format!("local-{}", short_sha256(path.to_string_lossy().as_bytes()))
		}
		Err(_) => short_sha256(source.as_bytes()),
	}
}

pub(super) fn manifest_path() -> Result<PathBuf> {
	Ok(dirs::home_dir()
		.context("Cannot find home directory")?
		.join(".claude/plugins/installed_plugins.json"))
}

pub(super) fn scope_root(
	cache_root: &Path,
	storage_key: &str,
	name: &str,
	scope: InstallScope,
) -> PathBuf {
	cache_root
		.join(storage_key)
		.join(name)
		.join("scopes")
		.join(scope.to_string())
}

pub(super) fn staging_dir_for(target_dir: &Path) -> Result<PathBuf> {
	let parent = target_dir.parent().ok_or_else(|| {
		anyhow::anyhow!(
			"Invalid install target without parent: {}",
			target_dir.display()
		)
	})?;
	let unique = Utc::now()
		.timestamp_nanos_opt()
		.map(|value| value.to_string())
		.unwrap_or_else(|| std::process::id().to_string());
	Ok(parent.join(format!(".staging-{unique}")))
}

pub(super) async fn cleanup_empty_dirs(
	cache_root: &Path,
	install_path: &Path,
) -> Result<()> {
	let mut current = install_path.parent();

	while let Some(dir) = current {
		if dir == cache_root {
			break;
		}

		if dir.exists() {
			let is_empty = tokio::fs::read_dir(dir)
				.await?
				.next_entry()
				.await?
				.is_none();

			if is_empty {
				if let Err(e) = tokio::fs::remove_dir(dir).await {
					log::warn!(
						"Failed to remove empty dir {}: {e}",
						dir.display()
					);
				}
			} else {
				break;
			}
		}

		current = dir.parent();
	}

	Ok(())
}
