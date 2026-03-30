use crate::{
	adapters::AgentAdapter,
	manager::ConfigManager,
	models::{ConfigSource, McpServer, ResourceScope, Skill},
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
			let is_global = scope == ResourceScope::GlobalOnly
				|| scope == ResourceScope::Both;
			let mut manager = ConfigManager::with_scope(
				adapter,
				is_global,
				project_root,
				scope,
			);
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
					Ok(config) => {
						let config_source = match scope {
							ResourceScope::GlobalOnly => {
								Some(ConfigSource::Global)
							}
							ResourceScope::ProjectOnly => {
								Some(ConfigSource::Project)
							}
							_ => None,
						};
						let skills: Vec<Skill> = config
							.skills
							.iter()
							.cloned()
							.map(|mut s| {
								s.config_source = config_source;
								s
							})
							.collect();
						AgentResources {
							agent_id: descriptor.id,
							skills,
							mcps: config.mcps.clone(),
						}
					}
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
