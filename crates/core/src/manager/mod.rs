use crate::{
	adapters::AgentAdapter,
	errors::{ConfigError, Result},
	models::{AgentConfig, ConfigSource, McpServer, ResourceScope, Skill},
};
use std::path::{Path, PathBuf};

pub mod mcp;
pub mod skill;

/// Manages configuration loading, saving, and CRUD operations
pub struct ConfigManager {
	pub(crate) adapter: Box<dyn AgentAdapter>,
	pub(crate) project_root: Option<PathBuf>,
	pub(crate) config: Option<AgentConfig>,
	pub(crate) scope: ResourceScope,
	pub(crate) write_scope: ResourceScope,
}

impl ConfigManager {
	pub fn new(
		adapter: Box<dyn AgentAdapter>,
		global: bool,
		project_root: Option<&Path>,
	) -> Self {
		let scope = if global {
			ResourceScope::GlobalOnly
		} else {
			ResourceScope::ProjectOnly
		};
		Self::with_scope(adapter, global, project_root, scope)
	}

	/// Create a new ConfigManager with resource scope
	pub fn with_scope(
		adapter: Box<dyn AgentAdapter>,
		global: bool,
		project_root: Option<&Path>,
		scope: ResourceScope,
	) -> Self {
		Self {
			adapter,
			project_root: project_root.map(|p| p.to_path_buf()),
			config: None,
			scope,
			write_scope: if global {
				ResourceScope::GlobalOnly
			} else {
				ResourceScope::ProjectOnly
			},
		}
	}

	pub fn config_path(&self) -> Option<PathBuf> {
		self.adapter
			.mcp_config_path(self.project_root.as_deref(), self.write_scope)
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
		let config = self
			.adapter
			.load_config(self.project_root.as_deref(), self.scope)?;
		self.config = Some(config);
		Ok(self.config.as_ref().unwrap())
	}

	/// Load and merge configs from both project and global, tracking provenance.
	/// Skills are deduplicated by name (project takes precedence).
	/// MCPs are not deduplicated — same name can appear from both scopes.
	pub fn load_both_annotated(
		&mut self,
	) -> Result<(Vec<Skill>, Vec<McpServer>)> {
		let mut skills: Vec<Skill> = Vec::new();
		let mut mcps: Vec<McpServer> = Vec::new();
		let mut seen = std::collections::HashSet::new();

		// Project first (takes precedence for skills)
		if let Some(root) = self.project_root.clone() {
			if self
				.adapter
				.supports_skill_scope(ResourceScope::ProjectOnly)
				|| self.adapter.supports_mcp_scope(ResourceScope::ProjectOnly)
			{
				if let Ok(project) = self
					.adapter
					.load_config(Some(&root), ResourceScope::ProjectOnly)
				{
					for mut skill in project.skills {
						seen.insert(skill.name.clone());
						skill.config_source = Some(ConfigSource::Project);
						skills.push(skill);
					}
					for mut mcp in project.mcps {
						mcp.config_source = Some(ConfigSource::Project);
						mcps.push(mcp);
					}
				}
			}
		}

		// Global second
		if self.adapter.supports_skill_scope(ResourceScope::GlobalOnly)
			|| self.adapter.supports_mcp_scope(ResourceScope::GlobalOnly)
		{
			if let Ok(global) =
				self.adapter.load_config(None, ResourceScope::GlobalOnly)
			{
				for mut skill in global.skills {
					if !seen.contains(&skill.name) {
						skill.config_source = Some(ConfigSource::Global);
						skills.push(skill);
					}
				}
				for mut mcp in global.mcps {
					mcp.config_source = Some(ConfigSource::Global);
					mcps.push(mcp);
				}
			}
		}

		Ok((skills, mcps))
	}

	/// Load and merge configs from both project and global
	fn load_both(&mut self) -> Result<&AgentConfig> {
		let mut merged_config = AgentConfig::new();
		let mut seen_skill_names = std::collections::HashSet::new();

		// Load project config first (project skills take precedence)
		if let Some(root) = &self.project_root {
			if self
				.adapter
				.supports_skill_scope(ResourceScope::ProjectOnly)
				|| self.adapter.supports_mcp_scope(ResourceScope::ProjectOnly)
			{
				let project = self
					.adapter
					.load_config(Some(root), ResourceScope::ProjectOnly)?;
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
		}

		// Load global config
		if self.adapter.supports_skill_scope(ResourceScope::GlobalOnly)
			|| self.adapter.supports_mcp_scope(ResourceScope::GlobalOnly)
		{
			let global =
				self.adapter.load_config(None, ResourceScope::GlobalOnly)?;
			// Add global skills (only if not already in project)
			for skill in global.skills {
				if !seen_skill_names.contains(&skill.name) {
					seen_skill_names.insert(skill.name.clone());
					merged_config.skills.push(skill);
				}
			}
			// Add global MCPs
			merged_config.mcps.extend(global.mcps);
		}

		self.config = Some(merged_config);
		Ok(self.config.as_ref().unwrap())
	}

	pub fn save(&self, config: &AgentConfig) -> Result<()> {
		if !self.adapter.supports_mcp_operations() {
			if config.mcps.is_empty() {
				return Ok(());
			}
			return Err(ConfigError::unsupported_operation(
				"persist",
				"MCP servers",
				self.adapter.name(),
			));
		}
		self.adapter.save_mcps(
			self.project_root.as_deref(),
			self.write_scope,
			&config.mcps,
		)
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
		let config_path = self.config_path();
		let output = self
			.adapter
			.validate_command(config_path.as_deref())
			.output()?;
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
