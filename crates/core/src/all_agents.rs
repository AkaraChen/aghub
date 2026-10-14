use crate::{
	adapters::AgentAdapter,
	manager::ConfigManager,
	models::{
		AgentType, ConfigSource, McpServer, ResourceOrigin, ResourceScope,
		ResourceSourceKind, ResourceWritePolicy, RuntimeVisibility, Skill,
		SubAgent,
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
	let sources = skill_read_sources(target, scope, project_root, source);
	let roots = sources
		.iter()
		.map(|source| source.root.clone())
		.collect::<Vec<_>>();
	let discovered = cache.load_for_agent(&roots, target.discovery());
	let mut loaded = discovered
		.into_iter()
		.filter_map(|mut skill| {
			let source_path = skill.source_path.as_deref()?;
			let expanded = crate::rules::expand_tilde(source_path);
			let read_source = sources
				.iter()
				.find(|source| expanded.starts_with(&source.root))?;
			let physical_location =
				skill.source_path.clone().unwrap_or_else(|| {
					read_source.root.to_string_lossy().into_owned()
				});
			skill.config_source = Some(read_source.scope);
			skill.origin = Some(ResourceOrigin {
				product_id: target.id().to_string(),
				surface_ids: read_source
					.surface_ids
					.iter()
					.map(|id| (*id).to_string())
					.collect(),
				scope: read_source.scope,
				source_kind: read_source.source_kind,
				physical_location: Some(physical_location),
				precedence: read_source.precedence,
				write_policy: read_source.write_policy,
				runtime_visibility: read_source.runtime_visibility,
				runtime_visibility_evidence: Some(
					read_source.runtime_visibility_evidence.to_string(),
				),
			});
			Some(skill)
		})
		.collect::<Vec<_>>();
	let mut physical_locations = std::collections::HashSet::new();
	loaded.retain(|skill| {
		let Some(path) = skill.source_path.as_deref() else {
			return true;
		};
		let path = crate::rules::expand_tilde(path);
		let identity = std::fs::canonicalize(&path).unwrap_or(path);
		physical_locations.insert(identity)
	});
	if matches!(target, SkillTarget::Agent(_)) {
		let universal_root = match scope {
			ResourceScope::GlobalOnly => {
				aghub_agents::descriptor::get_universal_skills_path()
			}
			ResourceScope::ProjectOnly => project_root.map(
				aghub_agents::descriptor::get_universal_project_skills_path,
			),
			ResourceScope::Both => None,
		};
		loaded.retain(|skill| {
			let path =
				skill.source_path.as_deref().map(crate::rules::expand_tilde);
			!path.is_some_and(|path| {
				universal_root
					.as_ref()
					.is_some_and(|root| path.starts_with(root))
			})
		});
	}
	skills.extend(loaded);
}

fn skill_read_sources(
	target: SkillTarget,
	scope: ResourceScope,
	project_root: Option<&Path>,
	config_source: ConfigSource,
) -> Vec<aghub_agents::SkillReadSource> {
	match target {
		SkillTarget::Agent(agent) => {
			registry::get(agent).skill_read_sources(project_root, scope)
		}
		SkillTarget::Universal => {
			let write_path = target.write_path(scope, project_root);
			target
				.read_paths(scope, project_root)
				.into_iter()
				.enumerate()
				.map(|(precedence, root)| aghub_agents::SkillReadSource {
					write_policy: if write_path.as_ref() == Some(&root) {
						ResourceWritePolicy::ReadWrite
					} else {
						ResourceWritePolicy::ReadOnly
					},
					root,
					surface_ids: vec!["standard"],
					scope: config_source,
					source_kind: ResourceSourceKind::Standard,
					precedence,
					runtime_visibility: RuntimeVisibility::Visible,
					runtime_visibility_evidence:
						"declared by the Agent Skills standard",
				})
				.collect()
		}
	}
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
	use crate::models::{ResourceSourceKind, ResourceWritePolicy};

	fn write_skill(root: &Path, name: &str) {
		let skill = root.join(name);
		std::fs::create_dir_all(&skill).unwrap();
		std::fs::write(
			skill.join("SKILL.md"),
			format!("---\nname: {name}\ndescription: Test\n---\n"),
		)
		.unwrap();
	}

	fn write_sub_agent(root: &Path, name: &str) {
		std::fs::create_dir_all(root).unwrap();
		std::fs::write(
			root.join(format!("{name}.md")),
			format!("---\nname: {name}\ndescription: Test\n---\nBody"),
		)
		.unwrap();
	}

	#[test]
	fn skill_locations_keep_product_specific_source_ownership() {
		let temp = tempfile::tempdir().unwrap();
		let project_root = temp.path();
		for (root, name) in [
			(project_root.join(".cursor/skills"), "native"),
			(project_root.join(".agents/skills"), "standard"),
			(project_root.join(".claude/skills"), "compatible"),
		] {
			write_skill(&root, name);
		}

		let locations = load_all_skill_target_locations(
			ResourceScope::ProjectOnly,
			Some(project_root),
		);
		let cursor = locations
			.iter()
			.find(|locations| locations.target_id == "cursor")
			.unwrap();
		let native = cursor
			.skills
			.iter()
			.find(|skill| skill.name == "native")
			.and_then(|skill| skill.origin.as_ref())
			.unwrap();
		let compatible = cursor
			.skills
			.iter()
			.find(|skill| skill.name == "compatible")
			.and_then(|skill| skill.origin.as_ref())
			.unwrap();

		assert_eq!(native.product_id, "cursor");
		assert_eq!(native.surface_ids, ["ide", "cli", "cloud"]);
		assert_eq!(native.source_kind, ResourceSourceKind::Native);
		assert_eq!(native.write_policy, ResourceWritePolicy::ReadWrite);
		assert_eq!(compatible.source_kind, ResourceSourceKind::Compatible);
		assert_eq!(compatible.write_policy, ResourceWritePolicy::ReadOnly);
		assert!(native.precedence < compatible.precedence);
		assert!(!cursor.skills.iter().any(|skill| skill.name == "standard"));

		let universal = locations
			.iter()
			.find(|locations| locations.target_id == "universal")
			.unwrap();
		let standard = universal
			.skills
			.iter()
			.find(|skill| skill.name == "standard")
			.and_then(|skill| skill.origin.as_ref())
			.unwrap();
		assert_eq!(standard.product_id, "universal");
		assert_eq!(standard.source_kind, ResourceSourceKind::Standard);
		assert_eq!(standard.write_policy, ResourceWritePolicy::ReadWrite);
	}

	#[test]
	fn cursor_sub_agents_keep_native_and_compatible_origins() {
		let temp = tempfile::tempdir().unwrap();
		write_sub_agent(&temp.path().join(".cursor/agents"), "native");
		write_sub_agent(&temp.path().join(".claude/agents"), "compatible");
		let descriptor = registry::get(AgentType::Cursor);

		let agents = AgentAdapter::load_sub_agents(
			&descriptor,
			Some(temp.path()),
			ResourceScope::ProjectOnly,
		)
		.unwrap();

		let native = agents
			.iter()
			.find(|agent| agent.name == "native")
			.and_then(|agent| agent.origin.as_ref())
			.unwrap();
		let compatible = agents
			.iter()
			.find(|agent| agent.name == "compatible")
			.and_then(|agent| agent.origin.as_ref())
			.unwrap();
		assert_eq!(native.product_id, "cursor");
		assert_eq!(native.surface_ids, ["ide", "cli", "cloud"]);
		assert_eq!(native.source_kind, ResourceSourceKind::Native);
		assert_eq!(native.write_policy, ResourceWritePolicy::ReadWrite);
		assert_eq!(compatible.source_kind, ResourceSourceKind::Compatible);
		assert_eq!(compatible.write_policy, ResourceWritePolicy::ReadOnly);
		assert!(native.precedence < compatible.precedence);
	}

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
