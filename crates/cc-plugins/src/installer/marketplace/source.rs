use super::super::registry::{copy_dir_all, normalize_repository_url};
use crate::claude::types::{PluginAuthor, PluginManifest};
use crate::discovery::{
	MarketplaceConfig, MarketplacePlugin, MarketplaceSource,
};
use anyhow::Result;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

// ── Manifest ──

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

// ── Repository ──

pub(in crate::installer) fn marketplace_path_for(
	marketplace_root: &Path,
	marketplace: &str,
) -> PathBuf {
	marketplace_root
		.parent()
		.unwrap_or(marketplace_root)
		.join(marketplace)
}

fn marketplace_origin_url_from_git(
	marketplace_root: &Path,
	marketplace: &str,
) -> Option<String> {
	let git_path =
		marketplace_path_for(marketplace_root, marketplace).join(".git");
	let config_path = if git_path.is_dir() {
		git_path.join("config")
	} else {
		let gitdir = std::fs::read_to_string(&git_path).ok()?;
		let path = gitdir.strip_prefix("gitdir:")?.trim();
		git_path.parent()?.join(path).join("config")
	};
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

pub(in crate::installer) fn load_marketplace_repository_urls(
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

pub(in crate::installer) fn is_marketplace_source(
	marketplace_root: &Path,
	source: &str,
) -> bool {
	marketplace_path_for(marketplace_root, source)
		.join(".claude-plugin/marketplace.json")
		.exists()
}

pub(in crate::installer::marketplace) fn local_source_remote_fallback(
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
	let marker = "/tree/";
	let (repo_part, rest) = url.split_once(marker)?;
	let mut parts = rest.split('/');
	let branch = parts.next()?;
	let subdir = parts.collect::<Vec<_>>().join("/");
	if branch.is_empty() || subdir.is_empty() {
		return None;
	}

	let repo_url = normalize_repository_url(repo_part);
	Some((repo_url, subdir))
}

pub(in crate::installer::marketplace) fn github_owner_repo(
	url: &str,
) -> Option<(String, String)> {
	let normalized = normalize_repository_url(url);
	// Strip /tree/branch/subdir suffix before extracting owner/repo.
	let clean = parse_github_tree_url(&normalized)
		.map(|(repo_url, _)| repo_url)
		.unwrap_or(normalized);
	aghub_git::resolve_remote_source(&clean)
		.ok()
		.filter(|resolved| {
			resolved.source_type == aghub_git::RemoteSourceType::Github
		})
		.and_then(|resolved| {
			resolved
				.source
				.split_once('/')
				.map(|(o, r)| (o.to_string(), r.to_string()))
		})
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

#[cfg(test)]
mod tests {
	use super::github_owner_repo;

	#[test]
	fn github_owner_repo_accepts_github_sources() {
		assert_eq!(
			github_owner_repo(
				"https://github.com/trusted/plugin/tree/main/example",
			),
			Some(("trusted".to_string(), "plugin".to_string()))
		);
		assert_eq!(
			github_owner_repo("git@github.com:trusted/plugin.git"),
			Some(("trusted".to_string(), "plugin".to_string()))
		);
	}

	#[test]
	fn github_owner_repo_rejects_non_github_sources() {
		assert_eq!(
			github_owner_repo("https://evil.example/trusted/plugin"),
			None
		);
		assert_eq!(
			github_owner_repo("https://gitlab.com/trusted/plugin"),
			None
		);
	}
}
