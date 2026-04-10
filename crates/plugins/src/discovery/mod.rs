//! Unified Plugin Discovery System
//!
//! Provides a unified view of plugins from multiple sources:
//! - L1: Local installed plugins (plugins/ + external_plugins/)
//! - L2: Marketplace definitions (marketplace.json)
//! - L3: Remote install statistics (install-counts-cache.json)

mod config;
mod marketplace;
mod registry;
mod service;
mod types;

pub use config::DiscoveryConfig;
pub use marketplace::{
	MarketplaceConfig, MarketplacePlugin, MarketplaceScanner,
	MarketplaceSource, SourceDef,
};
pub use registry::UnifiedPluginRegistry;
pub use service::PluginDiscovery;
pub use types::{
	InstallCountEntry, InstallCountsCache, PluginAuthor, PluginInfo,
	PluginSource,
};
