mod registry_catalog;
mod registry_impl;
mod registry_sync;
mod source;

use anyhow::Result;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub use self::registry_impl::MarketplaceRegistry;

pub(super) fn marketplace_path_for(
	marketplace_root: &Path,
	marketplace: &str,
) -> PathBuf {
	self::source::marketplace_path_for(marketplace_root, marketplace)
}

pub(super) fn load_marketplace_repository_urls(
	marketplace_root: &Path,
	marketplace: &str,
) -> HashMap<String, String> {
	self::source::load_marketplace_repository_urls(
		marketplace_root,
		marketplace,
	)
}

pub(super) fn is_marketplace_source(
	marketplace_root: &Path,
	source: &str,
) -> bool {
	self::source::is_marketplace_source(marketplace_root, source)
}

pub(super) async fn resolve_marketplace_source(
	marketplace_root: &Path,
	marketplace: &str,
	plugin_name: &str,
) -> Result<(String, bool)> {
	self::source::resolve_marketplace_source(
		marketplace_root,
		marketplace,
		plugin_name,
	)
	.await
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::installer::registry::{temp_dir, PluginRegistry};
	use serde_json::json;
	use std::path::{Path, PathBuf};
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
		let marketplace_dir = marketplace
			.split('/')
			.fold(temp_root.path().to_path_buf(), |acc, part| acc.join(part));
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
