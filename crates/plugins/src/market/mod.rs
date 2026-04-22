//! Plugin market management
//!
//! Provides listing and search functionality for available plugins
//! using local marketplace clones (like Claude CLI), avoiding GitHub API
//! rate limits.

pub mod cache;

mod registry;
mod service;
mod types;

pub use self::registry::MarketplaceRegistry;
pub use self::service::PluginMarket;
pub use self::types::{MarketPlugin, PluginManifestFromFile};

/// Default marketplace name
pub const DEFAULT_MARKETPLACE: &str = "claude-plugins-official";
