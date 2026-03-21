use crate::{eprintln_verbose, ResourceType};
use aghub_core::{
	errors::ConfigError, manager::ConfigManager, models::McpTransport,
};
use anyhow::{bail, Result};
use std::collections::HashMap;

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

			// Update transport if command or URL provided
			if let Some(cmd_str) = command {
				let parts: Vec<String> =
					cmd_str.split_whitespace().map(String::from).collect();
				if parts.is_empty() {
					bail!("Command cannot be empty");
				}
				let command = parts[0].clone();
				let args = parts.into_iter().skip(1).collect();

				let env = if env_vars.is_empty() {
					None
				} else {
					let mut env_map = HashMap::new();
					for env_var in env_vars {
						let parts: Vec<_> = env_var.splitn(2, '=').collect();
						if parts.len() == 2 {
							env_map.insert(
								parts[0].to_string(),
								parts[1].to_string(),
							);
						}
					}
					Some(env_map)
				};

				// Preserve existing timeout or use None
				let timeout = match &mcp.transport {
					McpTransport::Stdio { timeout, .. } => *timeout,
					McpTransport::Sse { timeout, .. } => *timeout,
					McpTransport::StreamableHttp { timeout, .. } => *timeout,
				};

				mcp.transport = McpTransport::Stdio {
					command,
					args,
					env,
					timeout,
				};
			} else if let Some(url_str) = url {
				let headers_map = if headers.is_empty() {
					None
				} else {
					let mut map = HashMap::new();
					for header in headers {
						let parts: Vec<_> = header.splitn(2, ':').collect();
						if parts.len() == 2 {
							map.insert(
								parts[0].trim().to_string(),
								parts[1].trim().to_string(),
							);
						}
					}
					Some(map)
				};

				// Preserve existing timeout or use None
				let timeout = match &mcp.transport {
					McpTransport::Stdio { timeout, .. } => *timeout,
					McpTransport::Sse { timeout, .. } => *timeout,
					McpTransport::StreamableHttp { timeout, .. } => *timeout,
				};

				// Determine transport type based on the transport argument
				mcp.transport = if transport == "sse" {
					McpTransport::Sse {
						url: url_str,
						headers: headers_map,
						timeout,
					}
				} else {
					// Default to streamable-http
					McpTransport::StreamableHttp {
						url: url_str,
						headers: headers_map,
						timeout,
					}
				};
			}

			manager.update_mcp(&name, mcp.clone())?;
			eprintln_verbose!("MCP server updated successfully");
			println!("{}", serde_json::to_string_pretty(&mcp)?);
		}
	}

	Ok(())
}
