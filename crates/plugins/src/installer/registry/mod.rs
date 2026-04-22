mod github;
mod local;
mod support;

use crate::claude::types::PluginManifest;
use anyhow::Result;
use async_trait::async_trait;
use std::path::Path;

pub use self::github::GitHubRegistry;
pub use self::local::LocalRegistry;
pub(crate) use self::support::{
	copy_dir_all, extract_repository_archive, fetch_github_commit,
	fetch_github_raw_manifest, find_plugin_manifest_path, first_manifest_dir,
	git_clone, git_ok, git_output, is_git_repository, local_plugin_candidates,
	manifest_candidate_paths, normalize_repository_url, read_plugin_manifest,
	remote_plugin_candidates, repository_archive_urls, resolve_plugin_dir,
	resolve_plugin_dir_with_wrappers, temp_dir,
};
pub use super::marketplace::MarketplaceRegistry;

#[async_trait]
pub trait PluginRegistry: Send + Sync {
	async fn fetch_manifest(&self, name: &str) -> Result<PluginManifest>;

	async fn install(
		&self,
		name: &str,
		target_dir: &Path,
	) -> Result<Option<String>>;

	async fn get_latest_version(
		&self,
		name: &str,
	) -> Result<Option<(String, Option<String>)>>;
}

#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::json;
	use std::path::{Path, PathBuf};

	fn write_manifest(path: &Path, value: serde_json::Value) {
		std::fs::create_dir_all(path.parent().unwrap()).unwrap();
		std::fs::write(path, serde_json::to_string_pretty(&value).unwrap())
			.unwrap();
	}

	fn demo_manifest(name: &str) -> serde_json::Value {
		json!({
			"name": name,
			"description": "test",
			"author": { "name": "A" },
		})
	}

	#[tokio::test]
	async fn test_local_registry_supports_plugin_root_base_path() {
		let temp_dir = temp_dir("aghub-local-registry-").unwrap();
		let plugin_dir = temp_dir.path().join("demo-plugin");
		let install_dir = temp_dir.path().join("installed");
		let manifest_dir = plugin_dir.join(".claude-plugin");

		std::fs::create_dir_all(&manifest_dir).unwrap();
		std::fs::write(
			manifest_dir.join("plugin.json"),
			r#"{"name":"demo-plugin","description":"test","author":{"name":"A"}}"#,
		)
		.unwrap();

		let registry = LocalRegistry::new(plugin_dir.clone());
		let manifest = registry.fetch_manifest("demo-plugin").await.unwrap();
		assert_eq!(manifest.name, "demo-plugin");

		registry.install("demo-plugin", &install_dir).await.unwrap();
		assert!(install_dir.join(".claude-plugin/plugin.json").exists());
	}

	#[test]
	fn test_resolve_plugin_dir_variants() {
		let cases = [
			(
				"root",
				PathBuf::new(),
				vec![PathBuf::from("demo-plugin"), PathBuf::new()],
				false,
			),
			(
				"subdir",
				PathBuf::from("demo-plugin"),
				vec![PathBuf::from("demo-plugin"), PathBuf::new()],
				false,
			),
			(
				"wrapper",
				PathBuf::from("repo-wrapper/plugins/demo-plugin"),
				vec![PathBuf::from("plugins/demo-plugin")],
				true,
			),
		];

		for (name, manifest_dir, candidates, use_wrappers) in cases {
			let temp_dir =
				temp_dir(&format!("aghub-remote-registry-{name}-")).unwrap();
			let plugin_dir = temp_dir.path().join(manifest_dir);
			write_manifest(
				&plugin_dir.join(".claude-plugin/plugin.json"),
				demo_manifest("demo-plugin"),
			);

			let resolved = if use_wrappers {
				resolve_plugin_dir_with_wrappers(temp_dir.path(), &candidates)
			} else {
				resolve_plugin_dir(temp_dir.path(), &candidates)
			}
			.unwrap();
			assert_eq!(resolved, plugin_dir);
		}
	}

	#[test]
	fn test_normalize_repository_url_supports_repo_shorthand() {
		assert_eq!(
			normalize_repository_url("railwayapp/railway-skills"),
			"https://github.com/railwayapp/railway-skills"
		);
	}
}
