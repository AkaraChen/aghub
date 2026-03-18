use crate::{errors::Result, models::AgentConfig};
use std::path::{Path, PathBuf};
use std::process::Command;

pub mod list;
pub mod map;
pub mod toml;

pub use self::toml::TomlAdapter;
pub use list::ListAdapter;
pub use map::MapAdapter;

/// Trait for adapting different agent configuration formats
pub trait AgentAdapter: Send + Sync {
	/// Get the agent name
	fn name(&self) -> &'static str;

	/// Get the global configuration path
	fn global_config_path(&self) -> PathBuf;

	/// Get the project configuration path for a given project root
	fn project_config_path(&self, project_root: &Path) -> PathBuf;

	/// Parse agent-specific config into normalized AgentConfig
	fn parse_config(&self, content: &str) -> Result<AgentConfig>;

	/// Serialize normalized AgentConfig into agent-specific format
	/// The original_content is provided to allow safe merging that preserves unknown fields
	fn serialize_config(
		&self,
		config: &AgentConfig,
		original_content: Option<&str>,
	) -> Result<String>;

	// Get the CLI command to validate config
	fn validate_command(&self, config_path: &Path) -> Command;

	/// Whether this agent supports MCP enable/disable operations
	// Map-based adapters don't preserve enabled state, returns false
	fn supports_mcp_enable_disable(&self) -> bool {
		true // Default to true for most agents
	}
}

pub fn create_adapter(agent_type: crate::AgentType) -> Box<dyn AgentAdapter> {
	use crate::paths;
	match agent_type {
		crate::AgentType::Cursor => Box::new(MapAdapter::with_paths(
			"cursor",
			paths::cursor_global_path,
			paths::cursor_project_path,
		)),
		crate::AgentType::Windsurf => Box::new(MapAdapter::with_paths(
			"windsurf",
			paths::windsurf_global_path,
			paths::windsurf_project_path,
		)),
		crate::AgentType::Copilot => Box::new(MapAdapter::with_paths_and_key(
			"copilot",
			paths::copilot_global_path,
			paths::copilot_project_path,
			"servers",
		)),
		crate::AgentType::Claude => Box::new(MapAdapter::with_paths(
			"claude",
			paths::claude_global_path,
			paths::claude_project_path,
		)),
		crate::AgentType::RooCode => Box::new(MapAdapter::with_paths(
			"roocode",
			paths::roocode_global_path,
			paths::roocode_project_path,
		)),
		crate::AgentType::Cline => Box::new(MapAdapter::with_paths(
			"cline",
			paths::cline_global_path,
			paths::cline_project_path,
		)),
		crate::AgentType::Aider => Box::new(MapAdapter::with_paths(
			"aider",
			paths::aider_global_path,
			paths::aider_project_path,
		)),
		crate::AgentType::Gemini => Box::new(MapAdapter::with_paths(
			"gemini",
			paths::gemini_global_path,
			paths::gemini_project_path,
		)),
		crate::AgentType::Codex => Box::new(TomlAdapter::with_paths(
			"codex",
			paths::codex_global_path,
			paths::codex_project_path,
		)),
		crate::AgentType::Antigravity => Box::new(MapAdapter::with_paths(
			"antigravity",
			paths::antigravity_global_path,
			paths::antigravity_project_path,
		)),
		crate::AgentType::Openclaw => Box::new(MapAdapter::with_paths(
			"openclaw",
			paths::openclaw_global_path,
			paths::openclaw_project_path,
		)),
		crate::AgentType::OpenCode => Box::new(ListAdapter::with_paths(
			"opencode",
			paths::opencode_global_path,
			paths::opencode_project_path,
		)),
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::AgentType;

	#[test]
	fn test_create_adapter_claude() {
		let adapter = create_adapter(AgentType::Claude);
		assert_eq!(adapter.name(), "claude");
	}

	#[test]
	fn test_create_adapter_opencode() {
		let adapter = create_adapter(AgentType::OpenCode);
		assert_eq!(adapter.name(), "opencode");
	}
}
