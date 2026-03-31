use crate::{
	adapters::AgentAdapter,
	errors::Result,
	models::{AgentConfig, ResourceScope},
	skills::discovery::load_skills_from_dirs,
	AgentDescriptor,
};
use std::cell::RefCell;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

thread_local! {
	static SKILLS_PATH_OVERRIDE: RefCell<Option<(String, PathBuf)>> = const { RefCell::new(None) };
}

/// Override the skills path for a specific agent (for testing)
pub fn set_skills_path_override(agent_id: &str, path: Option<PathBuf>) {
	SKILLS_PATH_OVERRIDE.with(|p| {
		*p.borrow_mut() = path.map(|path| (agent_id.to_string(), path));
	});
}

// Function removed because it is now a method on the AgentAdapter trait
impl AgentAdapter for &'static AgentDescriptor {
	fn name(&self) -> &'static str {
		self.id
	}

	fn global_config_path(&self) -> PathBuf {
		(self.global_path)()
	}

	fn project_config_path(&self, project_root: &Path) -> PathBuf {
		(self.project_path)(project_root)
	}

	fn parse_config(&self, content: &str) -> Result<AgentConfig> {
		(self.parse_config)(content)
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

		// Add project-level skills directories if scope includes project
		if scope == ResourceScope::ProjectOnly || scope == ResourceScope::Both {
			if let Some(root) = project_root {
				paths.extend(self.project_skills_dirs(root));
			}
		}

		// Add global skills directories if scope includes global
		if scope == ResourceScope::GlobalOnly || scope == ResourceScope::Both {
			paths.extend(self.global_skills_dirs());
		}

		paths
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

		match scope {
			ResourceScope::GlobalOnly => {
				self.global_skills_dirs().first().cloned()
			}
			ResourceScope::ProjectOnly | ResourceScope::Both => {
				if let Some(root) = project_root {
					self.project_skills_dirs(root).first().cloned()
				} else {
					self.global_skills_dirs().first().cloned()
				}
			}
		}
	}

	fn load_config(
		&self,
		config_path: &Path,
		project_root: Option<&Path>,
		scope: ResourceScope,
	) -> Result<AgentConfig> {
		// 1. Try to load MCPs from config file
		let mut config = match fs::read_to_string(config_path) {
			Ok(content) => (self.parse_config)(&content)?,
			Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
				// No config file is fine - start with empty config
				AgentConfig::new()
			}
			Err(e) => return Err(e.into()),
		};

		// 2. Discover skills from directories based on scope
		if self.capabilities.skills {
			let skills_paths = self.get_skills_paths(project_root, scope);
			if !skills_paths.is_empty() {
				config.skills = load_skills_from_dirs(&skills_paths);
			}
		}

		Ok(config)
	}

	fn serialize_config(
		&self,
		config: &AgentConfig,
		original_content: Option<&str>,
	) -> Result<String> {
		(self.serialize_config)(config, original_content)
	}

	fn validate_command(&self, config_path: &Path) -> Command {
		let mut cmd = Command::new(self.cli_name);
		for arg in self.validate_args {
			cmd.arg(arg);
		}
		cmd.arg(config_path);
		cmd
	}

	fn supports_mcp_operations(&self) -> bool {
		self.capabilities.mcp_stdio || self.capabilities.mcp_remote
	}

	fn supports_mcp_enable_disable(&self) -> bool {
		self.capabilities.mcp_enable_disable
	}
}
