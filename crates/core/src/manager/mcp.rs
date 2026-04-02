use super::ConfigManager;
use crate::{
	errors::{ConfigError, Result},
	models::McpServer,
};
use log::info;

impl ConfigManager {
	pub fn add_mcp(&mut self, mcp: McpServer) -> Result<()> {
		if !self.adapter.supports_mcp_operations() {
			return Err(ConfigError::unsupported_operation(
				"add",
				"MCP server",
				self.adapter.name(),
			));
		}
		let agent_name = self.adapter.name().to_string();
		let config = self.config_mut()?;
		if config.mcps.iter().any(|m| m.name == mcp.name) {
			return Err(ConfigError::resource_exists("MCP server", &mcp.name));
		}
		info!("adding MCP '{}' for agent '{}'", mcp.name, agent_name);
		config.mcps.push(mcp);
		self.save_current()
	}

	pub fn get_mcp(&self, name: &str) -> Option<&McpServer> {
		self.config.as_ref()?.mcps.iter().find(|m| m.name == name)
	}

	pub fn update_mcp(&mut self, name: &str, mcp: McpServer) -> Result<()> {
		if !self.adapter.supports_mcp_operations() {
			return Err(ConfigError::unsupported_operation(
				"update",
				"MCP server",
				self.adapter.name(),
			));
		}
		let agent_name = self.adapter.name().to_string();
		let config = self.config_mut()?;
		let index =
			config.mcps.iter().position(|m| m.name == name).ok_or_else(
				|| ConfigError::resource_not_found("MCP server", name),
			)?;
		info!("updating MCP '{}' for agent '{}'", name, agent_name);
		config.mcps[index] = mcp;
		self.save_current()
	}

	pub fn remove_mcp(&mut self, name: &str) -> Result<()> {
		if !self.adapter.supports_mcp_operations() {
			return Err(ConfigError::unsupported_operation(
				"remove",
				"MCP server",
				self.adapter.name(),
			));
		}
		let agent_name = self.adapter.name().to_string();
		let config = self.config_mut()?;
		let index =
			config.mcps.iter().position(|m| m.name == name).ok_or_else(
				|| ConfigError::resource_not_found("MCP server", name),
			)?;
		info!("removing MCP '{}' for agent '{}'", name, agent_name);
		config.mcps.remove(index);
		self.save_current()
	}

	fn set_mcp_enabled(&mut self, name: &str, enabled: bool) -> Result<()> {
		if !self.adapter.supports_mcp_enable_disable() {
			return Err(ConfigError::unsupported_operation(
				if enabled { "enable" } else { "disable" },
				"MCP server",
				self.adapter.name(),
			));
		}
		let agent_name = self.adapter.name().to_string();
		let config = self.config_mut()?;
		let mcp = config.mcps.iter_mut().find(|m| m.name == name).ok_or_else(
			|| ConfigError::resource_not_found("MCP server", name),
		)?;
		info!(
			"setting MCP '{}' enabled={} for agent '{}'",
			name, enabled, agent_name
		);
		mcp.enabled = enabled;
		self.save_current()
	}

	pub fn disable_mcp(&mut self, name: &str) -> Result<()> {
		self.set_mcp_enabled(name, false)
	}

	pub fn enable_mcp(&mut self, name: &str) -> Result<()> {
		self.set_mcp_enabled(name, true)
	}
}
