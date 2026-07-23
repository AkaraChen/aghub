use crate::{
	adapters::AgentAdapter,
	manager::ConfigManager,
	models::{ConfigSource, McpServer, ResourceScope, Skill, SubAgent},
	registry,
	skills::load_skill_locations_from_dirs,
};
use log::{debug, warn};
use std::path::Path;

/// Resources loaded for a single agent
pub struct AgentResources {
	pub agent_id: &'static str,
	pub skills: Vec<Skill>,
	pub mcps: Vec<McpServer>,
	pub sub_agents: Vec<SubAgent>,
}

/// Physical skill locations loaded for a single agent.
pub struct AgentSkillLocations {
	pub agent_id: &'static str,
	pub skills: Vec<Skill>,
}

/// Load every skill location for all registered agents without deduplicating
/// skills that share a name.
pub fn load_all_agent_skill_locations(
	scope: ResourceScope,
	project_root: Option<&Path>,
) -> Vec<AgentSkillLocations> {
	registry::iter_all()
		.map(|descriptor| {
			let adapter: Box<dyn AgentAdapter> = Box::new(descriptor);
			let mut skills = Vec::new();

			match scope {
				ResourceScope::GlobalOnly => extend_skill_locations(
					adapter.as_ref(),
					None,
					ResourceScope::GlobalOnly,
					ConfigSource::Global,
					&mut skills,
				),
				ResourceScope::ProjectOnly => extend_skill_locations(
					adapter.as_ref(),
					project_root,
					ResourceScope::ProjectOnly,
					ConfigSource::Project,
					&mut skills,
				),
				ResourceScope::Both => {
					if project_root.is_some() {
						extend_skill_locations(
							adapter.as_ref(),
							project_root,
							ResourceScope::ProjectOnly,
							ConfigSource::Project,
							&mut skills,
						);
					}
					extend_skill_locations(
						adapter.as_ref(),
						None,
						ResourceScope::GlobalOnly,
						ConfigSource::Global,
						&mut skills,
					);
				}
			}

			AgentSkillLocations {
				agent_id: descriptor.id,
				skills,
			}
		})
		.collect()
}

fn extend_skill_locations(
	adapter: &dyn AgentAdapter,
	project_root: Option<&Path>,
	scope: ResourceScope,
	source: ConfigSource,
	skills: &mut Vec<Skill>,
) {
	if !adapter.supports_skill_scope(scope) {
		return;
	}

	let paths = adapter.get_skills_paths(project_root, scope);
	skills.extend(load_skill_locations_from_dirs(&paths).into_iter().map(
		|mut skill| {
			skill.config_source = Some(source);
			skill
		},
	));
}

/// Load resources for all registered agents.
///
/// Agents with no config or a missing config file return empty skills/mcps rather
/// than propagating an error. A malformed config file is also silently skipped.
pub fn load_all_agents(
	scope: ResourceScope,
	project_root: Option<&Path>,
) -> Vec<AgentResources> {
	debug!("loading resources for all agents in scope {:?}", scope);
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
					Ok((skills, mcps, sub_agents)) => AgentResources {
						agent_id: descriptor.id,
						skills,
						mcps,
						sub_agents,
					},
					Err(error) => {
						warn!(
							"failed to load both-scope resources for agent '{}': {}",
							descriptor.id,
							error
						);
						AgentResources {
							agent_id: descriptor.id,
							skills: vec![],
							mcps: vec![],
							sub_agents: vec![],
						}
					}
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
						let sub_agents: Vec<SubAgent> = config
							.sub_agents
							.iter()
							.cloned()
							.map(|mut a| {
								a.config_source = config_source;
								a
							})
							.collect();
						AgentResources {
							agent_id: descriptor.id,
							skills,
							mcps: config.mcps.clone(),
							sub_agents,
						}
					}
					Err(error) => {
						warn!(
							"failed to load resources for agent '{}': {}",
							descriptor.id, error
						);
						AgentResources {
							agent_id: descriptor.id,
							skills: vec![],
							mcps: vec![],
							sub_agents: vec![],
						}
					}
				}
			}
		})
		.collect()
}
