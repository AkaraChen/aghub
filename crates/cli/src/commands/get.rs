use crate::{eprintln_verbose, ResourceType};
use aghub_core::manager::ConfigManager;
use anyhow::{Context, Result};
use serde::Serialize;

#[derive(Serialize)]
struct SkillView {
    name: String,
    enabled: bool,
    source: Option<String>,
}

#[derive(Serialize)]
struct McpView {
    name: String,
    enabled: bool,
    #[serde(rename = "type")]
    transport_type: String,
}

#[derive(Serialize)]
struct SubAgentView {
    name: String,
    enabled: bool,
    model: Option<String>,
}

pub fn execute(manager: &ConfigManager, resource: ResourceType) -> Result<()> {
    let config = manager.config().context("No configuration loaded")?;

    match resource {
        ResourceType::Skills => {
            let views: Vec<SkillView> = config
                .skills
                .iter()
                .map(|s| SkillView {
                    name: s.name.clone(),
                    enabled: s.enabled,
                    source: s.source.clone(),
                })
                .collect();
            eprintln_verbose!("Found {} skills", views.len());
            println!("{}", serde_json::to_string_pretty(&views)?);
        }
        ResourceType::Mcps => {
            let views: Vec<McpView> = config
                .mcps
                .iter()
                .map(|m| McpView {
                    name: m.name.clone(),
                    enabled: m.enabled,
                    transport_type: match &m.transport {
                        aghub_core::models::McpTransport::Command { .. } => "command".to_string(),
                        aghub_core::models::McpTransport::Url { .. } => "url".to_string(),
                    },
                })
                .collect();
            eprintln_verbose!("Found {} MCP servers", views.len());
            println!("{}", serde_json::to_string_pretty(&views)?);
        }
        ResourceType::SubAgents => {
            let views: Vec<SubAgentView> = config
                .sub_agents
                .iter()
                .map(|a| SubAgentView {
                    name: a.name.clone(),
                    enabled: a.enabled,
                    model: a.model.clone(),
                })
                .collect();
            eprintln_verbose!("Found {} sub-agents", views.len());
            println!("{}", serde_json::to_string_pretty(&views)?);
        }
    }

    Ok(())
}
