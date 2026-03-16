use crate::{eprintln_verbose, ResourceType};
use aghub_core::{
    manager::ConfigManager,
    models::{McpServer, McpTransport, Skill, SubAgent},
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
    headers: Vec<String>,
    env_vars: Vec<String>,
    description: Option<String>,
    author: Option<String>,
    version: Option<String>,
    source: Option<String>,
    tools: Vec<String>,
    model: Option<String>,
    instructions: Option<String>,
) -> Result<()> {
    match resource {
        ResourceType::Skills => {
            eprintln_verbose!("Adding skill: {}", name);
            let skill = Skill {
                name: name.clone(),
                enabled: true,
                source,
                description,
                author,
                version,
                tools,
            };
            manager.add_skill(skill.clone())?;
            eprintln_verbose!("Skill added successfully");
            println!("{}", serde_json::to_string_pretty(&skill)?);
        }
        ResourceType::Mcps => {
            let transport = if let Some(cmd_str) = command {
                // Parse command and args
                let parts: Vec<String> = cmd_str.split_whitespace().map(String::from).collect();
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
                            env_map.insert(parts[0].to_string(), parts[1].to_string());
                        }
                    }
                    Some(env_map)
                };

                McpTransport::Command { command, args, env }
            } else if let Some(url_str) = url {
                // Parse headers
                let headers_map = if headers.is_empty() {
                    None
                } else {
                    let mut map = HashMap::new();
                    for header in headers {
                        let parts: Vec<_> = header.splitn(2, ':').collect();
                        if parts.len() == 2 {
                            map.insert(parts[0].trim().to_string(), parts[1].trim().to_string());
                        }
                    }
                    Some(map)
                };

                McpTransport::Url {
                    url: url_str,
                    headers: headers_map,
                }
            } else {
                bail!("Either --command or --url must be specified for MCP servers");
            };

            eprintln_verbose!("Adding MCP server: {}", name);
            let mcp = McpServer::new(name.clone(), transport);
            manager.add_mcp(mcp.clone())?;
            eprintln_verbose!("MCP server added successfully");
            println!("{}", serde_json::to_string_pretty(&mcp)?);
        }
        ResourceType::SubAgents => {
            eprintln_verbose!("Adding sub-agent: {}", name);
            let agent = SubAgent {
                name: name.clone(),
                enabled: true,
                description,
                model,
                instructions,
            };
            manager.add_sub_agent(agent.clone())?;
            eprintln_verbose!("Sub-agent added successfully");
            println!("{}", serde_json::to_string_pretty(&agent)?);
        }
    }

    Ok(())
}
