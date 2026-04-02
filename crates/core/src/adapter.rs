use crate::{
	adapters::AgentAdapter,
	errors::Result,
	models::{AgentConfig, McpServer, McpTransport, ResourceScope},
	skills::discovery::load_skills_from_dirs,
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

			if let Some(root) = project_root {
				if self.supports_mcp_scope(ResourceScope::ProjectOnly) {
					mcps.extend(
						self.load_mcps(Some(root), ResourceScope::ProjectOnly)?,
					);
				}
			}

			if self.supports_mcp_scope(ResourceScope::GlobalOnly) {
				mcps.extend(self.load_mcps(None, ResourceScope::GlobalOnly)?);
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

		if let Some(path) = self.mcp_config_path(project_root, scope) {
			if let Some(parse) = self.mcp_parse_config {
				return crate::descriptor::load_mcps_from_file(&path, parse);
			}
		}

		(self.load_mcps)(project_root, scope)
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
				config.skills = load_skills_from_dirs(&skills_paths);
			}
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

	fn validate_command(&self, config_path: Option<&Path>) -> Command {
		let mut cmd = Command::new(self.cli_name);
		for arg in self.validate_args {
			cmd.arg(arg);
		}
		if let Some(config_path) = config_path {
			cmd.arg(config_path);
		}
		cmd
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
