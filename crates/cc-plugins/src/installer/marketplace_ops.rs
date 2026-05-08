use super::marketplace::{
	is_marketplace_source, load_marketplace_repository_urls,
	marketplace_path_for,
};
use super::source::{classify_registry_source, RegistrySource};
use super::{registry, PluginInstaller};
use crate::PluginId;
use anyhow::{Context, Result};
use std::collections::BTreeSet;

impl PluginInstaller {
	pub(super) fn marketplace_registry(
		&self,
		marketplace: &str,
	) -> Result<registry::MarketplaceRegistry> {
		if marketplace == "claude-plugins-official" {
			return registry::MarketplaceRegistry::new_official().context(
				"Official marketplace not found. Please clone it first: git clone https://github.com/anthropics/claude-plugins-official ~/.claude/plugins/marketplaces/claude-plugins-official",
			);
		}

		let marketplace_path =
			marketplace_path_for(&self.marketplace_root, marketplace);
		let marketplace_json =
			marketplace_path.join(".claude-plugin/marketplace.json");
		if !marketplace_json.exists() {
			anyhow::bail!("Marketplace '{}' not found", marketplace);
		}

		registry::MarketplaceRegistry::new(
			marketplace_path,
			vec!["plugins/".to_string(), "external_plugins/".to_string()],
		)
	}

	pub async fn update_marketplaces(&self) -> Result<Vec<String>> {
		let mut updated = Vec::new();
		let mut failed = Vec::new();

		for marketplace in self.discover_marketplaces()? {
			match self.marketplace_registry(&marketplace) {
				Ok(registry) => match registry.update().await {
					Ok(()) => updated.push(marketplace),
					Err(error) => {
						failed.push(format!("{marketplace}: {error}"))
					}
				},
				Err(error) => failed.push(format!("{marketplace}: {error}")),
			}
		}

		if !failed.is_empty() {
			anyhow::bail!(
				"Failed to update marketplaces: {}",
				failed.join("; ")
			);
		}

		Ok(updated)
	}

	pub(super) fn discover_marketplaces(&self) -> Result<Vec<String>> {
		let marketplaces_dir = self
			.marketplace_root
			.parent()
			.unwrap_or(self.marketplace_root.as_path());
		let mut marketplaces = BTreeSet::new();

		if self.marketplace_root.is_dir() {
			marketplaces.insert("claude-plugins-official".to_string());
		}

		if marketplaces_dir.exists() {
			for entry in std::fs::read_dir(marketplaces_dir)? {
				let path = entry?.path();
				if !path.is_dir()
					|| !path.join(".claude-plugin/marketplace.json").exists()
				{
					continue;
				}
				if let Some(name) =
					path.file_name().and_then(|value| value.to_str())
				{
					marketplaces.insert(name.to_string());
				}
			}
		}

		Ok(marketplaces.into_iter().collect())
	}

	pub fn marketplace_repository_url(&self, id: &PluginId) -> Option<String> {
		if !is_marketplace_source(&self.marketplace_root, &id.source) {
			return None;
		}

		if let Some(url) = self
			.marketplace_urls
			.read()
			.inspect_err(|e| {
				log::error!("Marketplace URL cache lock poisoned: {e}")
			})
			.ok()?
			.get(&id.source)
			.and_then(|urls| urls.get(&id.name).cloned())
		{
			return Some(url);
		}

		let urls = load_marketplace_repository_urls(
			&self.marketplace_root,
			&id.source,
		);
		let url = urls.get(&id.name).cloned();
		self.marketplace_urls
			.write()
			.inspect_err(|e| {
				log::error!("Marketplace URL cache lock poisoned: {e}")
			})
			.ok()?
			.insert(id.source.clone(), urls);
		url
	}

	pub fn can_reinstall(&self, id: &PluginId) -> bool {
		if is_marketplace_source(&self.marketplace_root, &id.source) {
			return true;
		}

		match classify_registry_source(&id.source) {
			RegistrySource::OfficialRegistry => {
				self.marketplace_registry("claude-plugins-official").is_ok()
			}
			RegistrySource::GitHub { .. } => true,
			RegistrySource::Local { path } => path.exists(),
			RegistrySource::UnsupportedRemote { .. } => false,
		}
	}

	pub fn can_check_updates(&self, id: &PluginId) -> bool {
		if is_marketplace_source(&self.marketplace_root, &id.source) {
			return true;
		}

		match classify_registry_source(&id.source) {
			RegistrySource::OfficialRegistry => {
				self.marketplace_registry("claude-plugins-official").is_ok()
			}
			RegistrySource::GitHub { .. } => true,
			RegistrySource::Local { .. }
			| RegistrySource::UnsupportedRemote { .. } => false,
		}
	}
}
