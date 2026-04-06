//! Plugin market index caching
//!
//! Provides local caching for plugin market listings to reduce GitHub API calls
//! and avoid rate limiting (502 errors).

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

/// Cached market index entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedPlugin {
	pub id: String,
	pub name: String,
	pub description: String,
	pub version: String,
	pub author: String,
	pub github_url: String,
	pub installs: u64,
	/// Last commit SHA for update checking
	pub last_commit: Option<String>,
	/// Last commit date
	pub last_commit_date: Option<String>,
	/// ETag from GitHub API response
	pub etag: Option<String>,
}

/// Market cache structure
#[derive(Debug, Serialize, Deserialize)]
pub struct MarketCache {
	/// Cache version for migration
	pub version: u32,
	/// When the cache was last updated
	pub last_updated: SystemTime,
	/// TTL for cache entries (seconds)
	pub ttl_seconds: u64,
	/// Cached plugins indexed by ID
	pub plugins: HashMap<String, CachedPlugin>,
}

impl Default for MarketCache {
	fn default() -> Self {
		Self {
			version: 1,
			last_updated: SystemTime::UNIX_EPOCH,
			ttl_seconds: 24 * 60 * 60, // 24 hours default
			plugins: HashMap::new(),
		}
	}
}

impl MarketCache {
	/// Cache file path
	fn cache_path() -> Result<PathBuf> {
		Ok(dirs::cache_dir()
			.or_else(|| dirs::home_dir().map(|h| h.join(".cache")))
			.ok_or_else(|| anyhow::anyhow!("Cannot find cache directory"))?
			.join("aghub/plugin-market.json"))
	}

	/// Load cache from disk
	pub fn load() -> Result<Self> {
		let path = Self::cache_path()?;

		if !path.exists() {
			return Ok(Self::default());
		}

		let content = std::fs::read_to_string(&path).with_context(|| {
			format!("Failed to read cache from {}", path.display())
		})?;

		let cache: MarketCache = serde_json::from_str(&content)
			.with_context(|| "Failed to parse market cache")?;

		Ok(cache)
	}

	/// Save cache to disk
	pub fn save(&self) -> Result<()> {
		let path = Self::cache_path()?;

		// Ensure parent directory exists
		if let Some(parent) = path.parent() {
			std::fs::create_dir_all(parent)?;
		}

		let content = serde_json::to_string_pretty(self)?;
		std::fs::write(&path, content).with_context(|| {
			format!("Failed to write cache to {}", path.display())
		})?;

		Ok(())
	}

	/// Check if cache is valid (not expired)
	pub fn is_valid(&self) -> bool {
		let now = SystemTime::now();
		let ttl = Duration::from_secs(self.ttl_seconds);

		match now.duration_since(self.last_updated) {
			Ok(elapsed) => elapsed < ttl,
			Err(_) => false, // System time went backwards
		}
	}

	/// Get a cached plugin by ID
	pub fn get(&self, id: &str) -> Option<&CachedPlugin> {
		self.plugins.get(id)
	}

	/// Insert or update a cached plugin
	pub fn insert(&mut self, plugin: CachedPlugin) {
		self.plugins.insert(plugin.id.clone(), plugin);
	}

	/// Remove a plugin from cache
	pub fn remove(&mut self, id: &str) {
		self.plugins.remove(id);
	}

	/// Mark cache as updated
	pub fn touch(&mut self) {
		self.last_updated = SystemTime::now();
	}

	/// Clear expired entries (if we had TTL per entry)
	pub fn clear(&mut self) {
		self.plugins.clear();
		self.last_updated = SystemTime::UNIX_EPOCH;
	}

	/// Get all cached plugins as a list
	pub fn list(&self) -> Vec<&CachedPlugin> {
		self.plugins.values().collect()
	}

	/// Set TTL
	pub fn set_ttl(&mut self, seconds: u64) {
		self.ttl_seconds = seconds;
	}
}

/// ETag cache for conditional requests
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct ETagCache {
	/// URL -> ETag mapping
	pub tags: HashMap<String, String>,
}

impl ETagCache {
	/// Cache file path
	fn cache_path() -> Result<PathBuf> {
		Ok(dirs::cache_dir()
			.or_else(|| dirs::home_dir().map(|h| h.join(".cache")))
			.ok_or_else(|| anyhow::anyhow!("Cannot find cache directory"))?
			.join("aghub/etags.json"))
	}

	/// Load ETag cache
	pub fn load() -> Result<Self> {
		let path = Self::cache_path()?;

		if !path.exists() {
			return Ok(Self::default());
		}

		let content = std::fs::read_to_string(&path)?;
		let cache: ETagCache = serde_json::from_str(&content)?;

		Ok(cache)
	}

	/// Save ETag cache
	pub fn save(&self) -> Result<()> {
		let path = Self::cache_path()?;

		if let Some(parent) = path.parent() {
			std::fs::create_dir_all(parent)?;
		}

		let content = serde_json::to_string_pretty(self)?;
		std::fs::write(&path, content)?;

		Ok(())
	}

	/// Get ETag for URL
	pub fn get(&self, url: &str) -> Option<&str> {
		self.tags.get(url).map(|s| s.as_str())
	}

	/// Set ETag for URL
	pub fn set(&mut self, url: String, etag: String) {
		self.tags.insert(url, etag);
	}

	/// Remove ETag for URL
	pub fn remove(&mut self, url: &str) {
		self.tags.remove(url);
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_cache_validity() {
		let mut cache = MarketCache::default();
		assert!(!cache.is_valid()); // Never updated

		cache.touch();
		assert!(cache.is_valid()); // Just updated

		cache.ttl_seconds = 0;
		assert!(!cache.is_valid()); // TTL expired immediately
	}

	#[test]
	fn test_cache_operations() {
		let mut cache = MarketCache::default();

		let plugin = CachedPlugin {
			id: "test@claude-plugins-official".to_string(),
			name: "Test Plugin".to_string(),
			description: "A test plugin".to_string(),
			version: "1.0.0".to_string(),
			author: "Test Author".to_string(),
			github_url: "https://github.com/test/plugin".to_string(),
			installs: 100,
			last_commit: Some("abc123".to_string()),
			last_commit_date: Some("2024-01-01".to_string()),
			etag: Some("W/\"abc\"".to_string()),
		};

		cache.insert(plugin.clone());
		assert!(cache.get(&plugin.id).is_some());

		let plugins = cache.list();
		assert_eq!(plugins.len(), 1);

		cache.remove(&plugin.id);
		assert!(cache.get(&plugin.id).is_none());
	}
}
