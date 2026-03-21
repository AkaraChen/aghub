use crate::{eprintln_verbose, ResourceType};
use aghub_core::manager::ConfigManager;
use anyhow::{Context, Result};
use serde::Serialize;

#[derive(Serialize)]
struct SkillView {
	name: String,
	enabled: bool,
}

#[derive(Serialize)]
struct McpView {
	name: String,
	enabled: bool,
	#[serde(rename = "type")]
	transport_type: String,
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
						aghub_core::models::McpTransport::Stdio { .. } => {
							"stdio".to_string()
						}
						aghub_core::models::McpTransport::Sse { .. } => {
							"sse".to_string()
						}
						aghub_core::models::McpTransport::StreamableHttp {
							..
						} => "streamable-http".to_string(),
					},
				})
				.collect();
			eprintln_verbose!("Found {} MCP servers", views.len());
			println!("{}", serde_json::to_string_pretty(&views)?);
		}
	}

	Ok(())
}
