use crate::{eprintln_verbose, ResourceType};
use aghub_core::{
	manager::ConfigManager,
	models::{McpServer, McpTransport, Skill},
};
use anyhow::{anyhow, bail, Result};
use std::collections::HashMap;
use std::path::PathBuf;

#[allow(clippy::too_many_arguments)]
pub fn execute(
	manager: &mut ConfigManager,
	resource: ResourceType,
	name: Option<String>,
	from: Option<PathBuf>,
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
			if let Some(from_path) = from {
				// Import skill from path (directory, .skill file, or SKILL.md)
				eprintln_verbose!(
					"Importing skill from: {}",
					from_path.display()
				);
				let mut skill = manager.add_skill_from_path(&from_path)?;

				// If explicit name provided, update the skill name
				if let Some(custom_name) = name {
					eprintln_verbose!(
						"Renaming skill from '{}' to '{}'",
						skill.name,
						custom_name
					);
					manager.remove_skill(&skill.name)?;
					skill.name = custom_name;
					manager.add_skill(skill.clone())?;
				}

				eprintln_verbose!("Skill '{}' added successfully", skill.name);
				println!("{}", serde_json::to_string_pretty(&skill)?);
			} else {
				// Manual skill creation, name is required
				let skill_name = name.ok_or_else(|| {
					anyhow!("--name is required when not using --from")
				})?;
				eprintln_verbose!("Adding skill: {}", skill_name);
				let mut skill = Skill::new(skill_name);
				skill.description = description;
				skill.author = author;
				skill.version = version;
				skill.tools = tools;
				manager.add_skill(skill.clone())?;
				eprintln_verbose!("Skill added successfully");
				println!("{}", serde_json::to_string_pretty(&skill)?);
			}
		}
		ResourceType::Mcps => {
			// MCP requires name
			let mcp_name = name
				.ok_or_else(|| anyhow!("--name is required for MCP servers"))?;

			let transport = if let Some(cmd_str) = command {
				// Parse command and args
				let parts: Vec<String> =
					cmd_str.split_whitespace().map(String::from).collect();
				if parts.is_empty() {
					bail!("Command cannot be empty");
				}
				let command = parts[0].clone();
				let args = parts.into_iter().skip(1).collect();

				// Parse env vars
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

				McpTransport::Stdio {
					command,
					args,
					env,
					timeout: None,
				}
			} else if let Some(url_str) = url {
				// Parse headers
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

				// Determine transport type based on the transport argument
				if transport == "sse" {
					McpTransport::Sse {
						url: url_str,
						headers: headers_map,
						timeout: None,
					}
				} else {
					// Default to streamable-http
					McpTransport::StreamableHttp {
						url: url_str,
						headers: headers_map,
						timeout: None,
					}
				}
			} else {
				bail!("Either --command or --url must be specified for MCP servers");
			};

			eprintln_verbose!("Adding MCP server: {}", mcp_name);
			let mcp = McpServer::new(mcp_name, transport);
			manager.add_mcp(mcp.clone())?;
			eprintln_verbose!("MCP server added successfully");
			println!("{}", serde_json::to_string_pretty(&mcp)?);
		}
	}

	Ok(())
}
