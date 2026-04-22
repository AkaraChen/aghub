use super::super::super::registry::normalize_repository_url;
use super::repository::{local_source_remote_fallback, marketplace_path_for};
use crate::discovery::{MarketplaceConfig, MarketplaceSource};
use anyhow::Result;
use std::path::Path;

pub(in crate::installer::marketplace) async fn resolve_marketplace_source(
	marketplace_root: &Path,
	marketplace: &str,
	plugin_name: &str,
) -> Result<(String, bool)> {
	let marketplace_path = marketplace_path_for(marketplace_root, marketplace);
	let marketplace_json =
		marketplace_path.join(".claude-plugin/marketplace.json");

	if !marketplace_json.exists() {
		anyhow::bail!("Marketplace configuration not found");
	}

	let content = tokio::fs::read_to_string(&marketplace_json).await?;
	let config: MarketplaceConfig = serde_json::from_str(&content)?;

	for plugin in config.plugins {
		if plugin.name == plugin_name {
			return match &plugin.source {
				MarketplaceSource::Local(path) => {
					let full_path = match path.trim_start_matches("./") {
						"" => marketplace_path.clone(),
						relative => marketplace_path.join(relative),
					};
					if full_path.exists() {
						Ok((full_path.to_string_lossy().to_string(), false))
					} else if let Some((repo_url, subdir)) =
						local_source_remote_fallback(&plugin, path)
					{
						Ok((format!("{repo_url}#{subdir}"), true))
					} else {
						anyhow::bail!(
							"Local plugin path not found: {}",
							full_path.display()
						);
					}
				}
				MarketplaceSource::Url { url, .. } => {
					Ok((normalize_repository_url(url), true))
				}
				MarketplaceSource::GitHub { repo, .. } => {
					Ok((normalize_repository_url(repo), true))
				}
				MarketplaceSource::GitSubdir { url, path, .. } => {
					let url = normalize_repository_url(url);
					let subdir = path.trim_matches('/');
					Ok((format!("{url}#{subdir}"), true))
				}
				MarketplaceSource::Npm { package, .. } => {
					anyhow::bail!(
						"NPM package source not yet supported: {}",
						package
					);
				}
			};
		}
	}

	anyhow::bail!("Plugin '{}' not found in marketplace", plugin_name)
}
