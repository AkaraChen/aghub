use super::marketplace::{
	is_marketplace_source, load_marketplace_repository_urls,
};
use super::PluginInstaller;
use crate::cli::ClaudeCli;
use crate::PluginId;
use anyhow::Result;

impl PluginInstaller {
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
}
