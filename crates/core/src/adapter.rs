use crate::{
	adapters::AgentAdapter,
	errors::Result,
	models::AgentConfig,
	registry::descriptor::AgentDescriptor,
	skills::discovery::load_skills_from_dirs,
};
use std::cell::RefCell;
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

/// Get the universal skills directory path following XDG config spec
fn get_universal_skills_path() -> Option<PathBuf> {
	// Check XDG_CONFIG_HOME first, then fall back to ~/.config
	let config_dir = std::env::var_os("XDG_CONFIG_HOME")
		.map(PathBuf::from)
		.or_else(|| dirs::home_dir().map(|h| h.join(".config")))?;

	Some(config_dir.join("agents/skills"))
}

fn get_skills_paths(descriptor: &AgentDescriptor) -> Vec<PathBuf> {
	let mut paths = Vec::new();

	// Check thread-local override first
	if let Some((id, path)) = SKILLS_PATH_OVERRIDE.with(|p| p.borrow().clone()) {
		if id == descriptor.id {
			paths.push(path);
			return paths;
		}
	}

	// Add agent-specific skills path
	if let Some(path_fn) = descriptor.global_skills_path {
		paths.push(path_fn());
	}

	// Add universal skills path for agents that support it
	if descriptor.uses_universal_skills {
		if let Some(universal_path) = get_universal_skills_path() {
			// Only add if not already the same as agent-specific path
			if !paths.contains(&universal_path) {
				paths.push(universal_path);
			}
		}
	}

	paths
}

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
		let mut config = (self.parse_config)(content)?;

		// Load skills from the agent's skills directories
		if self.capabilities.skills {
			let skills_paths = get_skills_paths(self);
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

	fn supports_mcp_enable_disable(&self) -> bool {
		self.capabilities.mcp_enable_disable
	}
}
