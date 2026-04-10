use anyhow::Result;

use super::{DiscoveryConfig, PluginInfo, UnifiedPluginRegistry};

pub struct PluginDiscovery {
	config: DiscoveryConfig,
	registry: UnifiedPluginRegistry,
}

impl PluginDiscovery {
	pub async fn new() -> Result<Self> {
		Self::with_config(DiscoveryConfig::default()).await
	}

	pub async fn with_config(config: DiscoveryConfig) -> Result<Self> {
		let registry = UnifiedPluginRegistry::new_async(&config).await?;
		Ok(Self { config, registry })
	}

	pub async fn refresh(&mut self) -> Result<()> {
		self.registry = UnifiedPluginRegistry::new_async(&self.config).await?;
		Ok(())
	}

	pub fn all_plugins(&self) -> Vec<&PluginInfo> {
		self.registry.all_plugins()
	}

	pub fn get_plugin(&self, id: &str) -> Option<&PluginInfo> {
		self.registry.get_plugin(id)
	}

	pub fn search(&self, query: &str) -> Vec<&PluginInfo> {
		let query = query.to_lowercase();
		self.registry
			.all_plugins()
			.into_iter()
			.filter(|plugin| {
				plugin.name.to_lowercase().contains(&query)
					|| plugin.description.to_lowercase().contains(&query)
					|| plugin
						.keywords
						.iter()
						.any(|keyword| keyword.to_lowercase().contains(&query))
			})
			.collect()
	}

	pub fn by_category(&self, category: &str) -> Vec<&PluginInfo> {
		self.registry
			.all_plugins()
			.into_iter()
			.filter(|plugin| {
				plugin
					.category
					.as_ref()
					.map(|value| value == category)
					.unwrap_or(false)
			})
			.collect()
	}

	pub fn installed_plugins(&self) -> Vec<&PluginInfo> {
		self.registry
			.all_plugins()
			.into_iter()
			.filter(|plugin| plugin.installed)
			.collect()
	}

	pub fn marketplace_plugins(&self, marketplace: &str) -> Vec<&PluginInfo> {
		self.registry
			.all_plugins()
			.into_iter()
			.filter(|plugin| plugin.marketplace == marketplace)
			.collect()
	}

	pub fn registry(&self) -> &UnifiedPluginRegistry {
		&self.registry
	}

	pub fn registry_mut(&mut self) -> &mut UnifiedPluginRegistry {
		&mut self.registry
	}
}
