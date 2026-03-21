//! # aghub-core
//!
//! Core library for managing Code Agent configurations.

pub mod adapter;
pub mod adapters;
pub mod agents;
pub mod errors;
pub mod format;
pub mod manager;
pub mod models;
pub mod paths;
pub mod registry;
pub mod skills;

#[cfg(feature = "testing")]
pub mod testing;

pub use adapters::{create_adapter, AgentAdapter};
pub use errors::{ConfigError, Result};
pub use manager::ConfigManager;
pub use models::AgentType;

/// Convert a skill::Skill to core::models::Skill
pub fn convert_skill(skill_pkg: skill::Skill) -> models::Skill {
	models::Skill {
		name: skill_pkg.name,
		enabled: true,
		description: Some(skill_pkg.description),
		author: skill_pkg.metadata.get("author").cloned(),
		version: skill_pkg.metadata.get("version").cloned(),
		tools: skill_pkg
			.allowed_tools
			.map(|t| t.split(',').map(|s| s.trim().to_string()).collect())
			.unwrap_or_default(),
		metadata: None,
	}
}

#[cfg(feature = "testing")]
pub use testing::{TestConfig, TestConfigBuilder};
