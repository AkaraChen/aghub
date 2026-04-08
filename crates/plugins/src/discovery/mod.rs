//! Unified Plugin Discovery System
//!
//! Provides a unified view of plugins from multiple sources:
//! - L1: Local installed plugins (plugins/ + external_plugins/)
//! - L2: Marketplace definitions (marketplace.json)
//! - L3: Remote install statistics (install-counts-cache.json)

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

mod marketplace;
mod registry;

pub use marketplace::{
	MarketplaceConfig, MarketplacePlugin, MarketplaceScanner,
	MarketplaceSource, SourceDef,
};
pub use registry::UnifiedPluginRegistry;

/// Plugin author information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginAuthor {
	pub name: String,
	pub email: Option<String>,
}

/// Plugin source types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PluginSource {
	/// Local relative path like "./plugins/xxx"
	#[serde(rename = "local")]
	LocalRelative { path: String },
	/// GitHub repository
	#[serde(rename = "github")]
	GitHub {
		repo: String,
		#[serde(rename = "ref")]
		git_ref: Option<String>,
		sha: Option<String>,
	},
	/// Generic Git URL
	#[serde(rename = "git")]
	GitUrl {
		url: String,
		#[serde(rename = "ref")]
		git_ref: Option<String>,
		sha: Option<String>,
	},
	/// Git subdirectory
	#[serde(rename = "git-subdir")]
	GitSubdir {
		url: String,
		path: String,
		#[serde(rename = "ref")]
		git_ref: Option<String>,
		sha: Option<String>,
	},
	/// NPM package
	#[serde(rename = "npm")]
	Npm {
		package: String,
		version: Option<String>,
		registry: Option<String>,
	},
}

impl PluginSource {
	/// Parse from marketplace.json source definition
	pub fn from_marketplace_def(def: &SourceDef) -> Self {
		match def {
			SourceDef::Local(path) => {
				PluginSource::LocalRelative { path: path.clone() }
			}
			SourceDef::GitHub { repo, sha, .. } => PluginSource::GitHub {
				repo: repo.clone(),
				git_ref: None,
				sha: sha.clone(),
			},
			SourceDef::Url { url, sha, .. } => PluginSource::GitUrl {
				url: url.clone(),
				git_ref: None,
				sha: sha.clone(),
			},
			SourceDef::GitSubdir { url, path, sha, .. } => {
				PluginSource::GitSubdir {
					url: url.clone(),
					path: path.clone(),
					git_ref: None,
					sha: sha.clone(),
				}
			}
			SourceDef::Npm {
				package,
				version,
				registry,
			} => PluginSource::Npm {
				package: package.clone(),
				version: version.clone(),
				registry: registry.clone(),
			},
		}
	}

	/// Get display name for the source
	pub fn display_name(&self) -> String {
		match self {
			PluginSource::LocalRelative { path } => format!("local:{}", path),
			PluginSource::GitHub { repo, .. } => format!("github:{}", repo),
			PluginSource::GitUrl { url, .. } => format!("git:{}", url),
			PluginSource::GitSubdir { url, path, .. } => {
				format!("git-subdir:{}/{}", url, path)
			}
			PluginSource::Npm { package, .. } => format!("npm:{}", package),
		}
	}
}

/// Unified plugin information combining all sources
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
	/// Unique plugin ID: "name@marketplace"
	pub id: String,
	/// Plugin name
	pub name: String,
	/// Plugin description
	pub description: String,
	/// Version from plugin.json or marketplace
	pub version: Option<String>,
	/// Author information
	pub author: Option<PluginAuthor>,
	/// Category (development, productivity, etc.)
	pub category: Option<String>,
	/// Plugin source
	pub source: PluginSource,
	/// Source marketplace name
	pub marketplace: String,
	/// Local installation path if installed
	pub local_path: Option<PathBuf>,
	/// Whether plugin is currently installed
	pub installed: bool,
	/// Whether plugin is enabled (if installed)
	pub enabled: Option<bool>,
	/// Install count from remote stats
	pub install_count: Option<u64>,
	/// Homepage URL
	pub homepage: Option<String>,
	/// Repository URL
	pub repository: Option<String>,
	/// Keywords/tags
	pub keywords: Vec<String>,
	/// Git commit SHA if available
	pub git_sha: Option<String>,
	/// Does the plugin provide MCP servers?
	pub has_mcp: bool,
	/// Does the plugin provide skills?
	pub has_skills: bool,
	/// Does the plugin provide hooks?
	pub has_hooks: bool,
}

