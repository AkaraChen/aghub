use crate::{eprintln_verbose, ResourceType};
use aghub_core::{
	errors::ConfigError, manager::ConfigManager, models::McpTransport,
};
use anyhow::Result;

use super::parse_mcp_transport;

#[allow(clippy::too_many_arguments)]
pub fn execute(
	manager: &mut ConfigManager,
	resource: ResourceType,
	name: String,
	command: Option<String>,
	url: Option<String>,
	transport: String,
	headers: Vec<String>,
	env_vars: Vec<String>,
	description: Option<String>,
	author: Option<String>,
	version: Option<String>,
	tools: Vec<String>,
) -> Result<()> {
	match resource {
		ResourceType::Skills => {
			eprintln_verbose!("Updating skill: {}", name);
			// Get existing skill
			let existing = manager.get_skill(&name).ok_or_else(|| {
				ConfigError::resource_not_found("skill", &name)
			})?;

			let mut skill = existing.clone();

			// Update fields if provided
			if let Some(desc) = description {
				skill.description = Some(desc);
			}
			if let Some(auth) = author {
				skill.author = Some(auth);
			}
			if let Some(ver) = version {
				skill.version = Some(ver);
			}
			if !tools.is_empty() {
				skill.tools = tools;
			}

			manager.update_skill(&name, skill.clone())?;
			eprintln_verbose!("Skill updated successfully");
			println!("{}", serde_json::to_string_pretty(&skill)?);
		}
		ResourceType::Mcps => {
			eprintln_verbose!("Updating MCP server: {}", name);
			// Get existing MCP
			let existing = manager.get_mcp(&name).ok_or_else(|| {
				ConfigError::resource_not_found("MCP server", &name)
			})?;

			let mut mcp = existing.clone();

			// Preserve existing timeout
			let existing_timeout = match &mcp.transport {
				McpTransport::Stdio { timeout, .. } => *timeout,
				McpTransport::Sse { timeout, .. } => *timeout,
				McpTransport::StreamableHttp { timeout, .. } => *timeout,
			};

			// Update transport if command or URL provided
			if let Some(new_transport) = parse_mcp_transport(
				command,
				url,
				&transport,
				headers,
				env_vars,
				existing_timeout,
			)? {
				mcp.transport = new_transport;
			}

			manager.update_mcp(&name, mcp.clone())?;
			eprintln_verbose!("MCP server updated successfully");
			println!("{}", serde_json::to_string_pretty(&mcp)?);
		}
	}

	Ok(())
}
