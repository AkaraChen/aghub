use super::marketplace::{
	is_marketplace_source, load_marketplace_repository_urls,
	marketplace_path_for,
};
use super::{registry, PluginInstaller};
use crate::cli::ClaudeCli;
use crate::PluginId;
use anyhow::{Context, Result};

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
		let cli = ClaudeCli::new()?;
		cli.marketplace_update(None).await?;
		let entries = cli.marketplace_list().await?;
		Ok(entries.into_iter().map(|entry| entry.name).collect())
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
		// Reinstall is uninstall+install. Both delegate to the CLI which only
		// knows how to install via a marketplace, so non-marketplace plugins
		// can't be reinstalled either.
		is_marketplace_source(&self.marketplace_root, &id.source)
	}

	pub fn can_check_updates(&self, id: &PluginId) -> bool {
		// check_update_against only consults marketplace catalogs; anything
		// else returns Ok(None) and would mislead the UI into showing an
		// "update available" affordance that never resolves.
		is_marketplace_source(&self.marketplace_root, &id.source)
	}
}
