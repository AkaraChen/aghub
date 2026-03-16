use crate::ResourceType;
use aghub_core::manager::ConfigManager;
use anyhow::Result;
use colored::Colorize;

pub fn execute(manager: &mut ConfigManager, resource: ResourceType, name: String) -> Result<()> {
    match resource {
        ResourceType::Skills => {
            manager.remove_skill(&name)?;
            println!(
                "{} {}",
                "✓".green().bold(),
                format!("Deleted skill '{}'", name)
            );
        }
        ResourceType::Mcps => {
            manager.remove_mcp(&name)?;
            println!(
                "{} {}",
                "✓".green().bold(),
                format!("Deleted MCP server '{}'", name)
            );
        }
        ResourceType::SubAgents => {
            manager.remove_sub_agent(&name)?;
            println!(
                "{} {}",
                "✓".green().bold(),
                format!("Deleted sub-agent '{}'", name)
            );
        }
    }

    Ok(())
}
