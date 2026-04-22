use super::{LocalPluginMetadata, UnifiedPluginRegistry};
use crate::claude::types::PluginManifest as ClaudePluginManifest;
use crate::claude::ClaudePluginManager;
use crate::discovery::{PluginAuthor, PluginInfo, PluginSource};
use anyhow::Result;
use std::path::{Path, PathBuf};

impl UnifiedPluginRegistry {
	async fn find_manifest_path(plugin_dir: &Path) -> Option<PathBuf> {
		let possible_paths = [
			plugin_dir.join(".claude-plugin/plugin.json"),
			plugin_dir.join(".plugin/plugin.json"),
			plugin_dir.join("plugin.json"),
		];

		for path in &possible_paths {
			if tokio::fs::try_exists(path).await.ok()? {
				return Some(path.clone());
			}
		}

		None
	}

	pub(super) async fn extract_local_metadata(
		plugin_dir: &Path,
	) -> Option<LocalPluginMetadata> {
		let manifest_path = Self::find_manifest_path(plugin_dir).await?;
		let content = tokio::fs::read_to_string(manifest_path).await.ok()?;
		let json = serde_json::from_str::<serde_json::Value>(&content).ok()?;
		let manifest =
			serde_json::from_str::<ClaudePluginManifest>(&content).ok();
		let has_hooks = tokio::fs::try_exists(plugin_dir.join("hooks"))
			.await
			.unwrap_or(false)
			|| tokio::fs::try_exists(plugin_dir.join("hooks.json"))
				.await
				.unwrap_or(false);

		Some(LocalPluginMetadata {
			version: manifest.as_ref().and_then(|m| m.version.clone()),
			author: manifest.as_ref().and_then(|manifest| {
				(!manifest.author.is_empty()).then_some(PluginAuthor {
					name: manifest.author.name.clone(),
					email: manifest.author.email.clone(),
				})
			}),
			homepage: manifest.as_ref().and_then(|m| m.homepage.clone()),
			repository: manifest.as_ref().and_then(|m| m.repository.clone()),
			keywords: manifest.and_then(|m| m.keywords).unwrap_or_default(),
			has_mcp: json.get("mcpServers").is_some()
				|| json.get("mcp_servers").is_some(),
			has_skills: json.get("skills").is_some()
				&& !json["skills"].is_null(),
			has_hooks: json.get("hooks").is_some() || has_hooks,
		})
	}

	pub(super) async fn scan_local_installs(&mut self) -> Result<()> {
		match ClaudePluginManager::new_with_plugins_dir(
			&self.config.plugins_dir,
		) {
			Ok(manager) => {
				let installed = manager.list_plugins();
				log::debug!("Found {} installed plugins", installed.len());

				for plugin in installed {
					let plugin_id = plugin.id.to_string();
					let parts: Vec<&str> = plugin_id.split('@').collect();
					let (name, marketplace) = if parts.len() == 2 {
						(parts[0].to_string(), parts[1].to_string())
					} else {
						(plugin_id.clone(), "unknown".to_string())
					};

					if let Some(existing) = self.plugins.get_mut(&plugin_id) {
						existing.installed = true;
						existing.enabled = Some(plugin.enabled);
						existing.local_path = Some(plugin.install_path.clone());
						existing.has_mcp = existing.has_mcp || plugin.has_mcp();
						existing.has_skills =
							existing.has_skills || plugin.has_skills();
						existing.has_hooks =
							existing.has_hooks || plugin.has_hooks();
						if existing.version.is_none()
							&& !plugin.version.is_empty()
						{
							existing.version = Some(plugin.version.clone());
						}
					} else {
						let install_count =
							self.install_counts.get(&plugin_id).copied();

						let plugin_info = PluginInfo {
							id: plugin_id.clone(),
							name: name.clone(),
							description: String::new(),
							version: if plugin.version.is_empty() {
								None
							} else {
								Some(plugin.version.clone())
							},
							author: None,
							category: None,
							source: PluginSource::LocalRelative {
								path: plugin
									.install_path
									.to_string_lossy()
									.to_string(),
							},
							marketplace,
							local_path: Some(plugin.install_path.clone()),
							installed: true,
							enabled: Some(plugin.enabled),
							install_count,
							homepage: None,
							repository: None,
							keywords: Vec::new(),
							git_sha: if plugin.commit_hash.is_empty() {
								None
							} else {
								Some(plugin.commit_hash.clone())
							},
							has_mcp: plugin.has_mcp(),
							has_skills: plugin.has_skills(),
							has_hooks: plugin.has_hooks(),
						};

						self.plugins.insert(plugin_id, plugin_info);
					}
				}
			}
			Err(error) => {
				log::warn!("Failed to load installed plugins: {}", error);
			}
		}

		Ok(())
	}
}
