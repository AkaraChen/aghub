use crate::{
    adapters::{create_adapter, AgentAdapter},
    errors::{ConfigError, Result},
    manager::ConfigManager,
    AgentType,
};
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

/// Test configuration for isolated testing
///
/// This struct creates a temporary directory with an isolated configuration
/// that can be used for testing without polluting the global environment.
pub struct TestConfig {
    temp_dir: TempDir,
    config_path: PathBuf,
    agent_type: AgentType,
}

impl TestConfig {
    /// Create a new test configuration for the given agent type
    ///
    /// # Example
    /// ```
    /// use aghub_core::{testing::TestConfig, AgentType};
    ///
    /// let test = TestConfig::new(AgentType::Claude).unwrap();
    /// let config_path = test.config_path();
    /// ```
    pub fn new(agent_type: AgentType) -> Result<Self> {
        let temp_dir = TempDir::new().map_err(ConfigError::Io)?;
        let config_path = temp_dir.path().join("settings.json");

        // Create minimal valid config for the agent type
        let initial_config = match agent_type {
            AgentType::Claude => r#"{"mcpServers": {}, "skills": {}}"#,
            AgentType::OpenCode => r#"{"mcp_servers": [], "skills": [], "sub_agents": []}"#,
        };

        fs::write(&config_path, initial_config).map_err(ConfigError::Io)?;

        Ok(Self {
            temp_dir,
            config_path,
            agent_type,
        })
    }

    /// Get the path to the temporary configuration file
    pub fn config_path(&self) -> &Path {
        &self.config_path
    }

    /// Get the temporary directory path
    pub fn temp_dir(&self) -> &Path {
        self.temp_dir.path()
    }

    /// Get the agent type
    pub fn agent_type(&self) -> AgentType {
        self.agent_type
    }

    /// Create a ConfigManager using this test configuration
    pub fn create_manager(&self) -> ConfigManager {
        let adapter = create_adapter(self.agent_type);
        ConfigManager::with_path(adapter, self.config_path.clone())
    }

    /// Create an adapter for this test configuration
    pub fn create_adapter(&self) -> Box<dyn AgentAdapter> {
        create_adapter(self.agent_type)
    }

    /// Write raw content to the config file
    pub fn write_config(&self, content: &str) -> Result<()> {
        fs::write(&self.config_path, content).map_err(ConfigError::Io)
    }

    /// Read raw content from the config file
    pub fn read_config(&self) -> Result<String> {
        fs::read_to_string(&self.config_path).map_err(ConfigError::Io)
    }

    /// Validate the configuration using the actual agent CLI
    ///
    /// This runs the agent with --settings flag to verify the config is valid.
    /// Requires the agent CLI to be installed.
    pub fn validate_with_agent(&self) -> Result<()> {
        let adapter = self.create_adapter();
        let output = adapter
            .validate_command(&self.config_path)
            .output()
            .map_err(ConfigError::Io)?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(ConfigError::ValidationFailed(stderr.to_string()));
        }

        Ok(())
    }
}

/// Builder pattern for creating test configurations with custom initial state
pub struct TestConfigBuilder {
    agent_type: AgentType,
    initial_content: Option<String>,
}

impl TestConfigBuilder {
    /// Create a new builder for the given agent type
    pub fn new(agent_type: AgentType) -> Self {
        Self {
            agent_type,
            initial_content: None,
        }
    }

    /// Set the initial configuration content
    pub fn with_content(mut self, content: impl Into<String>) -> Self {
        self.initial_content = Some(content.into());
        self
    }

    /// Build the test configuration
    pub fn build(self) -> Result<TestConfig> {
        let temp_dir = TempDir::new().map_err(ConfigError::Io)?;
        let config_path = temp_dir.path().join("settings.json");

        let content = self
            .initial_content
            .unwrap_or_else(|| match self.agent_type {
                AgentType::Claude => r#"{"mcpServers": {}, "skills": {}}"#.to_string(),
                AgentType::OpenCode => {
                    r#"{"mcp_servers": [], "skills": [], "sub_agents": []}"#.to_string()
                }
            });

        fs::write(&config_path, content).map_err(ConfigError::Io)?;

        Ok(TestConfig {
            temp_dir,
            config_path,
            agent_type: self.agent_type,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{McpServer, McpTransport, Skill};

    #[test]
    fn test_test_config_creation() {
        let test = TestConfig::new(AgentType::Claude).unwrap();
        assert!(test.config_path().exists());
        assert!(test
            .config_path()
            .to_string_lossy()
            .contains("settings.json"));
    }

    #[test]
    fn test_test_config_builder() {
        let test = TestConfigBuilder::new(AgentType::OpenCode)
            .with_content(
                r#"{"mcp_servers": [{"name": "test", "type": "stdio", "command": "echo"}]}"#,
            )
            .build()
            .unwrap();

        let content = test.read_config().unwrap();
        assert!(content.contains("test"));
    }

    #[test]
    fn test_create_manager() {
        let test = TestConfig::new(AgentType::Claude).unwrap();
        let mut manager = test.create_manager();

        manager.load().unwrap();
        assert!(manager.config().is_some());
    }

    #[test]
    fn test_crud_with_manager() {
        let test = TestConfig::new(AgentType::Claude).unwrap();
        let mut manager = test.create_manager();

        manager.load().unwrap();

        // Add MCP
        let mcp = McpServer::new(
            "test",
            McpTransport::command("echo", vec!["hello".to_string()]),
        );
        manager.add_mcp(mcp).unwrap();

        // Verify file was updated
        let content = test.read_config().unwrap();
        assert!(content.contains("test"));
        assert!(content.contains("echo"));

        // Add skill
        let skill = Skill::new("my-skill");
        manager.add_skill(skill).unwrap();

        let content = test.read_config().unwrap();
        assert!(content.contains("my-skill"));
    }

    #[test]
    fn test_isolated_configs() {
        let test1 = TestConfig::new(AgentType::Claude).unwrap();
        let test2 = TestConfig::new(AgentType::Claude).unwrap();

        // Ensure they have different paths
        assert_ne!(test1.config_path(), test2.config_path());

        // Modify test1
        let mut manager1 = test1.create_manager();
        manager1.load().unwrap();
        manager1
            .add_mcp(McpServer::new(
                "mcp1",
                McpTransport::command("echo", vec!["1".to_string()]),
            ))
            .unwrap();

        // test2 should be unaffected
        let content2 = test2.read_config().unwrap();
        assert!(!content2.contains("mcp1"));
    }
}
