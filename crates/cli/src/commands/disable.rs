use crate::ResourceType;
use aghub_core::manager::ConfigManager;
use anyhow::Result;
use colored::Colorize;

pub fn execute(manager: &mut ConfigManager, resource: ResourceType, name: String) -> Result<()> {
    match resource {
        ResourceType::Skills => {
            manager.disable_skill(&name)?;
            println!(
                "{} {}",
                "✓".green().bold(),
                format!("Disabled skill '{}'", name)
            );
        }
        ResourceType::Mcps => {
            manager.disable_mcp(&name)?;
            println!(
                "{} {}",
                "✓".green().bold(),
                format!("Disabled MCP server '{}'", name)
            );
        }
        ResourceType::SubAgents => {
            manager.disable_sub_agent(&name)?;
            println!(
                "{} {}",
                "✓".green().bold(),
                format!("Disabled sub-agent '{}'", name)
            );
        }
    }

    Ok(())
}
