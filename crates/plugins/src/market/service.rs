use super::cache::{CachedPlugin, MarketCache};
use super::registry::MarketplaceRegistry;
use super::types::MarketPlugin;
use super::DEFAULT_MARKETPLACE;
use crate::claude::ClaudePluginManager;
use anyhow::Result;

/// Plugin market manager
pub struct PluginMarket {
	/// Cache for market listings
	cache: MarketCache,
	/// Marketplace registry for reading local clone
	registry: MarketplaceRegistry,
}

impl PluginMarket {
	/// Create a new market manager
	pub fn new() -> Result<Self> {
		let cache = MarketCache::load()?;
		let registry = MarketplaceRegistry::new_official()?;

		Ok(Self { cache, registry })
	}

	/// List available plugins (with caching)
	pub async fn list_plugins(
		&mut self,
		mut force_refresh: bool,
	) -> Result<Vec<MarketPlugin>> {
		if !self.registry.is_available() {
			log::info!("Marketplace not found, cloning...");
			self.registry.clone().await?;
			force_refresh = true;
		}

		if !force_refresh
			&& self.cache.is_valid()
			&& !self.cache.list().is_empty()
		{
			log::info!("Using cached plugin market data");
			return self.build_market_list().await;
		}

		log::info!("Refreshing plugin list from local marketplace");
		self.registry.update().await?;
		self.refresh_from_marketplace().await?;

		self.build_market_list().await
	}

	/// Force refresh the cache
	pub async fn refresh(&mut self) -> Result<Vec<MarketPlugin>> {
		self.list_plugins(true).await
	}

	/// Refresh cache from local marketplace
	async fn refresh_from_marketplace(&mut self) -> Result<()> {
		let plugins = self.registry.list_plugins()?;

		log::info!("Found {} plugins in local marketplace", plugins.len());

		self.cache.clear();

		let commit = self.registry.get_commit().ok().flatten();

		for (name, path) in plugins {
			match self.registry.read_manifest(&name) {
				Ok(Some(manifest)) => {
					let plugins_subdir = if path.components().any(|component| {
						component.as_os_str() == "external_plugins"
					}) {
						"external_plugins"
					} else {
						"plugins"
					};
					let github_url = format!(
						"https://github.com/anthropics/claude-plugins-official/tree/main/{}/{}",
						plugins_subdir,
						name
					);

					let cached = CachedPlugin {
						id: format!("{}@{}", name, DEFAULT_MARKETPLACE),
						name: manifest.name,
						description: manifest.description,
						version: manifest
							.version
							.unwrap_or_else(|| "latest".to_string()),
						author: if manifest.author.is_empty() {
							"Unknown".to_string()
						} else {
							manifest.author.name
						},
						github_url: manifest.repository.unwrap_or(github_url),
						installs: 0,
						last_commit: commit.clone(),
						last_commit_date: None,
						etag: None,
					};

					self.cache.insert(cached);
				}
				Ok(None) => {
					log::warn!("No manifest found for plugin: {}", name);
				}
				Err(e) => {
					log::warn!("Failed to read manifest for {}: {}", name, e);
				}
			}
		}

		self.cache.touch();
		self.cache.save()?;

		log::info!(
			"Marketplace cache refreshed with {} plugins",
			self.cache.list().len()
		);
		Ok(())
	}

	/// Build market plugin list with install status
	async fn build_market_list(&self) -> Result<Vec<MarketPlugin>> {
		let installed_plugins = ClaudePluginManager::new()
			.ok()
			.map(|m| {
				m.list_plugins()
					.iter()
					.map(|p| (p.id.to_string(), p.enabled))
					.collect::<std::collections::HashMap<_, _>>()
			})
			.unwrap_or_default();

		let mut plugins: Vec<MarketPlugin> = self
			.cache
			.list()
			.into_iter()
			.map(|cached| {
				let installed = installed_plugins.contains_key(&cached.id);
				let enabled = installed_plugins.get(&cached.id).copied();

				MarketPlugin {
					id: cached.id.clone(),
					name: cached.name.clone(),
					description: cached.description.clone(),
					version: cached.version.clone(),
					author: cached.author.clone(),
					github_url: cached.github_url.clone(),
					installs: cached.installs,
					installed,
					enabled,
				}
			})
			.collect();

		plugins.sort_by(|a, b| a.name.cmp(&b.name));

		Ok(plugins)
	}

	/// Set cache TTL
	pub fn set_cache_ttl(&mut self, seconds: u64) {
		self.cache.set_ttl(seconds);
	}

	/// Clear cache
	pub fn clear_cache(&mut self) -> Result<()> {
		self.cache.clear();
		self.cache.save()?;
		Ok(())
	}

	/// Get the marketplace registry (for advanced operations)
	pub fn registry(&self) -> &MarketplaceRegistry {
		&self.registry
	}
}
