use crate::{
	adapters::AgentAdapter,
	errors::{ConfigError, Result},
	models::{
		AgentConfig, ConfigSource, McpServer, ResourceScope,
		ResourceWritePolicy, Skill, SubAgent,
	},
};
use log::{debug, info, warn};
use std::path::{Path, PathBuf};

pub mod mcp;
pub mod skill;
pub mod sub_agent;

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
		debug!(
			"loading config for agent '{}' with scope {:?}",
			self.adapter.name(),
			self.scope
		);
		// For Both scope, we need to merge project and global configs
		if self.scope == ResourceScope::Both {
			return self.load_both();
		}

		// Delegate to adapter - it handles all I/O internally
		let config = self
			.adapter
			.load_config(self.project_root.as_deref(), self.scope)?;
		self.config = Some(config);
		if let Some(config) = self.config.as_ref() {
			info!(
				"loaded config for agent '{}' with {} skills, {} mcps, \
				 {} sub-agents",
				self.adapter.name(),
				config.skills.len(),
				config.mcps.len(),
				config.sub_agents.len(),
			);
		}
		Ok(self.config.as_ref().unwrap())
	}

	/// Load both scopes using the precedence declared for each resource.
	/// Skills and sub-agents keep the first same-name entry. MCPs retain both
	/// scopes so callers can edit each source.
	pub fn load_both_annotated(
		&mut self,
	) -> Result<(Vec<Skill>, Vec<McpServer>, Vec<SubAgent>)> {
		debug!(
			"loading both-scope annotated config for agent '{}'",
			self.adapter.name()
		);
		let mut skills: Vec<Skill> = Vec::new();
		let mut mcps: Vec<McpServer> = Vec::new();
		let mut sub_agents: Vec<SubAgent> = Vec::new();
		let mut seen_skills = std::collections::HashSet::new();
		let mut seen_sub_agents = std::collections::HashSet::new();

		let supports_scope = |scope| {
			self.adapter.supports_skill_scope(scope)
				|| self.adapter.supports_mcp_scope(scope)
				|| self.adapter.supports_sub_agent_scope(scope)
		};
		let global = if supports_scope(ResourceScope::GlobalOnly) {
			Some(self.adapter.load_config(None, ResourceScope::GlobalOnly)?)
		} else {
			None
		};
		let project = if supports_scope(ResourceScope::ProjectOnly) {
			match self.project_root.as_deref() {
				Some(root) => Some(
					self.adapter
						.load_config(Some(root), ResourceScope::ProjectOnly)?,
				),
				None => None,
			}
		} else {
			None
		};
		let ordered = |precedence| {
			let global =
				global.as_ref().map(|config| (config, ConfigSource::Global));
			let project = project
				.as_ref()
				.map(|config| (config, ConfigSource::Project));
			match precedence {
				crate::ScopePrecedence::ProjectThenGlobal => [project, global],
				crate::ScopePrecedence::GlobalThenProject => [global, project],
			}
		};
		let precedence = self.adapter.resource_precedence();

		for (loaded, source) in ordered(precedence.skills).into_iter().flatten()
		{
			for mut skill in loaded.skills.iter().cloned() {
				if seen_skills.insert(skill.name.clone()) {
					skill.config_source = Some(source);
					skills.push(skill);
				}
			}
		}
		for (loaded, source) in ordered(precedence.mcp).into_iter().flatten() {
			for mut mcp in loaded.mcps.iter().cloned() {
				mcp.config_source = Some(source);
				mcps.push(mcp);
			}
		}
		for (loaded, source) in
			ordered(precedence.sub_agents).into_iter().flatten()
		{
			for mut agent in loaded.sub_agents.iter().cloned() {
				if seen_sub_agents.insert(agent.name.clone()) {
					agent.config_source = Some(source);
					sub_agents.push(agent);
				}
			}
		}

		info!(
			"loaded annotated resources for agent '{}': {} skills, {} mcps, \
			 {} sub-agents",
			self.adapter.name(),
			skills.len(),
			mcps.len(),
			sub_agents.len(),
		);
		Ok((skills, mcps, sub_agents))
	}

	/// Load and merge configs from both project and global
	fn load_both(&mut self) -> Result<&AgentConfig> {
		debug!(
			"loading merged config for agent '{}' across scopes",
			self.adapter.name()
		);
		let (skills, mcps, sub_agents) = self.load_both_annotated()?;
		let merged_config = AgentConfig {
			skills,
			mcps,
			sub_agents,
		};

		self.config = Some(merged_config);
		if let Some(config) = self.config.as_ref() {
			info!(
				"merged config for agent '{}' with {} skills, {} mcps, \
				 {} sub-agents",
				self.adapter.name(),
				config.skills.len(),
				config.mcps.len(),
				config.sub_agents.len(),
			);
		}
		Ok(self.config.as_ref().unwrap())
	}

	pub fn save(&self, config: &AgentConfig) -> Result<()> {
		debug!(
			"saving config for agent '{}' to scope {:?}",
			self.adapter.name(),
			self.write_scope
		);
		if !self.adapter.supports_mcp_operations() {
			if config.mcps.is_empty() {
				debug!(
					"skipping config save for agent '{}' because there are no MCPs",
					self.adapter.name()
				);
				return Ok(());
			}
			return Err(ConfigError::unsupported_operation(
				"persist",
				"MCP servers",
				self.adapter.name(),
			));
		}
		let writable_mcps = config
			.mcps
			.iter()
			.filter(|mcp| {
				mcp.origin.as_ref().is_none_or(|origin| {
					origin.write_policy == ResourceWritePolicy::ReadWrite
				})
			})
			.cloned()
			.collect::<Vec<_>>();
		self.adapter.save_mcps(
			self.project_root.as_deref(),
			self.write_scope,
			&writable_mcps,
		)?;
		info!(
			"saved {} MCPs for agent '{}' in scope {:?}",
			writable_mcps.len(),
			self.adapter.name(),
			self.write_scope
		);
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

	/// Persist the current sub-agents list via the adapter.
	pub(crate) fn save_sub_agents_current(&self) -> Result<()> {
		let config = self.config.as_ref().ok_or_else(|| {
			ConfigError::InvalidConfig("No configuration loaded".to_string())
		})?;
		self.adapter.save_sub_agents(
			self.project_root.as_deref(),
			self.write_scope,
			&config.sub_agents,
		)?;
		info!(
			"saved {} sub-agents for agent '{}' in scope {:?}",
			config.sub_agents.len(),
			self.adapter.name(),
			self.write_scope,
		);
		Ok(())
	}

	pub fn validate(&self) -> Result<()> {
		let config_path = self.config_path();
		debug!(
			"validating config for agent '{}' at {:?}",
			self.adapter.name(),
			config_path
		);
		let output = self
			.adapter
			.validate_command(config_path.as_deref())?
			.output()?;
		if !output.status.success() {
			let stderr = String::from_utf8_lossy(&output.stderr);
			warn!(
				"validation failed for agent '{}': {}",
				self.adapter.name(),
				stderr.trim()
			);
			return Err(ConfigError::ValidationFailed(stderr.to_string()));
		}
		info!("validated config for agent '{}'", self.adapter.name());
		Ok(())
	}

	pub fn config(&self) -> Option<&AgentConfig> {
		self.config.as_ref()
	}

	pub fn init_empty_config(&mut self) {
		if self.config.is_none() {
			self.config = Some(AgentConfig::new());
			info!(
				"initialized empty config for agent '{}'",
				self.adapter.name()
			);
		}
	}

	pub(crate) fn config_mut(&mut self) -> Result<&mut AgentConfig> {
		self.config.as_mut().ok_or_else(|| {
			ConfigError::InvalidConfig("No configuration loaded".to_string())
		})
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::{McpTransport, ResourcePrecedence, ScopePrecedence};
	use std::process::Command;

	struct MixedPrecedenceAdapter;

	impl AgentAdapter for MixedPrecedenceAdapter {
		fn name(&self) -> &'static str {
			"mixed-precedence"
		}

		fn supports_skill_scope(&self, _scope: ResourceScope) -> bool {
			true
		}

		fn supports_mcp_scope(&self, _scope: ResourceScope) -> bool {
			true
		}

		fn supports_sub_agent_scope(&self, _scope: ResourceScope) -> bool {
			true
		}

		fn resource_precedence(&self) -> ResourcePrecedence {
			ResourcePrecedence {
				skills: ScopePrecedence::GlobalThenProject,
				mcp: ScopePrecedence::ProjectThenGlobal,
				sub_agents: ScopePrecedence::ProjectThenGlobal,
				rules: ScopePrecedence::GlobalThenProject,
			}
		}

		fn mcp_config_path(
			&self,
			_project_root: Option<&Path>,
			_scope: ResourceScope,
		) -> Option<PathBuf> {
			None
		}

		fn load_mcps(
			&self,
			_project_root: Option<&Path>,
			scope: ResourceScope,
		) -> Result<Vec<McpServer>> {
			Ok(vec![McpServer::new(
				"shared",
				McpTransport::stdio(format!("{scope:?}"), Vec::new()),
			)])
		}

		fn save_mcps(
			&self,
			_project_root: Option<&Path>,
			_scope: ResourceScope,
			_mcps: &[McpServer],
		) -> Result<()> {
			Ok(())
		}

		fn load_sub_agents(
			&self,
			_project_root: Option<&Path>,
			scope: ResourceScope,
		) -> Result<Vec<SubAgent>> {
			let mut agent = SubAgent::new("shared");
			agent.description = Some(format!("{scope:?}"));
			Ok(vec![agent])
		}

		fn save_sub_agents(
			&self,
			_project_root: Option<&Path>,
			_scope: ResourceScope,
			_agents: &[SubAgent],
		) -> Result<()> {
			Ok(())
		}

		fn load_config(
			&self,
			project_root: Option<&Path>,
			scope: ResourceScope,
		) -> Result<AgentConfig> {
			let mut skill = Skill::new("shared");
			skill.description = Some(format!("{scope:?}"));
			Ok(AgentConfig {
				skills: vec![skill],
				mcps: self.load_mcps(project_root, scope)?,
				sub_agents: self.load_sub_agents(project_root, scope)?,
			})
		}

		fn get_skills_paths(
			&self,
			_project_root: Option<&Path>,
			_scope: ResourceScope,
		) -> Vec<PathBuf> {
			Vec::new()
		}

		fn target_skills_dir(
			&self,
			_project_root: Option<&Path>,
			_scope: ResourceScope,
		) -> Option<PathBuf> {
			None
		}

		fn mcp_supports_transport(&self, _transport: &McpTransport) -> bool {
			true
		}

		fn validate_command(
			&self,
			_config_path: Option<&Path>,
		) -> Result<Command> {
			Ok(Command::new("true"))
		}
	}

	#[test]
	fn both_scope_uses_each_resources_precedence() {
		let project = tempfile::tempdir().unwrap();
		let mut manager = ConfigManager::with_scope(
			Box::new(MixedPrecedenceAdapter),
			false,
			Some(project.path()),
			ResourceScope::Both,
		);

		let (skills, mcps, sub_agents) = manager.load_both_annotated().unwrap();

		assert_eq!(skills.len(), 1);
		assert_eq!(skills[0].config_source, Some(ConfigSource::Global));
		assert_eq!(skills[0].description.as_deref(), Some("GlobalOnly"));
		assert_eq!(mcps.len(), 2);
		assert_eq!(mcps[0].config_source, Some(ConfigSource::Project));
		assert_eq!(mcps[1].config_source, Some(ConfigSource::Global));
		assert_eq!(sub_agents.len(), 1);
		assert_eq!(sub_agents[0].config_source, Some(ConfigSource::Project));
		assert_eq!(sub_agents[0].description.as_deref(), Some("ProjectOnly"));
	}
}
