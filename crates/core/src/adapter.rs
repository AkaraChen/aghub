use crate::{
	adapters::AgentAdapter,
	errors::Result,
	models::{
		AgentConfig, ConfigSource, McpServer, McpTransport, ResourceOrigin,
		ResourceScope, ResourceSourceKind, ResourceWritePolicy,
		RuntimeVisibility, SubAgent,
	},
	skills::discovery::{
		assign_skill_origins, load_skills_from_dirs_with_options,
		SkillDiscoveryOptions,
	},
	AgentDescriptor,
};
use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::process::Command;

thread_local! {
	static SKILLS_PATH_OVERRIDE: RefCell<Option<(String, PathBuf)>> = const { RefCell::new(None) };
	static MCP_PATH_OVERRIDE: RefCell<Option<(String, PathBuf)>> = const { RefCell::new(None) };
}

/// Override the skills path for a specific agent (for testing)
pub fn set_skills_path_override(agent_id: &str, path: Option<PathBuf>) {
	SKILLS_PATH_OVERRIDE.with(|p| {
		*p.borrow_mut() = path.map(|path| (agent_id.to_string(), path));
	});
}

/// Override the MCP config path for a specific agent (for testing)
pub fn set_mcp_path_override(agent_id: &str, path: Option<PathBuf>) {
	MCP_PATH_OVERRIDE.with(|p| {
		*p.borrow_mut() = path.map(|path| (agent_id.to_string(), path));
	});
}

