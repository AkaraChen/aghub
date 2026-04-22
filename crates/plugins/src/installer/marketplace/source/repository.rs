use super::super::super::registry::normalize_repository_url;
use crate::discovery::{
	MarketplaceConfig, MarketplacePlugin, MarketplaceSource,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub(in crate::installer::marketplace) fn marketplace_path_for(
	marketplace_root: &Path,
	marketplace: &str,
) -> PathBuf {
	marketplace_root
		.parent()
		.unwrap_or(marketplace_root)
		.join(marketplace)
}

fn marketplace_git_config_path(
	marketplace_root: &Path,
	marketplace: &str,
) -> Option<PathBuf> {
	let git_path =
		marketplace_path_for(marketplace_root, marketplace).join(".git");
	if git_path.is_dir() {
		return Some(git_path.join("config"));
	}

	let gitdir = std::fs::read_to_string(&git_path).ok()?;
	let path = gitdir.strip_prefix("gitdir:")?.trim();
	let resolved = git_path.parent()?.join(path);
	Some(resolved.join("config"))
}

fn marketplace_origin_url_from_git(
	marketplace_root: &Path,
	marketplace: &str,
) -> Option<String> {
	let config_path =
		marketplace_git_config_path(marketplace_root, marketplace)?;
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

pub(in crate::installer::marketplace) fn load_marketplace_repository_urls(
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

pub(in crate::installer::marketplace) fn is_marketplace_source(
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
	let normalized = normalize_repository_url(url);
	let marker = "/tree/";
	let (repo_url, rest) = normalized.split_once(marker)?;
	let mut parts = rest.split('/');
	let branch = parts.next()?;
	let subdir = parts.collect::<Vec<_>>().join("/");
	if branch.is_empty() || subdir.is_empty() {
		return None;
	}

	Some((repo_url.to_string(), subdir))
}

pub(in crate::installer::marketplace) fn github_owner_repo(
	url: &str,
) -> Option<(String, String)> {
	let mut normalized = normalize_repository_url(url);
	if let Some((repo_url, _)) = parse_github_tree_url(&normalized) {
		normalized = repo_url;
	}

	let path = normalized
		.strip_prefix("https://github.com/")
		.or_else(|| normalized.strip_prefix("http://github.com/"))?;
	let mut segments = path.split('/');
	let owner = segments.next()?.trim();
	let repo = segments.next()?.trim();
	if owner.is_empty() || repo.is_empty() {
		return None;
	}

	Some((owner.to_string(), repo.to_string()))
}

pub(super) fn marketplace_plugin_repository(
	plugin: &MarketplacePlugin,
) -> Option<String> {
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
