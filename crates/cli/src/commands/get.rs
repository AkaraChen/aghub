use crate::{eprintln_verbose, ResourceType};
use aghub_core::manager::ConfigManager;
use anyhow::{Context, Result};
use serde::Serialize;

#[derive(Serialize)]
pub(crate) struct SkillView {
	name: String,
	enabled: bool,
	#[serde(skip_serializing_if = "Option::is_none")]
	source_path: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	description: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	author: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	version: Option<String>,
	#[serde(skip_serializing_if = "Vec::is_empty")]
	tools: Vec<String>,
}

#[derive(Serialize)]
pub(crate) struct McpView {
	name: String,
	enabled: bool,
	#[serde(rename = "type")]
	transport_type: String,
}

pub(crate) fn skill_to_view(s: &aghub_core::models::Skill) -> SkillView {
	SkillView {
		name: s.name.clone(),
		enabled: s.enabled,
		source_path: s.source_path.clone(),
		description: s.description.clone(),
		author: s.author.clone(),
		version: s.version.clone(),
		tools: s.tools.clone(),
	}
}

pub(crate) fn mcp_to_view(m: &aghub_core::models::McpServer) -> McpView {
	McpView {
		name: m.name.clone(),
		enabled: m.enabled,
		transport_type: match &m.transport {
			aghub_core::models::McpTransport::Stdio { .. } => "stdio".to_string(),
			aghub_core::models::McpTransport::Sse { .. } => "sse".to_string(),
			aghub_core::models::McpTransport::StreamableHttp { .. } => {
				"streamable-http".to_string()
			}
		},
	}
}

pub fn execute(manager: &ConfigManager, resource: ResourceType) -> Result<()> {
	let config = manager.config().context("No configuration loaded")?;

	match resource {
		ResourceType::Skills => {
			let views: Vec<SkillView> =
				config.skills.iter().map(skill_to_view).collect();
			eprintln_verbose!("Found {} skills", views.len());
			println!("{}", serde_json::to_string_pretty(&views)?);
		}
		ResourceType::Mcps => {
			let views: Vec<McpView> =
				config.mcps.iter().map(mcp_to_view).collect();
			eprintln_verbose!("Found {} MCP servers", views.len());
			println!("{}", serde_json::to_string_pretty(&views)?);
		}
	}

	Ok(())
}

pub fn execute_all(
	resources: Vec<aghub_core::all_agents::AgentResources>,
	resource: ResourceType,
) -> Result<()> {
	// Use serde_json::Value for dynamic output - only include the requested resource type
	use serde_json::{json, Value};

	let views: Vec<Value> = resources
		.into_iter()
		.map(|r| match resource {
			ResourceType::Skills => json!({
				"agent": r.agent_id,
				"skills": r.skills.iter().map(skill_to_view).collect::<Vec<_>>(),
			}),
			ResourceType::Mcps => json!({
				"agent": r.agent_id,
				"mcps": r.mcps.iter().map(mcp_to_view).collect::<Vec<_>>(),
			}),
		})
		.collect();

	eprintln_verbose!("Listing resources for {} agents", views.len());
	println!("{}", serde_json::to_string_pretty(&views)?);
	Ok(())
}