// Function removed because it is now a method on the AgentAdapter trait
impl AgentAdapter for &'static AgentDescriptor {
	fn name(&self) -> &'static str {
		self.id
	}

	fn supports_skill_scope(&self, scope: ResourceScope) -> bool {
		AgentDescriptor::supports_skill_scope(self, scope)
	}

	fn supports_mcp_scope(&self, scope: ResourceScope) -> bool {
		AgentDescriptor::supports_mcp_scope(self, scope)
	}

	fn supports_sub_agent_scope(&self, scope: ResourceScope) -> bool {
		AgentDescriptor::supports_sub_agent_scope(self, scope)
	}

	fn resource_precedence(&self) -> crate::ResourcePrecedence {
		self.precedence
	}

	fn mcp_config_path(
		&self,
		project_root: Option<&Path>,
		scope: ResourceScope,
	) -> Option<PathBuf> {
		if scope == ResourceScope::Both {
			return None;
		}

		if let Some((id, path)) = MCP_PATH_OVERRIDE.with(|p| p.borrow().clone())
		{
			if id == self.id {
				return Some(path);
			}
		}

		self.mcp_path(project_root, scope)
	}

	fn load_mcps(
		&self,
		project_root: Option<&Path>,
		scope: ResourceScope,
	) -> Result<Vec<McpServer>> {
		if scope == ResourceScope::Both {
			let mut mcps = Vec::new();
			let scopes = match self.precedence.mcp {
				crate::ScopePrecedence::ProjectThenGlobal => {
					[ResourceScope::ProjectOnly, ResourceScope::GlobalOnly]
				}
				crate::ScopePrecedence::GlobalThenProject => {
					[ResourceScope::GlobalOnly, ResourceScope::ProjectOnly]
				}
			};
			for item_scope in scopes {
				let root = match item_scope {
					ResourceScope::ProjectOnly => project_root,
					ResourceScope::GlobalOnly => None,
					ResourceScope::Both => unreachable!(),
				};
				if (item_scope != ResourceScope::ProjectOnly || root.is_some())
					&& self.supports_mcp_scope(item_scope)
				{
					mcps.extend(self.load_mcps(root, item_scope)?);
				}
			}

			return Ok(mcps);
		}

		if !self.supports_mcp_scope(scope) {
			return Err(crate::errors::ConfigError::unsupported_operation(
				"read",
				"MCP server",
				self.id,
			));
		}

		let path = self.mcp_config_path(project_root, scope);
		let override_path = MCP_PATH_OVERRIDE.with(|value| {
			value
				.borrow()
				.as_ref()
				.filter(|(id, _)| id == self.id)
				.map(|(_, path)| path.clone())
		});
		let mut mcps = if let (Some(path), Some(parse)) =
			(override_path.as_ref(), self.mcp_parse_config)
		{
			crate::descriptor::load_mcps_from_file(path, parse)?
		} else {
			(self.load_mcps)(project_root, scope)?
		};
		let config_source = match scope {
			ResourceScope::GlobalOnly => ConfigSource::Global,
			ResourceScope::ProjectOnly => ConfigSource::Project,
			ResourceScope::Both => unreachable!(),
		};
		let surface_ids = self
			.surfaces
			.iter()
			.filter(|surface| {
				let capabilities =
					surface.capabilities.unwrap_or(self.capabilities);
				match scope {
					ResourceScope::GlobalOnly => capabilities.mcp.scopes.global,
					ResourceScope::ProjectOnly => {
						capabilities.mcp.scopes.project
					}
					ResourceScope::Both => false,
				}
			})
			.map(|surface| surface.id)
			.map(str::to_string)
			.collect::<Vec<_>>();
		let physical_location =
			path.as_deref().and_then(crate::format_path_with_tilde);
		let write_policy = if path.is_some() {
			ResourceWritePolicy::ReadWrite
		} else {
			ResourceWritePolicy::ManagedExternally
		};
		for mcp in &mut mcps {
			mcp.config_source = Some(config_source);
			if mcp.origin.is_none() {
				mcp.origin = Some(ResourceOrigin {
					product_id: self.id.to_string(),
					surface_ids: surface_ids.clone(),
					scope: config_source,
					source_kind: ResourceSourceKind::Native,
					physical_location: physical_location.clone(),
					precedence: 0,
					write_policy,
					runtime_visibility: RuntimeVisibility::Visible,
					runtime_visibility_evidence: Some(
						"declared by the Agent MCP loader".to_string(),
					),
				});
			}
		}
		Ok(mcps)
	}

	fn get_skills_paths(
		&self,
		project_root: Option<&Path>,
		scope: ResourceScope,
	) -> Vec<PathBuf> {
		let mut paths = Vec::new();

		// Check thread-local override first (for testing)
		if let Some((id, path)) =
			SKILLS_PATH_OVERRIDE.with(|p| p.borrow().clone())
		{
			if id == self.id {
				paths.push(path);
				return paths;
			}
		}

		self.skill_read_paths(project_root, scope)
	}

	fn target_skills_dir(
		&self,
		project_root: Option<&Path>,
		scope: ResourceScope,
	) -> Option<PathBuf> {
		// Check thread-local override first (for testing)
		if let Some((id, path)) =
			SKILLS_PATH_OVERRIDE.with(|p| p.borrow().clone())
		{
			if id == self.id {
				return Some(path);
			}
		}

		self.skill_write_path(project_root, scope)
	}

	fn load_config(
		&self,
		project_root: Option<&Path>,
		scope: ResourceScope,
	) -> Result<AgentConfig> {
		let mut config = AgentConfig::new();
		if self.supports_mcp_scope(scope) {
			config.mcps = self.load_mcps(project_root, scope)?;
		}

		if self.supports_skill_scope(scope) {
			let skills_paths = self.get_skills_paths(project_root, scope);
			if !skills_paths.is_empty() {
				let options = SkillDiscoveryOptions::default()
					.for_agent(self.capabilities.skills.discovery);
				config.skills =
					load_skills_from_dirs_with_options(&skills_paths, options);
				let mut sources = Vec::new();
				if scope == ResourceScope::ProjectOnly
					|| scope == ResourceScope::Both
				{
					if let Some(root) = project_root {
						sources.extend(self.skill_read_sources(
							Some(root),
							ResourceScope::ProjectOnly,
						));
					}
				}
				if scope == ResourceScope::GlobalOnly
					|| scope == ResourceScope::Both
				{
					sources.extend(
						self.skill_read_sources(
							None,
							ResourceScope::GlobalOnly,
						),
					);
				}
				assign_skill_origins(&mut config.skills, self.id, &sources);
			}
		}

		if self.supports_sub_agent_scope(scope) {
			config.sub_agents =
				AgentAdapter::load_sub_agents(self, project_root, scope)?;
		}

		Ok(config)
	}

	fn save_mcps(
		&self,
		project_root: Option<&Path>,
		scope: ResourceScope,
		mcps: &[McpServer],
	) -> Result<()> {
		if scope == ResourceScope::Both {
			return Err(crate::errors::ConfigError::unsupported_operation(
				"persist",
				"MCP server",
				self.id,
			));
		}

		if !self.supports_mcp_scope(scope) {
			return Err(crate::errors::ConfigError::unsupported_operation(
				"persist",
				"MCP server",
				self.id,
			));
		}

		if let Some((id, path)) = MCP_PATH_OVERRIDE.with(|p| p.borrow().clone())
		{
			if id == self.id {
				if let Some(serialize) = self.mcp_serialize_config {
					return crate::descriptor::save_mcps_to_file(
						&path, mcps, serialize,
					);
				}
			}
		}

		if let Some(path) = self.mcp_config_path(project_root, scope) {
			if let Some(serialize) = self.mcp_serialize_config {
				return crate::descriptor::save_mcps_to_file(
					&path, mcps, serialize,
				);
			}
		}

		(self.save_mcps)(project_root, scope, mcps)
	}

	fn load_sub_agents(
		&self,
		project_root: Option<&Path>,
		scope: ResourceScope,
	) -> Result<Vec<SubAgent>> {
		if scope == ResourceScope::Both {
			let mut agents = Vec::new();
			let scopes = match self.precedence.sub_agents {
				crate::ScopePrecedence::ProjectThenGlobal => {
					[ResourceScope::ProjectOnly, ResourceScope::GlobalOnly]
				}
				crate::ScopePrecedence::GlobalThenProject => {
					[ResourceScope::GlobalOnly, ResourceScope::ProjectOnly]
				}
			};
			for item_scope in scopes {
				let root = match item_scope {
					ResourceScope::ProjectOnly => project_root,
					ResourceScope::GlobalOnly => None,
					ResourceScope::Both => unreachable!(),
				};
				if (item_scope != ResourceScope::ProjectOnly || root.is_some())
					&& self.supports_sub_agent_scope(item_scope)
				{
					agents.extend(self.load_sub_agents(root, item_scope)?);
				}
			}
			return Ok(agents);
		}
		let mut agents = (self.load_sub_agents)(project_root, scope)?;
		let config_source = match scope {
			ResourceScope::GlobalOnly => ConfigSource::Global,
			ResourceScope::ProjectOnly => ConfigSource::Project,
			ResourceScope::Both => unreachable!(),
		};
		let sources = self.sub_agent_read_sources(project_root, scope);
		for agent in &mut agents {
			let physical_location = agent.source_path.clone();
			let source = physical_location
				.as_deref()
				.map(crate::rules::expand_tilde)
				.and_then(|path| {
					sources.iter().find(|source| path.starts_with(&source.root))
				});
			agent.config_source = Some(config_source);
			agent.origin = Some(ResourceOrigin {
				product_id: self.id.to_string(),
				surface_ids: source
					.map(|source| {
						source
							.surface_ids
							.iter()
							.map(|id| (*id).to_string())
							.collect()
					})
					.unwrap_or_default(),
				scope: config_source,
				source_kind: source
					.map(|source| source.source_kind)
					.unwrap_or(ResourceSourceKind::External),
				physical_location,
				precedence: source.map(|source| source.precedence).unwrap_or(0),
				write_policy: source
					.map(|source| source.write_policy)
					.unwrap_or(ResourceWritePolicy::ManagedExternally),
				runtime_visibility: source
					.map(|source| source.runtime_visibility)
					.unwrap_or(RuntimeVisibility::Unknown),
				runtime_visibility_evidence: Some(
					source
						.map(|source| source.runtime_visibility_evidence)
						.unwrap_or("returned by the Agent subagent loader")
						.to_string(),
				),
			});
		}
		Ok(agents)
	}

	fn save_sub_agents(
		&self,
		project_root: Option<&Path>,
		scope: ResourceScope,
		agents: &[SubAgent],
	) -> Result<()> {
		(self.save_sub_agents)(project_root, scope, agents)
	}

	fn validate_command(&self, config_path: Option<&Path>) -> Result<Command> {
		let surface = self
			.surfaces
			.iter()
			.find(|surface| !surface.cli_names.is_empty())
			.ok_or_else(|| {
				crate::errors::ConfigError::unsupported_operation(
					"validate", "runtime", self.id,
				)
			})?;
		let cli_name = surface
			.cli_names
			.iter()
			.find(|name| which::which(name).is_ok())
			.or_else(|| surface.cli_names.first())
			.expect("CLI surface must declare at least one command");
		let mut cmd = Command::new(cli_name);
		for arg in surface.validate_args {
			cmd.arg(arg);
		}
		if let Some(config_path) = config_path {
			cmd.arg(config_path);
		}
		// `validate` runs this from the console-less desktop app; suppress the
		// console window Windows would otherwise pop for the agent CLI.
		#[cfg(target_os = "windows")]
		{
			use std::os::windows::process::CommandExt;
			cmd.creation_flags(crate::CREATE_NO_WINDOW);
		}
		Ok(cmd)
	}

	fn supports_mcp_operations(&self) -> bool {
		self.capabilities.mcp.scopes.global
			|| self.capabilities.mcp.scopes.project
	}

	fn mcp_supports_transport(&self, transport: &McpTransport) -> bool {
		crate::descriptor::supports_mcp_transport(self.capabilities, transport)
	}

	fn supports_mcp_enable_disable(&self) -> bool {
		self.capabilities.mcp.enable_disable
	}
}
