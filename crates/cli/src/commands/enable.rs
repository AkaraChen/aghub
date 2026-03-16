use crate::ResourceType;
use aghub_core::manager::ConfigManager;
use anyhow::Result;
use colored::Colorize;

pub fn execute(manager: &mut ConfigManager, resource: ResourceType, name: String) -> Result<()> {
    match resource {
        ResourceType::Skills => {
            manager.enable_skill(&name)?;
            println!(
                "{} {}",
                "✓".green().bold(),
                format!("Enabled skill '{}'", name)
            );
        }
        ResourceType::Mcps => {
            manager.enable_mcp(&name)?;
            println!(
                "{} {}",
                "✓".green().bold(),
                format!("Enabled MCP server '{}'", name)
            );
        }
        ResourceType::SubAgents => {
            manager.enable_sub_agent(&name)?;
            println!(
                "{} {}",
                "✓".green().bold(),
                format!("Enabled sub-agent '{}'", name)
            );
        }
    }

    Ok(())
}
