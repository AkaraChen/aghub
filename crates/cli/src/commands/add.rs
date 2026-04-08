use crate::{eprintln_verbose, ResourceType};
use aghub_core::{
	manager::ConfigManager,
	models::{McpServer, Skill},
};
use anyhow::{anyhow, Result};
use std::path::PathBuf;

use super::parse_mcp_transport;

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

			let mcp_transport = parse_mcp_transport(
				command, url, &transport, headers, env_vars, None,
			)?;

			let transport = mcp_transport.ok_or_else(|| {
				anyhow!("Either --command or --url must be specified for MCP servers")
			})?;

			eprintln_verbose!("Adding MCP server: {}", mcp_name);
			let mcp = McpServer::new(mcp_name, transport);
			manager.add_mcp(mcp.clone())?;
			eprintln_verbose!("MCP server added successfully");
			println!("{}", serde_json::to_string_pretty(&mcp)?);
		}
	}

	Ok(())
}
