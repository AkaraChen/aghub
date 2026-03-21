use crate::{
	adapters::AgentAdapter,
	errors::{ConfigError, Result},
	models::{AgentConfig, ResourceScope},
};
use std::path::{Path, PathBuf};

pub mod mcp;
pub mod skill;

/// Manages configuration loading, saving, and CRUD operations
pub struct ConfigManager {
	pub(crate) adapter: Box<dyn AgentAdapter>,
	pub(crate) config_path: PathBuf,
	pub(crate) project_root: Option<PathBuf>,
	pub(crate) config: Option<AgentConfig>,
	pub(crate) scope: ResourceScope,
}

impl ConfigManager {
	pub fn new(
		adapter: Box<dyn AgentAdapter>,
		global: bool,
		project_root: Option<&Path>,
	) -> Self {
		let config_path = if global {
			adapter.global_config_path()
		} else if let Some(root) = project_root {
			adapter.project_config_path(root)
		} else {
			adapter.global_config_path()
		};
		Self {
			adapter,
			config_path,
			project_root: project_root.map(|p| p.to_path_buf()),
			config: None,
			scope: ResourceScope::GlobalOnly,
		}
	}

	/// Create a new ConfigManager with resource scope
	pub fn with_scope(
		adapter: Box<dyn AgentAdapter>,
		global: bool,
		project_root: Option<&Path>,
		scope: ResourceScope,
	) -> Self {
		let config_path = if global {
			adapter.global_config_path()
		} else if let Some(root) = project_root {
			adapter.project_config_path(root)
		} else {
			adapter.global_config_path()
		};
		Self {
			adapter,
			config_path,
			project_root: project_root.map(|p| p.to_path_buf()),
			config: None,
			scope,
		}
	}

	pub fn with_path(
		adapter: Box<dyn AgentAdapter>,
		config_path: PathBuf,
	) -> Self {
		Self {
			adapter,
			config_path,
			project_root: None,
			config: None,
			scope: ResourceScope::GlobalOnly,
		}
	}

	pub fn config_path(&self) -> &Path {
		&self.config_path
	}

	pub fn agent_name(&self) -> &str {
		self.adapter.name()
	}

	pub fn load(&mut self) -> Result<&AgentConfig> {
		// For Both scope, we need to merge project and global configs
		if self.scope == ResourceScope::Both {
			return self.load_both();
		}

		// Delegate to adapter - it handles all I/O internally
		let config = self.adapter.load_config(
			&self.config_path,
			self.project_root.as_deref(),
			self.scope,
		)?;
		self.config = Some(config);
		Ok(self.config.as_ref().unwrap())
	}

	/// Load and merge configs from both project and global
	fn load_both(&mut self) -> Result<&AgentConfig> {
		let mut merged_config = AgentConfig::new();
		let mut seen_skill_names = std::collections::HashSet::new();

		// Load project config first (project skills take precedence)
		if let Some(root) = &self.project_root {
			let project_path = self.adapter.project_config_path(root);
			let project = self.adapter.load_config(
				&project_path,
				Some(root),
				ResourceScope::ProjectOnly,
			)?;
			// Add project skills
			for skill in project.skills {
				if !seen_skill_names.contains(&skill.name) {
					seen_skill_names.insert(skill.name.clone());
					merged_config.skills.push(skill);
				}
			}
			// Add project MCPs
			merged_config.mcps.extend(project.mcps);
		}

		// Load global config
		let global_path = self.adapter.global_config_path();
		let global = self.adapter.load_config(
			&global_path,
			None,
			ResourceScope::GlobalOnly,
		)?;
		// Add global skills (only if not already in project)
		for skill in global.skills {
			if !seen_skill_names.contains(&skill.name) {
				seen_skill_names.insert(skill.name.clone());
				merged_config.skills.push(skill);
			}
		}
		// Add global MCPs
		merged_config.mcps.extend(global.mcps);

		self.config = Some(merged_config);
		Ok(self.config.as_ref().unwrap())
	}

	pub fn save(&self, config: &AgentConfig) -> Result<()> {
		if let Some(parent) = self.config_path.parent() {
			std::fs::create_dir_all(parent)?;
		}
		let original_content = std::fs::read_to_string(&self.config_path).ok();
		let content = self
			.adapter
			.serialize_config(config, original_content.as_deref())?;
		std::fs::write(&self.config_path, content)?;
		Ok(())
	}

	pub fn save_current(&self) -> Result<()> {
		match &self.config {
			Some(config) => self.save(config),
			None => Err(ConfigError::InvalidConfig(
				"No configuration loaded".to_string(),
			)),
		}
	}

	pub fn validate(&self) -> Result<()> {
		let output =
			self.adapter.validate_command(&self.config_path).output()?;
		if !output.status.success() {
			let stderr = String::from_utf8_lossy(&output.stderr);
			return Err(ConfigError::ValidationFailed(stderr.to_string()));
		}
		Ok(())
	}

	pub fn config(&self) -> Option<&AgentConfig> {
		self.config.as_ref()
	}

	pub fn init_empty_config(&mut self) {
		if self.config.is_none() {
			self.config = Some(AgentConfig::new());
		}
	}

	pub(crate) fn config_mut(&mut self) -> Result<&mut AgentConfig> {
		self.config.as_mut().ok_or_else(|| {
			ConfigError::InvalidConfig("No configuration loaded".to_string())
		})
	}
}
