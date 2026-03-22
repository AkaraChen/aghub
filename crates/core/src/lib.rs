//! # aghub-core
//!
//! Core library for managing Code Agent configurations.

pub mod adapter;
pub mod all_agents;
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
pub use all_agents::{load_all_agents, AgentResources};
pub use errors::{ConfigError, Result};
pub use manager::ConfigManager;
pub use models::{AgentType, ConfigSource};

/// Convert a skill::Skill to core::models::Skill
pub fn convert_skill(skill_pkg: skill::Skill) -> models::Skill {
	use skill::SkillSource;

	let source_path = match &skill_pkg.source {
		SkillSource::SkillMd(p) if !p.as_os_str().is_empty() => format_path_with_tilde(p),
		SkillSource::Directory(p) if !p.as_os_str().is_empty() => {
			format_path_with_tilde(&p.join("SKILL.md"))
		}
		SkillSource::SkillFile(p) | SkillSource::ZipFile(p) if !p.as_os_str().is_empty() => {
			format_path_with_tilde(p)
		}
		_ => None,
	};

	models::Skill {
		name: skill_pkg.name,
		enabled: true,
		description: Some(skill_pkg.description),
		author: None,
		version: None,
		tools: skill_pkg
			.allowed_tools
			.map(|t| t.split(',').map(|s| s.trim().to_string()).collect())
			.unwrap_or_default(),
		source_path,
	}
}

/// Format a skill path with ~ prefix for home directory
fn format_path_with_tilde(path: &std::path::Path) -> Option<String> {
	let home = dirs::home_dir()?;
	if path.starts_with(&home) {
		let relative = path.strip_prefix(&home).ok()?;
		Some(format!("~/{}", relative.to_string_lossy()))
	} else {
		Some(path.to_string_lossy().to_string())
	}
}

#[cfg(feature = "testing")]
pub use testing::{TestConfig, TestConfigBuilder};
