//! # aghub-core
//!
//! Core library for managing Code Agent configurations.

pub mod adapter;
pub mod adapters;
pub mod all_agents;
pub mod availability;
pub mod manager;
pub mod paths;
pub mod registry;
pub mod skills;
pub mod transfer;

pub use aghub_agents::{descriptor, errors, format, models};
pub use aghub_agents::{
	AgentConfig, AgentDescriptor, AgentType, Capabilities, ConfigError,
	ConfigSource, McpServer, McpTransport, ParseFn, ResourceScope, Result,
	SerializeFn, Skill,
};

#[cfg(feature = "testing")]
pub mod testing;

pub use adapters::{create_adapter, AgentAdapter};
pub use all_agents::{load_all_agents, AgentResources};
pub use manager::ConfigManager;
pub use transfer::{
	InstallScope, InstallTarget, OperationAction, OperationBatchResult,
	OperationResult, ResourceLocator,
};

/// Convert a skill::Skill to core::models::Skill
pub fn convert_skill(skill_pkg: skill::Skill) -> models::Skill {
	use skill::SkillSource;

	let source_path = match &skill_pkg.source {
		SkillSource::SkillMd(p) if !p.as_os_str().is_empty() => {
			format_path_with_tilde(p)
		}
		SkillSource::Directory(p) if !p.as_os_str().is_empty() => {
			format_path_with_tilde(&p.join("SKILL.md"))
		}
		SkillSource::SkillFile(p) | SkillSource::ZipFile(p)
			if !p.as_os_str().is_empty() =>
		{
			format_path_with_tilde(p)
		}
		_ => None,
	};

	models::Skill {
		name: skill_pkg.name,
		enabled: true,
		description: Some(skill_pkg.description),
		author: skill_pkg.author,
		version: skill_pkg.version,
		content: None,
		tools: skill_pkg
			.allowed_tools
			.map(|t| t.split(',').map(|s| s.trim().to_string()).collect())
			.unwrap_or_default(),
		source_path,
		canonical_path: None,
		config_source: None,
	}
}

/// Format a skill path with ~ prefix for home directory
pub(crate) fn format_path_with_tilde(path: &std::path::Path) -> Option<String> {
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
