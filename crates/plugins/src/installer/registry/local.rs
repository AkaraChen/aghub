use super::{
	copy_dir_all, local_plugin_candidates, read_plugin_manifest,
	resolve_plugin_dir, PluginRegistry,
};
use crate::claude::types::PluginManifest;
use anyhow::Result;
use async_trait::async_trait;
use std::path::{Path, PathBuf};

pub struct LocalRegistry {
	base_path: PathBuf,
}

impl LocalRegistry {
	pub fn new(base_path: PathBuf) -> Self {
		Self { base_path }
	}
}

#[async_trait]
impl PluginRegistry for LocalRegistry {
	async fn fetch_manifest(&self, name: &str) -> Result<PluginManifest> {
		let plugin_dir =
			resolve_plugin_dir(&self.base_path, &local_plugin_candidates(name))
				.ok_or_else(|| {
					anyhow::anyhow!(
						"plugin.json not found in local plugin: {}",
						name
					)
				})?;
		read_plugin_manifest(&plugin_dir).await
	}

	async fn install(
		&self,
		name: &str,
		target_dir: &Path,
	) -> Result<Option<String>> {
		let source_dir =
			resolve_plugin_dir(&self.base_path, &local_plugin_candidates(name))
				.ok_or_else(|| {
					anyhow::anyhow!(
						"Local plugin directory not found for '{}'",
						name
					)
				})?;

		copy_dir_all(&source_dir, target_dir).await?;
		Ok(None)
	}

	async fn get_latest_version(
		&self,
		_name: &str,
	) -> Result<Option<(String, Option<String>)>> {
		Ok(Some(("local".to_string(), None)))
	}
}
