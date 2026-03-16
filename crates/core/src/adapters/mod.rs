use crate::{errors::Result, models::AgentConfig};
use std::path::{Path, PathBuf};
use std::process::Command;

pub mod claude;
pub mod opencode;

pub use claude::ClaudeAdapter;
pub use opencode::OpenCodeAdapter;

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
    fn serialize_config(&self, config: &AgentConfig) -> Result<String>;

    /// Get the CLI command to validate config (e.g., "claude --settings <path> --version")
    fn validate_command(&self, config_path: &Path) -> Command;
}

/// Create an adapter for the given agent type
pub fn create_adapter(agent_type: crate::AgentType) -> Box<dyn AgentAdapter> {
    match agent_type {
        crate::AgentType::Claude => Box::new(ClaudeAdapter::new()),
        crate::AgentType::OpenCode => Box::new(OpenCodeAdapter::new()),
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
