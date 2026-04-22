//! Marketplace scanner for reading marketplace.json definitions

mod scanner;
mod types;

pub use self::scanner::{scan_marketplaces, MarketplaceScanner};
pub use self::types::{
	MarketplaceConfig, MarketplacePlugin, MarketplaceSource, SourceDef,
};
