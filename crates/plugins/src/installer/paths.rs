use crate::claude::settings::InstallScope;
use crate::PluginSource;
use anyhow::{Context, Result};
use chrono::Utc;
use std::path::{Path, PathBuf};

pub(super) fn storage_key_for_source(
	source: &str,
	is_marketplace_source: impl Fn(&str) -> bool,
) -> String {
	if is_marketplace_source(source) {
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
				tokio::fs::remove_dir(dir).await.ok();
			} else {
				break;
			}
		}

		current = dir.parent();
	}

	Ok(())
}
