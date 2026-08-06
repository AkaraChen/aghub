use crate::{
	adapters::AgentAdapter,
	manager::ConfigManager,
	models::{
		AgentType, ConfigSource, McpServer, ResourceScope, Skill, SubAgent,
	},
	registry,
	skills::{
		discovery::SkillLocationCache, SkillDiscoveryOptions, SkillTarget,
	},
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

/// Physical Skill locations loaded for one installation target.
pub struct SkillTargetLocations {
	pub target_id: &'static str,
	pub skills: Vec<Skill>,
}

/// Load every Skill location without deduplicating Skills that share a name.
pub fn load_all_skill_target_locations(
	scope: ResourceScope,
	project_root: Option<&Path>,
) -> Vec<SkillTargetLocations> {
	load_all_skill_target_locations_with_options(
		scope,
		project_root,
		SkillDiscoveryOptions::default(),
	)
}

pub fn load_all_skill_target_locations_with_options(
	scope: ResourceScope,
	project_root: Option<&Path>,
	options: SkillDiscoveryOptions,
) -> Vec<SkillTargetLocations> {
	let mut cache = SkillLocationCache::new(options);
	let targets = std::iter::once(SkillTarget::Universal)
		.chain(AgentType::ALL.iter().copied().map(SkillTarget::Agent));

	targets
		.map(|target| SkillTargetLocations {
			target_id: target.id(),
			skills: load_skill_target_locations(
				target,
				scope,
				project_root,
				&mut cache,
			),
		})
		.collect()
}

fn load_skill_target_locations(
	target: SkillTarget,
	scope: ResourceScope,
	project_root: Option<&Path>,
	cache: &mut SkillLocationCache,
) -> Vec<Skill> {
	let mut skills = Vec::new();
	match scope {
		ResourceScope::GlobalOnly => extend_skill_target_locations(
			target,
			None,
			ResourceScope::GlobalOnly,
			ConfigSource::Global,
			&mut skills,
			cache,
		),
		ResourceScope::ProjectOnly => extend_skill_target_locations(
			target,
			project_root,
			ResourceScope::ProjectOnly,
			ConfigSource::Project,
			&mut skills,
			cache,
		),
		ResourceScope::Both => {
			if project_root.is_some() {
				extend_skill_target_locations(
					target,
					project_root,
					ResourceScope::ProjectOnly,
					ConfigSource::Project,
					&mut skills,
					cache,
				);
			}
			extend_skill_target_locations(
				target,
				None,
				ResourceScope::GlobalOnly,
				ConfigSource::Global,
				&mut skills,
				cache,
			);
		}
	}
	skills
}

fn extend_skill_target_locations(
	target: SkillTarget,
	project_root: Option<&Path>,
	scope: ResourceScope,
	source: ConfigSource,
	skills: &mut Vec<Skill>,
	cache: &mut SkillLocationCache,
) {
	if matches!(target, SkillTarget::Agent(_)) {
		let universal_path =
			SkillTarget::Universal.write_path(scope, project_root);
		if universal_path.is_some()
			&& target.write_path(scope, project_root) == universal_path
		{
			return;
		}
	}
	let paths = target.read_paths(scope, project_root);
	skills.extend(cache.load(&paths).into_iter().map(|mut skill| {
		skill.config_source = Some(source);
		skill
	}));
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

#[cfg(test)]
mod tests {
	use super::*;

	#[cfg(unix)]
	#[test]
	fn linked_native_root_remains_a_distinct_logical_location() {
		let temp = tempfile::tempdir().unwrap();
		let project_root = temp.path();
		let universal_root = project_root.join(".agents/skills");
		let skill_root = universal_root.join("shared-skill");
		std::fs::create_dir_all(&skill_root).unwrap();
		std::fs::write(
			skill_root.join("SKILL.md"),
			"---\nname: shared-skill\ndescription: Shared\n---\n",
		)
		.unwrap();
		let native_root = project_root.join(".cursor/skills");
		std::fs::create_dir_all(native_root.parent().unwrap()).unwrap();
		std::os::unix::fs::symlink(&universal_root, &native_root).unwrap();

		let locations = load_all_skill_target_locations(
			ResourceScope::ProjectOnly,
			Some(project_root),
		);
		let cursor = locations
			.iter()
			.find(|locations| locations.target_id == "cursor")
			.unwrap();
		let universal = locations
			.iter()
			.find(|locations| locations.target_id == "universal")
			.unwrap();
		let source_paths = cursor
			.skills
			.iter()
			.filter(|skill| skill.name == "shared-skill")
			.filter_map(|skill| skill.source_path.as_deref())
			.collect::<Vec<_>>();

		assert_eq!(source_paths.len(), 1);
		assert!(source_paths
			.iter()
			.any(|path| path.contains(".cursor/skills/shared-skill")));
		assert!(universal.skills.iter().any(|skill| {
			skill.name == "shared-skill"
				&& skill.source_path.as_deref().is_some_and(|path| {
					path.contains(".agents/skills/shared-skill")
				})
		}));
		assert_eq!(
			cursor
				.skills
				.iter()
				.filter(|skill| {
					skill.name == "shared-skill"
						&& skill.canonical_path.is_some()
				})
				.count(),
			1
		);
	}

	#[test]
	fn universal_root_is_reported_once_as_a_skill_target() {
		let temp = tempfile::tempdir().unwrap();
		let project_root = temp.path();
		let skill_root = project_root.join(".agents/skills/shared-skill");
		std::fs::create_dir_all(&skill_root).unwrap();
		std::fs::write(
			skill_root.join("SKILL.md"),
			"---\nname: shared-skill\ndescription: Shared\n---\n",
		)
		.unwrap();

		let locations = load_all_skill_target_locations(
			ResourceScope::ProjectOnly,
			Some(project_root),
		);
		let targets = locations
			.iter()
			.filter(|location| {
				location.skills.iter().any(|skill| {
					skill.name == "shared-skill"
						&& skill
							.source_path
							.as_deref()
							.is_some_and(|path| path.contains(".agents/skills"))
				})
			})
			.map(|location| location.target_id)
			.collect::<Vec<_>>();

		assert_eq!(targets, vec!["universal"]);
	}
}
