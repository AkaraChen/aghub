use crate::ResourceType;
use aghub_core::manager::ConfigManager;
use anyhow::{Context, Result};
use colored::Colorize;
use tabled::{Table, Tabled};

#[derive(Tabled)]
struct SkillRow {
    name: String,
    status: String,
    #[tabled(rename = "source")]
    source: String,
}

#[derive(Tabled)]
struct McpRow {
    name: String,
    status: String,
    #[tabled(rename = "type")]
    transport_type: String,
}

#[derive(Tabled)]
struct SubAgentRow {
    name: String,
    status: String,
    model: String,
}

pub fn execute(manager: &ConfigManager, resource: ResourceType) -> Result<()> {
    let config = manager
        .config()
        .context("No configuration loaded")?;

    match resource {
        ResourceType::Skills => {
            if config.skills.is_empty() {
                println!("{}", "No skills configured".yellow());
                return Ok(());
            }

            let rows: Vec<_> = config
                .skills
                .iter()
                .map(|s| SkillRow {
                    name: s.name.clone(),
                    status: if s.enabled {
                        "enabled".green().to_string()
                    } else {
                        "disabled".red().to_string()
                    },
                    source: s.source.clone().unwrap_or_default(),
                })
                .collect();

            println!("{}", Table::new(rows));
        }
        ResourceType::Mcps => {
            if config.mcps.is_empty() {
                println!("{}", "No MCP servers configured".yellow());
                return Ok(());
            }

            let rows: Vec<_> = config
                .mcps
                .iter()
                .map(|m| McpRow {
                    name: m.name.clone(),
                    status: if m.enabled {
                        "enabled".green().to_string()
                    } else {
                        "disabled".red().to_string()
                    },
                    transport_type: match &m.transport {
                        aghub_core::models::McpTransport::Command { .. } => {
                            "command".to_string()
                        }
                        aghub_core::models::McpTransport::Url { .. } => "url".to_string(),
                    },
                })
                .collect();

            println!("{}", Table::new(rows));
        }
        ResourceType::SubAgents => {
            if config.sub_agents.is_empty() {
                println!("{}", "No sub-agents configured".yellow());
                return Ok(());
            }

            let rows: Vec<_> = config
                .sub_agents
                .iter()
                .map(|a| SubAgentRow {
                    name: a.name.clone(),
                    status: if a.enabled {
                        "enabled".green().to_string()
                    } else {
                        "disabled".red().to_string()
                    },
                    model: a.model.clone().unwrap_or_default(),
                })
                .collect();

            println!("{}", Table::new(rows));
        }
    }

    Ok(())
}
