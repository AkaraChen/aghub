use crate::{errors::Result, models::{AgentConfig, ResourceScope}};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Trait for adapting different agent configuration formats
pub trait AgentAdapter: Send + Sync {
	fn name(&self) -> &'static str;
	fn global_config_path(&self) -> PathBuf;
	fn project_config_path(&self, project_root: &Path) -> PathBuf;
	fn parse_config(&self, content: &str) -> Result<AgentConfig>;
	/// Parse config with resource scope and project root
	fn parse_config_with_scope(
		&self,
		content: &str,
		_project_root: Option<&Path>,
		_scope: ResourceScope,
	) -> Result<AgentConfig> {
		// Default implementation ignores scope and uses original parse_config
		self.parse_config(content)
	}
	fn serialize_config(
		&self,
		config: &AgentConfig,
		original_content: Option<&str>,
	) -> Result<String>;
	fn validate_command(&self, config_path: &Path) -> Command;
	fn supports_mcp_enable_disable(&self) -> bool {
		true
	}
}

pub fn create_adapter(agent_type: crate::AgentType) -> Box<dyn AgentAdapter> {
	Box::new(crate::registry::get(agent_type))
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

	#[test]
	fn test_create_adapter_kiro() {
		let adapter = create_adapter(AgentType::Kiro);
		assert_eq!(adapter.name(), "kiro");
	}
}
