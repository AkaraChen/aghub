use super::UnifiedPluginRegistry;
use crate::discovery::marketplace::{
	scan_marketplaces, MarketplaceSource, SourceDef,
};
use crate::discovery::{PluginAuthor, PluginInfo, PluginSource};
use anyhow::Result;
use std::path::{Path, PathBuf};

impl UnifiedPluginRegistry {
	pub(super) async fn scan_marketplaces(&mut self) -> Result<()> {
		let marketplaces_dir = self
			.config
			.plugins_dir
			.join(&self.config.marketplaces_subdir);

		if !marketplaces_dir.exists() {
			log::warn!(
				"Marketplaces directory not found: {}",
				marketplaces_dir.display()
			);
			return Ok(());
		}

		let marketplace_configs = scan_marketplaces(&marketplaces_dir).await?;

		for (marketplace_name, config) in marketplace_configs {
			log::debug!(
				"Scanning marketplace '{}' with {} plugins",
				marketplace_name,
				config.plugins.len()
			);
			let owner_name = config.owner.name.clone();
			let owner_email = config.owner.email.clone();

			for plugin_def in config.plugins {
				let plugin_id =
					format!("{}@{}", plugin_def.name, marketplace_name);
				let source_def = SourceDef::from(&plugin_def.source);
				let source = PluginSource::from_marketplace_def(&source_def);
				let git_sha = match &source_def {
					SourceDef::GitHub { sha, .. } => sha.clone(),
					SourceDef::Url { sha, .. } => sha.clone(),
					SourceDef::GitSubdir { sha, .. } => sha.clone(),
					_ => None,
				};
				let install_count =
					self.install_counts.get(&plugin_id).copied();
				let author = plugin_def
					.author
					.map(|author| PluginAuthor {
						name: author.name,
						email: author.email,
					})
					.or_else(|| {
						Some(PluginAuthor {
							name: owner_name.clone(),
							email: owner_email.clone(),
						})
					});

				let plugin_info = PluginInfo {
					id: plugin_id.clone(),
					name: plugin_def.name.clone(),
					description: plugin_def.description,
					version: plugin_def.version,
					author,
					category: plugin_def.category.clone(),
					source,
					marketplace: marketplace_name.clone(),
					local_path: None,
					installed: false,
					enabled: None,
					install_count,
					homepage: plugin_def.homepage.clone(),
					repository: None,
					keywords: Vec::new(),
					git_sha,
					has_mcp: false,
					has_skills: false,
					has_hooks: false,
				};

				if let Some(local_path) = Self::find_local_plugin_path(
					&marketplaces_dir,
					&marketplace_name,
					&plugin_def.source,
				) {
					if tokio::fs::try_exists(&local_path).await.unwrap_or(false)
					{
						let mut info = plugin_info;
						info.local_path = Some(local_path.clone());

						if let Some(metadata) =
							Self::extract_local_metadata(&local_path).await
						{
							if info.version.is_none() {
								info.version = metadata.version;
							}
							if info.author.is_none() {
								info.author = metadata.author;
							}
							if info.homepage.is_none() {
								info.homepage = metadata.homepage;
							}
							if info.repository.is_none() {
								info.repository = metadata.repository;
							}
							if info.keywords.is_empty() {
								info.keywords = metadata.keywords;
							}
							info.has_mcp = metadata.has_mcp;
							info.has_skills = metadata.has_skills;
							info.has_hooks = metadata.has_hooks;
						}

						self.plugins.insert(plugin_id, info);
					} else {
						self.plugins.insert(plugin_id, plugin_info);
					}
				} else {
					self.plugins.insert(plugin_id, plugin_info);
				}
			}
		}

		Ok(())
	}

	fn find_local_plugin_path(
		marketplaces_dir: &Path,
		marketplace_name: &str,
		source: &MarketplaceSource,
	) -> Option<PathBuf> {
		match source {
			MarketplaceSource::Local(path) => {
				let marketplace_path = marketplaces_dir.join(marketplace_name);
				Some(marketplace_path.join(path.trim_start_matches("./")))
			}
			_ => None,
		}
	}
}