impl PluginInfo {
	/// Get the effective version string for display
	pub fn display_version(&self) -> String {
		self.version
			.clone()
			.or_else(|| {
				self.git_sha
					.as_ref()
					.map(|s| s[..8.min(s.len())].to_string())
			})
			.unwrap_or_else(|| "latest".to_string())
	}

	/// Get the effective author string for display
	pub fn display_author(&self) -> Option<String> {
		if let Some(author) = self.author.as_ref().map(|a| a.name.trim()) {
			if !author.is_empty() {
				return Some(author.to_string());
			}
		}

		let source_author = match &self.source {
			PluginSource::GitHub { repo, .. } => extract_github_owner(repo),
			PluginSource::GitUrl { url, .. }
			| PluginSource::GitSubdir { url, .. } => extract_github_owner(url),
			PluginSource::Npm { package, .. } => package
				.strip_prefix('@')
				.and_then(|value| value.split('/').next())
				.filter(|scope| !scope.is_empty())
				.map(str::to_string),
			PluginSource::LocalRelative { .. } => None,
		};

		source_author
			.or_else(|| self.homepage.as_deref().and_then(extract_github_owner))
	}

	/// Get GitHub URL for the plugin
	pub fn github_url(&self) -> Option<String> {
		match &self.source {
			PluginSource::GitHub { repo, .. } => {
				Some(format!("https://github.com/{}", repo))
			}
			PluginSource::GitUrl { url, .. }
			| PluginSource::GitSubdir { url, .. } => {
				normalize_github_url(url).or_else(|| Some(url.clone()))
			}
			PluginSource::LocalRelative { path } => {
				if let Some(homepage) = self.homepage.as_deref() {
					if homepage.contains("github.com") {
						return Some(
							homepage
								.trim_end_matches('/')
								.trim_end_matches(".git")
								.to_string(),
						);
					}
				}

				// For local plugins in official marketplace
				if self.marketplace == "claude-plugins-official" {
					Some(format!(
                        "https://github.com/anthropics/claude-plugins-official/tree/main/{}",
                        path.trim_start_matches("./")
                    ))
				} else {
					None
				}
			}
			_ => None,
		}
	}
}

fn extract_github_owner(reference: &str) -> Option<String> {
	let repo = github_repo_path(reference)?;
	repo.split('/')
		.next()
		.filter(|owner| !owner.is_empty())
		.map(str::to_string)
}

fn normalize_github_url(reference: &str) -> Option<String> {
	let repo = github_repo_path(reference)?;
	Some(format!("https://github.com/{repo}"))
}

fn github_repo_path(reference: &str) -> Option<String> {
	let trimmed = reference.trim_end_matches('/').trim_end_matches(".git");
	let path = if let Some(path) = trimmed.strip_prefix("https://github.com/") {
		path
	} else if let Some(path) = trimmed.strip_prefix("http://github.com/") {
		path
	} else if let Some(path) = trimmed.strip_prefix("git@github.com:") {
		path
	} else if trimmed.contains('/') && !trimmed.contains("://") {
		trimmed
	} else {
		return None;
	};

	let mut segments = path.split('/');
	let owner = segments.next()?;
	let repo = segments.next()?;
	if owner.is_empty() || repo.is_empty() {
		return None;
	}

	Some(format!("{owner}/{repo}"))
}

/// Install count entry from install-counts-cache.json
#[derive(Debug, Deserialize)]
pub struct InstallCountEntry {
	pub plugin: String,
	pub unique_installs: u64,
}

