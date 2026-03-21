use crate::{
	adapters::{create_adapter, AgentAdapter},
	errors::{ConfigError, Result},
	manager::ConfigManager,
	registry,
	AgentType,
};
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

/// Test configuration for isolated testing
pub struct TestConfig {
	temp_dir: TempDir,
	config_path: PathBuf,
	skills_dir: PathBuf,
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
		let descriptor = registry::get(agent_type);
		let temp_dir = TempDir::new().map_err(ConfigError::Io)?;

		// Determine config file format based on agent type
		let is_toml = matches!(agent_type, AgentType::Codex | AgentType::Mistral);
		let is_json_list = matches!(agent_type, AgentType::OpenCode);

		let config_path = if is_toml {
			temp_dir.path().join("config.toml")
		} else {
			temp_dir.path().join("settings.json")
		};

		let initial_config = if is_json_list {
			r#"{"mcp_servers": [], "skills": []}"#
		} else if is_toml {
			""
		} else {
			r#"{"mcpServers": {}, "skills": {}}"#
		};

		fs::write(&config_path, initial_config).map_err(ConfigError::Io)?;

		let skills_dir = temp_dir.path().join("skills");
		if descriptor.capabilities.skills {
			fs::create_dir(&skills_dir).map_err(ConfigError::Io)?;
			crate::adapter::set_skills_path_override(
				descriptor.id,
				Some(skills_dir.clone()),
			);
		}

		Ok(Self {
			temp_dir,
			config_path,
			skills_dir,
			agent_type,
		})
	}

	pub fn config_path(&self) -> &Path {
		&self.config_path
	}

	pub fn temp_dir(&self) -> &Path {
		self.temp_dir.path()
	}

	pub fn skills_dir(&self) -> &Path {
		&self.skills_dir
	}

	pub fn agent_type(&self) -> AgentType {
		self.agent_type
	}

	pub fn create_test_skill(
		&self,
		name: &str,
		description: Option<&str>,
	) -> Result<()> {
		let descriptor = registry::get(self.agent_type);
		if !descriptor.capabilities.skills {
			return Ok(());
		}

		let skill_dir = self.skills_dir.join(name);
		fs::create_dir(&skill_dir).map_err(ConfigError::Io)?;

		let skill_md_content = match description {
			Some(desc) => format!(
				"---\nname: {}\ndescription: {}\n---\n\n# {}\n",
				name, desc, name
			),
			None => format!("---\nname: {}\n---\n\n# {}\n", name, name),
		};

		fs::write(skill_dir.join("SKILL.md"), skill_md_content)
			.map_err(ConfigError::Io)?;
		Ok(())
	}

	pub fn create_manager(&self) -> ConfigManager {
		let adapter = create_adapter(self.agent_type);
		ConfigManager::with_path(adapter, self.config_path.clone())
	}

	pub fn create_adapter(&self) -> Box<dyn AgentAdapter> {
		create_adapter(self.agent_type)
	}

	pub fn write_config(&self, content: &str) -> Result<()> {
		fs::write(&self.config_path, content).map_err(ConfigError::Io)
	}

	pub fn read_config(&self) -> Result<String> {
		fs::read_to_string(&self.config_path).map_err(ConfigError::Io)
	}

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

impl Drop for TestConfig {
	fn drop(&mut self) {
		let descriptor = registry::get(self.agent_type);
		if descriptor.capabilities.skills {
			crate::adapter::set_skills_path_override(descriptor.id, None);
		}
	}
}

/// Builder pattern for creating test configurations with custom initial state
pub struct TestConfigBuilder {
	agent_type: AgentType,
	initial_content: Option<String>,
}

impl TestConfigBuilder {
	pub fn new(agent_type: AgentType) -> Self {
		Self {
			agent_type,
			initial_content: None,
		}
	}

	pub fn with_content(mut self, content: impl Into<String>) -> Self {
		self.initial_content = Some(content.into());
		self
	}

	pub fn build(self) -> Result<TestConfig> {
		let temp_dir = TempDir::new().map_err(ConfigError::Io)?;

		// Determine config file format based on agent type
		let is_toml = matches!(self.agent_type, AgentType::Codex | AgentType::Mistral);
		let is_json_list = matches!(self.agent_type, AgentType::OpenCode);

		let config_path = if is_toml {
			temp_dir.path().join("config.toml")
		} else {
			temp_dir.path().join("settings.json")
		};

		let content = self.initial_content.unwrap_or_else(|| {
			if is_json_list {
				r#"{"mcp_servers": [], "skills": []}"#.to_string()
			} else if is_toml {
				String::new()
			} else {
				r#"{"mcpServers": {}, "skills": {}}"#.to_string()
			}
		});

		fs::write(&config_path, content).map_err(ConfigError::Io)?;

		let descriptor = registry::get(self.agent_type);
		let skills_dir = temp_dir.path().join("skills");
		if descriptor.capabilities.skills {
			fs::create_dir(&skills_dir).map_err(ConfigError::Io)?;
			crate::adapter::set_skills_path_override(
				descriptor.id,
				Some(skills_dir.clone()),
			);
		}

		Ok(TestConfig {
			temp_dir,
			config_path,
			skills_dir,
			agent_type: self.agent_type,
		})
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::models::{McpServer, McpTransport};

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
		let mcp = McpServer::new(
			"test",
			McpTransport::stdio("echo", vec!["hello".to_string()]),
		);
		manager.add_mcp(mcp).unwrap();
		let content = test.read_config().unwrap();
		assert!(content.contains("test"));
		assert!(content.contains("echo"));
	}

	#[test]
	fn test_isolated_configs() {
		let test1 = TestConfig::new(AgentType::Claude).unwrap();
		let test2 = TestConfig::new(AgentType::Claude).unwrap();
		assert_ne!(test1.config_path(), test2.config_path());
		let mut manager1 = test1.create_manager();
		manager1.load().unwrap();
		manager1
			.add_mcp(McpServer::new(
				"mcp1",
				McpTransport::stdio("echo", vec!["1".to_string()]),
			))
			.unwrap();
		let content2 = test2.read_config().unwrap();
		assert!(!content2.contains("mcp1"));
	}
}
