use super::super::super::registry::copy_dir_all;
use super::repository::marketplace_plugin_repository;
use crate::claude::types::{PluginAuthor, PluginManifest};
use crate::discovery::MarketplacePlugin;
use anyhow::Result;
use std::path::Path;

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

pub(in crate::installer::marketplace) fn manifest_from_marketplace_plugin(
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

pub(in crate::installer::marketplace) async fn materialize_marketplace_plugin(
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