/// Install counts cache structure
#[derive(Debug, Deserialize)]
pub struct InstallCountsCache {
	pub version: u32,
	pub fetched_at: Option<chrono::DateTime<chrono::Utc>>,
	pub counts: Vec<InstallCountEntry>,
}

/// Discovery configuration
#[derive(Debug, Clone)]
pub struct DiscoveryConfig {
	/// Base directory for Claude plugins (e.g., ~/.claude/plugins)
	pub plugins_dir: PathBuf,
	/// Marketplaces subdirectory name
	pub marketplaces_subdir: String,
	/// Known marketplace names to scan
	pub known_marketplaces: Vec<String>,
}

impl Default for DiscoveryConfig {
	fn default() -> Self {
		let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
		Self {
			plugins_dir: home.join(".claude/plugins"),
			marketplaces_subdir: "marketplaces".to_string(),
			known_marketplaces: vec!["claude-plugins-official".to_string()],
		}
	}
}

impl DiscoveryConfig {
	/// Get path to install-counts-cache.json
	pub fn install_counts_path(&self) -> PathBuf {
		self.plugins_dir.join("install-counts-cache.json")
	}

	/// Get path to known_marketplaces.json
	pub fn known_marketplaces_path(&self) -> PathBuf {
		self.plugins_dir.join("known_marketplaces.json")
	}

	/// Get path to a marketplace directory
	pub fn marketplace_path(&self, name: &str) -> PathBuf {
		self.plugins_dir.join(&self.marketplaces_subdir).join(name)
	}

	/// Get path to installed_plugins.json
	pub fn installed_plugins_path(&self) -> PathBuf {
		self.plugins_dir.join("installed_plugins.json")
	}
}

/// Plugin discovery service
pub struct PluginDiscovery {
	config: DiscoveryConfig,
	registry: UnifiedPluginRegistry,
}

impl PluginDiscovery {
	/// Create a new discovery service with default config
	pub fn new() -> Result<Self> {
		Self::with_config(DiscoveryConfig::default())
	}

	/// Create with custom configuration
	pub fn with_config(config: DiscoveryConfig) -> Result<Self> {
		let registry = UnifiedPluginRegistry::new(&config)?;
		Ok(Self { config, registry })
	}

	/// Refresh the registry by re-scanning all sources
	pub async fn refresh(&mut self) -> Result<()> {
		self.registry = UnifiedPluginRegistry::new(&self.config)?;
		Ok(())
	}

	/// Get all discovered plugins
	pub fn all_plugins(&self) -> Vec<&PluginInfo> {
		self.registry.all_plugins()
	}

	/// Get a specific plugin by ID
	pub fn get_plugin(&self, id: &str) -> Option<&PluginInfo> {
		self.registry.get_plugin(id)
	}

	/// Search plugins by name or description
	pub fn search(&self, query: &str) -> Vec<&PluginInfo> {
		let query = query.to_lowercase();
		self.registry
			.all_plugins()
			.into_iter()
			.filter(|p| {
				p.name.to_lowercase().contains(&query)
					|| p.description.to_lowercase().contains(&query)
					|| p.keywords
						.iter()
						.any(|k| k.to_lowercase().contains(&query))
			})
			.collect()
	}

	/// Get plugins by category
	pub fn by_category(&self, category: &str) -> Vec<&PluginInfo> {
		self.registry
			.all_plugins()
			.into_iter()
			.filter(|p| {
				p.category.as_ref().map(|c| c == category).unwrap_or(false)
			})
			.collect()
	}

	/// Get installed plugins
	pub fn installed_plugins(&self) -> Vec<&PluginInfo> {
		self.registry
			.all_plugins()
			.into_iter()
			.filter(|p| p.installed)
			.collect()
	}

	/// Get plugins from a specific marketplace
	pub fn marketplace_plugins(&self, marketplace: &str) -> Vec<&PluginInfo> {
		self.registry
			.all_plugins()
			.into_iter()
			.filter(|p| p.marketplace == marketplace)
			.collect()
	}

	/// Get the underlying registry
	pub fn registry(&self) -> &UnifiedPluginRegistry {
		&self.registry
	}

