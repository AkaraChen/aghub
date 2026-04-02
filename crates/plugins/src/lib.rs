//! Aghub Plugin System
//!
//! Provides support for managing AI agent plugins, including:
//! - Claude Code Plugin System (v2)
//! - Plugin discovery, enable/disable, and skill filtering

pub mod claude;

use std::fmt::Display;
use std::path::PathBuf;

/// Generic plugin trait for all agent plugin systems
pub trait PluginSystem: Send + Sync {
	type PluginId: Clone + Display;

	/// List all installed plugins
	fn list_installed(&self) -> anyhow::Result<Vec<Plugin>>;

	/// Check if a plugin is enabled
	fn is_enabled(&self, id: &Self::PluginId) -> bool;

	/// Enable a plugin
	fn enable(&mut self, id: &Self::PluginId) -> anyhow::Result<()>;

	/// Disable a plugin
	fn disable(&mut self, id: &Self::PluginId) -> anyhow::Result<()>;

	/// Filter skill paths based on plugin enabled status
	fn filter_skills(&self, paths: Vec<PathBuf>) -> Vec<PathBuf>;
}

/// Generic plugin metadata
#[derive(Debug, Clone)]
pub struct Plugin {
	pub id: String,
	pub name: String,
	pub version: String,
	pub enabled: bool,
	pub source: PluginSource,
}

/// Plugin source location
#[derive(Debug, Clone)]
pub enum PluginSource {
	OfficialRegistry,
	ThirdParty { url: String },
	Local { path: PathBuf },
}

impl Display for PluginSource {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		match self {
			PluginSource::OfficialRegistry => {
				write!(f, "claude-plugins-official")
			}
			PluginSource::ThirdParty { url } => write!(f, "{}", url),
			PluginSource::Local { path } => write!(f, "{}", path.display()),
		}
	}
}

impl PluginSource {
	pub fn parse(s: &str) -> anyhow::Result<Self> {
		match s {
			"claude-plugins-official" => Ok(Self::OfficialRegistry),
			url if url.starts_with("http") => Ok(Self::ThirdParty {
				url: url.to_string(),
			}),
			path => Ok(Self::Local {
				path: PathBuf::from(path),
			}),
		}
	}
}

/// Plugin ID in format "name@source"
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PluginId {
	pub name: String,
	pub source: String,
}

impl PluginId {
	pub fn parse(s: &str) -> anyhow::Result<Self> {
		let parts: Vec<_> = s.split('@').collect();
		if parts.len() != 2 {
			anyhow::bail!(
				"Invalid plugin ID format. Expected 'name@source', got: {}",
				s
			);
		}
		Ok(Self {
			name: parts[0].to_string(),
			source: parts[1].to_string(),
		})
	}
}

impl Display for PluginId {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		write!(f, "{}@{}", self.name, self.source)
	}
}
