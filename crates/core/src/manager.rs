use crate::{
    adapters::AgentAdapter,
    errors::{ConfigError, Result},
    models::{AgentConfig, McpServer, Skill, SubAgent},
    convert_skill,
};
use std::path::{Path, PathBuf};

/// Manages configuration loading, saving, and CRUD operations
pub struct ConfigManager {
    adapter: Box<dyn AgentAdapter>,
    config_path: PathBuf,
    config: Option<AgentConfig>,
}

impl ConfigManager {
    /// Create with default path (production use)
    pub fn new(adapter: Box<dyn AgentAdapter>, global: bool, project_root: Option<&Path>) -> Self {
        let config_path = if global {
            adapter.global_config_path()
        } else if let Some(root) = project_root {
            adapter.project_config_path(root)
        } else {
            adapter.global_config_path()
        };
        Self {
            adapter,
            config_path,
            config: None,
        }
    }

    /// Create with custom path (testing use)
    pub fn with_path(adapter: Box<dyn AgentAdapter>, config_path: PathBuf) -> Self {
        Self {
            adapter,
            config_path,
            config: None,
        }
    }

    /// Get the configuration file path
    pub fn config_path(&self) -> &Path {
        &self.config_path
    }

    /// Get the agent adapter name
    pub fn agent_name(&self) -> &str {
        self.adapter.name()
    }

    /// Load configuration from file
    pub fn load(&mut self) -> Result<&AgentConfig> {
        let content = match std::fs::read_to_string(&self.config_path) {
            Ok(content) => content,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(ConfigError::not_found(&self.config_path))
            }
            Err(e) => return Err(e.into()),
        };