	/// Get mutable registry
	pub fn registry_mut(&mut self) -> &mut UnifiedPluginRegistry {
		&mut self.registry
	}
}

impl Default for PluginDiscovery {
	fn default() -> Self {
		Self::new().expect("Failed to create PluginDiscovery")
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn display_author_prefers_manifest_author() {
		let plugin = PluginInfo {
			id: "frontend-design@claude-plugins-official".to_string(),
			name: "frontend-design".to_string(),
			description: String::new(),
			version: None,
			author: Some(PluginAuthor {
				name: "Anthropic".to_string(),
				email: None,
			}),
			category: None,
			source: PluginSource::GitHub {
				repo: "obra/superpowers".to_string(),
				git_ref: None,
				sha: None,
			},
			marketplace: "claude-plugins-official".to_string(),
			local_path: None,
			installed: false,
			enabled: None,
			install_count: None,
			homepage: None,
			repository: None,
			keywords: Vec::new(),
			git_sha: None,
			has_mcp: false,
			has_skills: false,
			has_hooks: false,
		};

		assert_eq!(plugin.display_author().as_deref(), Some("Anthropic"));
	}

	#[test]
	fn display_author_falls_back_to_github_owner() {
		let plugin = PluginInfo {
			id: "superpowers@claude-plugins-official".to_string(),
			name: "superpowers".to_string(),
			description: String::new(),
			version: None,
			author: None,
			category: None,
			source: PluginSource::GitUrl {
				url: "https://github.com/obra/superpowers.git".to_string(),
				git_ref: None,
				sha: None,
			},
			marketplace: "claude-plugins-official".to_string(),
			local_path: None,
			installed: false,
			enabled: None,
			install_count: None,
			homepage: None,
			repository: None,
			keywords: Vec::new(),
			git_sha: None,
			has_mcp: false,
			has_skills: false,
			has_hooks: false,
		};

		assert_eq!(plugin.display_author().as_deref(), Some("obra"));
	}

	#[test]
	fn display_author_and_url_support_repo_shorthand() {
		let plugin = PluginInfo {
			id: "ui5@claude-plugins-official".to_string(),
			name: "ui5".to_string(),
			description: String::new(),
			version: None,
			author: None,
			category: None,
			source: PluginSource::GitSubdir {
				url: "UI5/plugins-claude".to_string(),
				path: "plugins/ui5".to_string(),
				git_ref: None,
				sha: None,
			},
			marketplace: "claude-plugins-official".to_string(),
			local_path: None,
			installed: false,
			enabled: None,
			install_count: None,
			homepage: None,
			repository: None,
			keywords: Vec::new(),
			git_sha: None,
			has_mcp: false,
			has_skills: false,
			has_hooks: false,
		};

		assert_eq!(plugin.display_author().as_deref(), Some("UI5"));
		assert_eq!(
			plugin.github_url().as_deref(),
			Some("https://github.com/UI5/plugins-claude")
		);
	}

	#[test]
	fn display_author_and_url_fall_back_to_homepage_for_local_sources() {
		let plugin = PluginInfo {
			id: "autofix-bot@claude-plugins-official".to_string(),
			name: "autofix-bot".to_string(),
			description: String::new(),
			version: None,
			author: None,
			category: None,
			source: PluginSource::LocalRelative {
				path: "./external_plugins/autofix-bot".to_string(),
			},
			marketplace: "claude-plugins-official".to_string(),
			local_path: None,
			installed: false,
			enabled: None,
			install_count: None,
			homepage: Some(
				"https://github.com/anthropics/claude-plugins-public/tree/main/external_plugins/autofix-bot"
					.to_string(),
			),
			repository: None,
			keywords: Vec::new(),
			git_sha: None,
			has_mcp: false,
			has_skills: false,
			has_hooks: false,
		};

		assert_eq!(plugin.display_author().as_deref(), Some("anthropics"));
		assert_eq!(
			plugin.github_url().as_deref(),
			Some(
				"https://github.com/anthropics/claude-plugins-public/tree/main/external_plugins/autofix-bot"
			)
		);
	}
}
