use crate::{
	adapters::AgentAdapter,
	manager::ConfigManager,
	models::{McpServer, ResourceScope, Skill},
	registry,
};
use std::path::Path;

/// Resources loaded for a single agent
pub struct AgentResources {
	pub agent_id: &'static str,
	pub skills: Vec<Skill>,
	pub mcps: Vec<McpServer>,
}

/// Load resources for all registered agents.
///
/// Agents with no config or a missing config file return empty skills/mcps rather
/// than propagating an error. A malformed config file is also silently skipped.
pub fn load_all_agents(
	scope: ResourceScope,
	project_root: Option<&Path>,
) -> Vec<AgentResources> {
	registry::iter_all()
		.map(|descriptor| {
			let adapter: Box<dyn AgentAdapter> = Box::new(descriptor);
			let mut manager =
				ConfigManager::with_scope(adapter, true, project_root, scope);
			// Use load_both_annotated when scope is Both to get config_source
			if scope == ResourceScope::Both {
				match manager.load_both_annotated() {
					Ok((skills, mcps)) => AgentResources {
						agent_id: descriptor.id,
						skills,
						mcps,
					},
					Err(_) => AgentResources {
						agent_id: descriptor.id,
						skills: vec![],
						mcps: vec![],
					},
				}
			} else {
				match manager.load() {
					Ok(config) => AgentResources {
						agent_id: descriptor.id,
						skills: config.skills.clone(),
						mcps: config.mcps.clone(),
					},
					Err(_) => AgentResources {
						agent_id: descriptor.id,
						skills: vec![],
						mcps: vec![],
					},
				}
			}
		})
		.collect()
}