        let config = self.adapter.parse_config(&content)?;
        self.config = Some(config);
        Ok(self.config.as_ref().unwrap())
    }

    /// Save configuration to file
    pub fn save(&self, config: &AgentConfig) -> Result<()> {
        // Ensure parent directory exists
        if let Some(parent) = self.config_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // Try to read existing content to preserve unknown fields
        let original_content = std::fs::read_to_string(&self.config_path).ok();
        
        let content = self.adapter.serialize_config(config, original_content.as_deref())?;
        std::fs::write(&self.config_path, content)?;
        Ok(())
    }

    /// Save the currently loaded configuration
    pub fn save_current(&self) -> Result<()> {
        match &self.config {
            Some(config) => self.save(config),
            None => Err(ConfigError::InvalidConfig(
                "No configuration loaded".to_string(),
            )),
        }
    }

    /// Validate configuration by running the actual agent
    pub fn validate(&self) -> Result<()> {
        let output = self.adapter.validate_command(&self.config_path).output()?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(ConfigError::ValidationFailed(stderr.to_string()));
        }
        Ok(())
    }

    /// Get the loaded configuration (must call load() first)
    pub fn config(&self) -> Option<&AgentConfig> {
        self.config.as_ref()
    }

    /// Initialize an empty configuration if none exists
    pub fn init_empty_config(&mut self) {
        if self.config.is_none() {
            self.config = Some(AgentConfig::new());
        }
    }

    /// Get mutable reference to loaded configuration
    fn config_mut(&mut self) -> Result<&mut AgentConfig> {
        self.config
            .as_mut()
            .ok_or_else(|| ConfigError::InvalidConfig("No configuration loaded".to_string()))
    }

    // ==================== Skills CRUD ====================

    /// Add a skill
    pub fn add_skill(&mut self, skill: Skill) -> Result<()> {
        let config = self.config_mut()?;

        if config.skills.iter().any(|s| s.name == skill.name) {
            return Err(ConfigError::resource_exists("skill", &skill.name));
        }

        config.skills.push(skill);
        self.save_current()
    }

    /// Get a skill by name
    pub fn get_skill(&self, name: &str) -> Option<&Skill> {
        self.config.as_ref()?.skills.iter().find(|s| s.name == name)
    }

    /// Update a skill
    pub fn update_skill(&mut self, name: &str, skill: Skill) -> Result<()> {
        let config = self.config_mut()?;

        let index = config
            .skills
            .iter()
            .position(|s| s.name == name)
            .ok_or_else(|| ConfigError::resource_not_found("skill", name))?;

        config.skills[index] = skill;
        self.save_current()
    }

    /// Remove a skill permanently
    pub fn remove_skill(&mut self, name: &str) -> Result<()> {
        let config = self.config_mut()?;

        let index = config
            .skills
            .iter()
            .position(|s| s.name == name)
            .ok_or_else(|| ConfigError::resource_not_found("skill", name))?;

        config.skills.remove(index);
        self.save_current()
    }

    /// Disable a skill (keeps it in config but marks as disabled)
    pub fn disable_skill(&mut self, name: &str) -> Result<()> {
        let config = self.config_mut()?;

        let skill = config
            .skills
            .iter_mut()
            .find(|s| s.name == name)
            .ok_or_else(|| ConfigError::resource_not_found("skill", name))?;

        skill.enabled = false;
        self.save_current()
    }

    /// Enable a previously disabled skill
    pub fn enable_skill(&mut self, name: &str) -> Result<()> {
        let config = self.config_mut()?;

        let skill = config
            .skills
            .iter_mut()
            .find(|s| s.name == name)
            .ok_or_else(|| ConfigError::resource_not_found("skill", name))?;

        skill.enabled = true;
        self.save_current()
    }

    /// Parse a skill from a path (directory, .skill file, or SKILL.md) and add it
    pub fn add_skill_from_path(&mut self, path: &Path) -> Result<Skill> {
        // Use skill crate to parse
        let skill_pkg = skill::parser::parse(path)
            .map_err(|e| ConfigError::InvalidConfig(format!("Failed to parse skill: {}", e)))?;

        // Convert to core Skill
        let skill = convert_skill(skill_pkg);

        // Add to config
        self.add_skill(skill.clone())?;

        Ok(skill)
    }

    /// Validate a skill path and return any validation errors
    pub fn validate_skill_path(&self, path: &Path) -> Vec<String> {
        let mut errors = Vec::new();

        if !path.exists() {
            errors.push(format!("Path does not exist: {}", path.display()));
            return errors;
        }

        match skill::parser::parse(path) {
            Ok(_) => {}
            Err(e) => errors.push(format!("Parse error: {}", e)),
        }

        errors
    }

    // ==================== MCPs CRUD ====================

    /// Add an MCP server
    pub fn add_mcp(&mut self, mcp: McpServer) -> Result<()> {
        let config = self.config_mut()?;

        if config.mcps.iter().any(|m| m.name == mcp.name) {
            return Err(ConfigError::resource_exists("MCP server", &mcp.name));
        }

        config.mcps.push(mcp);
        self.save_current()
    }

    /// Get an MCP server by name
    pub fn get_mcp(&self, name: &str) -> Option<&McpServer> {
        self.config.as_ref()?.mcps.iter().find(|m| m.name == name)
    }

    /// Update an MCP server
    pub fn update_mcp(&mut self, name: &str, mcp: McpServer) -> Result<()> {
        let config = self.config_mut()?;

        let index = config
            .mcps
            .iter()
            .position(|m| m.name == name)
            .ok_or_else(|| ConfigError::resource_not_found("MCP server", name))?;

        config.mcps[index] = mcp;
        self.save_current()
    }

    /// Remove an MCP server permanently
    pub fn remove_mcp(&mut self, name: &str) -> Result<()> {
        let config = self.config_mut()?;

        let index = config
            .mcps
            .iter()
            .position(|m| m.name == name)
            .ok_or_else(|| ConfigError::resource_not_found("MCP server", name))?;

        config.mcps.remove(index);
        self.save_current()
    }

    /// Disable an MCP server
    pub fn disable_mcp(&mut self, name: &str) -> Result<()> {
        if !self.adapter.supports_mcp_enable_disable() {
            return Err(ConfigError::unsupported_operation(
                "disable",
                "MCP server",
                self.adapter.name(),
            ));
        }

        let config = self.config_mut()?;

        let mcp = config
            .mcps
            .iter_mut()
            .find(|m| m.name == name)
            .ok_or_else(|| ConfigError::resource_not_found("MCP server", name))?;

        mcp.enabled = false;
        self.save_current()
    }

    /// Enable a previously disabled MCP server
    pub fn enable_mcp(&mut self, name: &str) -> Result<()> {
        if !self.adapter.supports_mcp_enable_disable() {
            return Err(ConfigError::unsupported_operation(
                "enable",
                "MCP server",
                self.adapter.name(),
            ));
        }

        let config = self.config_mut()?;

        let mcp = config
            .mcps
            .iter_mut()
            .find(|m| m.name == name)
            .ok_or_else(|| ConfigError::resource_not_found("MCP server", name))?;

        mcp.enabled = true;
        self.save_current()
    }

    // ==================== Sub-agents CRUD ====================

    /// Add a sub-agent
    pub fn add_sub_agent(&mut self, agent: SubAgent) -> Result<()> {
        let config = self.config_mut()?;

        if config.sub_agents.iter().any(|a| a.name == agent.name) {
            return Err(ConfigError::resource_exists("sub-agent", &agent.name));
        }

        config.sub_agents.push(agent);
        self.save_current()
    }

    /// Get a sub-agent by name
    pub fn get_sub_agent(&self, name: &str) -> Option<&SubAgent> {
        self.config
            .as_ref()?
            .sub_agents
            .iter()
            .find(|a| a.name == name)
    }

    /// Update a sub-agent
    pub fn update_sub_agent(&mut self, name: &str, agent: SubAgent) -> Result<()> {
        let config = self.config_mut()?;

        let index = config
            .sub_agents
            .iter()
            .position(|a| a.name == name)
            .ok_or_else(|| ConfigError::resource_not_found("sub-agent", name))?;

        config.sub_agents[index] = agent;
        self.save_current()
    }

    /// Remove a sub-agent permanently
    pub fn remove_sub_agent(&mut self, name: &str) -> Result<()> {
        let config = self.config_mut()?;

        let index = config
            .sub_agents
            .iter()
            .position(|a| a.name == name)
            .ok_or_else(|| ConfigError::resource_not_found("sub-agent", name))?;

        config.sub_agents.remove(index);
        self.save_current()
    }

    /// Disable a sub-agent
    pub fn disable_sub_agent(&mut self, name: &str) -> Result<()> {
        let config = self.config_mut()?;

        let agent = config
            .sub_agents
            .iter_mut()
            .find(|a| a.name == name)
            .ok_or_else(|| ConfigError::resource_not_found("sub-agent", name))?;

        agent.enabled = false;
        self.save_current()
    }

    /// Enable a previously disabled sub-agent
    pub fn enable_sub_agent(&mut self, name: &str) -> Result<()> {
        let config = self.config_mut()?;

        let agent = config
            .sub_agents
            .iter_mut()
            .find(|a| a.name == name)
            .ok_or_else(|| ConfigError::resource_not_found("sub-agent", name))?;

        agent.enabled = true;
        self.save_current()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::{ClaudeAdapter, OpenCodeAdapter};
    use crate::models::McpTransport;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn create_test_manager() -> (ConfigManager, NamedTempFile) {
        let mut temp_file = NamedTempFile::new().unwrap();
        writeln!(temp_file, "{{\"mcpServers\": {{}}, \"skills\": {{}}}}").unwrap();

        let adapter = Box::new(ClaudeAdapter::new());
        let manager = ConfigManager::with_path(adapter, temp_file.path().to_path_buf());
        (manager, temp_file)
    }

    fn create_test_manager_opencode() -> (ConfigManager, NamedTempFile) {
        let mut temp_file = NamedTempFile::new().unwrap();
        writeln!(
            temp_file,
            "{{\"mcp_servers\": [], \"skills\": [], \"sub_agents\": []}}"
        )
        .unwrap();

        let adapter = Box::new(OpenCodeAdapter::new());
        let manager = ConfigManager::with_path(adapter, temp_file.path().to_path_buf());
        (manager, temp_file)
    }

    #[test]
    fn test_load_and_save() {
        let (mut manager, _temp) = create_test_manager();

        manager.load().unwrap();
        assert!(manager.config().is_some());
    }

    #[test]
    fn test_skill_crud() {
        let (mut manager, _temp) = create_test_manager();
        manager.load().unwrap();

        // Add
        let skill = Skill::new("test-skill");
        manager.add_skill(skill.clone()).unwrap();
        assert!(manager.get_skill("test-skill").is_some());

        // Get
        let retrieved = manager.get_skill("test-skill").unwrap();
        assert_eq!(retrieved.name, "test-skill");
        assert!(retrieved.enabled);

        // Update
        let mut updated = skill.clone();
        updated.description = Some("Updated".to_string());
        manager.update_skill("test-skill", updated).unwrap();
        let retrieved = manager.get_skill("test-skill").unwrap();
        assert_eq!(retrieved.description, Some("Updated".to_string()));

        // Disable
        manager.disable_skill("test-skill").unwrap();
        let retrieved = manager.get_skill("test-skill").unwrap();
        assert!(!retrieved.enabled);

        // Enable
        manager.enable_skill("test-skill").unwrap();
        let retrieved = manager.get_skill("test-skill").unwrap();
        assert!(retrieved.enabled);

        // Remove
        manager.remove_skill("test-skill").unwrap();
        assert!(manager.get_skill("test-skill").is_none());
    }

    #[test]
    fn test_mcp_crud() {
        // Use OpenCode adapter since it supports MCP enable/disable
        let (mut manager, _temp) = create_test_manager_opencode();
        manager.load().unwrap();

        // Add
        let mcp = McpServer::new(
            "test-mcp",
            McpTransport::stdio("echo", vec!["hello".to_string()]),
        );
        manager.add_mcp(mcp.clone()).unwrap();
        assert!(manager.get_mcp("test-mcp").is_some());

        // Update
        let updated = McpServer::new(
            "test-mcp",
            McpTransport::stdio("echo", vec!["updated".to_string()]),
        );
        manager.update_mcp("test-mcp", updated).unwrap();

        // Disable/Enable
        manager.disable_mcp("test-mcp").unwrap();
        assert!(!manager.get_mcp("test-mcp").unwrap().enabled);

        manager.enable_mcp("test-mcp").unwrap();
        assert!(manager.get_mcp("test-mcp").unwrap().enabled);

        // Remove
        manager.remove_mcp("test-mcp").unwrap();
        assert!(manager.get_mcp("test-mcp").is_none());
    }

    #[test]
    fn test_duplicate_resource_fails() {
        let (mut manager, _temp) = create_test_manager();
        manager.load().unwrap();

        let skill = Skill::new("duplicate");
        manager.add_skill(skill.clone()).unwrap();

        let result = manager.add_skill(skill);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Resource already exists"));
    }

    #[test]
    fn test_missing_resource_fails() {
        let (mut manager, _temp) = create_test_manager();
        manager.load().unwrap();

        let result = manager.remove_skill("nonexistent");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Resource not found"));
    }
}
