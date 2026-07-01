//! Configuration conflict detection.
//!
//! The detector is intentionally pure: callers load global/project
//! configurations, then pass the loaded models here for analysis.

use crate::{
	models::{AgentConfig, Skill},
	InstallScope,
};
use serde::{Deserialize, Serialize};
use std::{
	collections::HashMap,
	path::{Path, PathBuf},
};

/// Type of resource that can have conflicts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResourceType {
	Mcp,
	Skill,
	SubAgent,
}

impl std::fmt::Display for ResourceType {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		match self {
			ResourceType::Mcp => write!(f, "MCP server"),
			ResourceType::Skill => write!(f, "skill"),
			ResourceType::SubAgent => write!(f, "sub-agent"),
		}
	}
}

/// Type of conflict detected.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictType {
	/// Same resource name exists in both global and project scopes.
	ScopeOverlap,
	/// A discovered symlink target no longer exists.
	BrokenSymlink,
}

impl std::fmt::Display for ConflictType {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		match self {
			ConflictType::ScopeOverlap => write!(f, "scope overlap"),
			ConflictType::BrokenSymlink => write!(f, "broken symlink"),
		}
	}
}

/// Information about a single resource instance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResourceInfo {
	pub scope: InstallScope,
	pub enabled: bool,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub source_path: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub canonical_path: Option<String>,
}

/// A detected configuration conflict.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConfigConflict {
	pub resource_type: ResourceType,
	pub name: String,
	pub conflict_type: ConflictType,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub global_instance: Option<ResourceInfo>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub project_instance: Option<ResourceInfo>,
	pub recommendation: String,
}

/// Conflict detection engine.
pub struct ConflictDetector;

impl ConflictDetector {
	/// Detect conflicts between a global config and an optional project config.
	pub fn detect(
		global_config: &AgentConfig,
		project_config: Option<&AgentConfig>,
	) -> Vec<ConfigConflict> {
		let mut conflicts = Vec::new();

		if let Some(project_config) = project_config {
			conflicts.extend(detect_mcp_scope_overlaps(
				global_config,
				project_config,
			));
			conflicts.extend(detect_skill_scope_overlaps(
				global_config,
				project_config,
			));
			conflicts.extend(detect_sub_agent_scope_overlaps(
				global_config,
				project_config,
			));
			conflicts.extend(detect_broken_skill_symlinks(
				&project_config.skills,
				InstallScope::Project,
			));
		}

		conflicts.extend(detect_broken_skill_symlinks(
			&global_config.skills,
			InstallScope::Global,
		));

		conflicts
	}
}

fn detect_mcp_scope_overlaps(
	global_config: &AgentConfig,
	project_config: &AgentConfig,
) -> Vec<ConfigConflict> {
	let project_by_name: HashMap<_, _> = project_config
		.mcps
		.iter()
		.map(|mcp| (mcp.name.as_str(), mcp))
		.collect();

	global_config
		.mcps
		.iter()
		.filter_map(|global_mcp| {
			let project_mcp = project_by_name.get(global_mcp.name.as_str())?;
			Some(ConfigConflict {
				resource_type: ResourceType::Mcp,
				name: global_mcp.name.clone(),
				conflict_type: ConflictType::ScopeOverlap,
				global_instance: Some(ResourceInfo {
					scope: InstallScope::Global,
					enabled: global_mcp.enabled,
					source_path: None,
					canonical_path: None,
				}),
				project_instance: Some(ResourceInfo {
					scope: InstallScope::Project,
					enabled: project_mcp.enabled,
					source_path: None,
					canonical_path: None,
				}),
				recommendation: format!(
					"MCP server '{}' exists in global and project scope; \
					 the project entry is the one users should inspect first.",
					global_mcp.name
				),
			})
		})
		.collect()
}

fn detect_skill_scope_overlaps(
	global_config: &AgentConfig,
	project_config: &AgentConfig,
) -> Vec<ConfigConflict> {
	let project_by_name: HashMap<_, _> = project_config
		.skills
		.iter()
		.map(|skill| (skill.name.as_str(), skill))
		.collect();

	global_config
		.skills
		.iter()
		.filter_map(|global_skill| {
			let project_skill =
				project_by_name.get(global_skill.name.as_str())?;
			Some(ConfigConflict {
				resource_type: ResourceType::Skill,
				name: global_skill.name.clone(),
				conflict_type: ConflictType::ScopeOverlap,
				global_instance: Some(skill_info(
					global_skill,
					InstallScope::Global,
				)),
				project_instance: Some(skill_info(
					project_skill,
					InstallScope::Project,
				)),
				recommendation: format!(
					"Skill '{}' exists in global and project scope; keep one \
					 authoritative copy or convert shared use to a symlink.",
					global_skill.name
				),
			})
		})
		.collect()
}

fn detect_sub_agent_scope_overlaps(
	global_config: &AgentConfig,
	project_config: &AgentConfig,
) -> Vec<ConfigConflict> {
	let project_by_name: HashMap<_, _> = project_config
		.sub_agents
		.iter()
		.map(|sub_agent| (sub_agent.name.as_str(), sub_agent))
		.collect();

	global_config
		.sub_agents
		.iter()
		.filter_map(|global_sub_agent| {
			let project_sub_agent =
				project_by_name.get(global_sub_agent.name.as_str())?;
			Some(ConfigConflict {
				resource_type: ResourceType::SubAgent,
				name: global_sub_agent.name.clone(),
				conflict_type: ConflictType::ScopeOverlap,
				global_instance: Some(ResourceInfo {
					scope: InstallScope::Global,
					enabled: true,
					source_path: global_sub_agent.source_path.clone(),
					canonical_path: None,
				}),
				project_instance: Some(ResourceInfo {
					scope: InstallScope::Project,
					enabled: true,
					source_path: project_sub_agent.source_path.clone(),
					canonical_path: None,
				}),
				recommendation: format!(
					"Sub-agent '{}' exists in global and project scope; \
					 check which instruction file should win.",
					global_sub_agent.name
				),
			})
		})
		.collect()
}

fn detect_broken_skill_symlinks(
	skills: &[Skill],
	scope: InstallScope,
) -> Vec<ConfigConflict> {
	skills
		.iter()
		.filter_map(|skill| {
			let canonical_path = skill.canonical_path.as_ref()?;
			let path = expand_home(canonical_path);
			if path.exists() {
				return None;
			}

			let instance = skill_info(skill, scope);
			Some(ConfigConflict {
				resource_type: ResourceType::Skill,
				name: skill.name.clone(),
				conflict_type: ConflictType::BrokenSymlink,
				global_instance: (scope == InstallScope::Global)
					.then_some(instance.clone()),
				project_instance: (scope == InstallScope::Project)
					.then_some(instance),
				recommendation: format!(
					"Skill '{}' points to missing symlink target '{}'; \
					 remove the link or recreate the target before using it.",
					skill.name, canonical_path
				),
			})
		})
		.collect()
}

fn skill_info(skill: &Skill, scope: InstallScope) -> ResourceInfo {
	ResourceInfo {
		scope,
		enabled: skill.enabled,
		source_path: skill.source_path.clone(),
		canonical_path: skill.canonical_path.clone(),
	}
}

fn expand_home(path: &str) -> PathBuf {
	let Some(stripped) = path.strip_prefix("~/") else {
		return Path::new(path).to_path_buf();
	};
	let Some(home) = dirs::home_dir() else {
		return Path::new(path).to_path_buf();
	};
	home.join(stripped)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::models::{McpServer, McpTransport, SubAgent};

	#[test]
	fn no_conflicts_when_scopes_have_distinct_resources() {
		let mut global = AgentConfig::new();
		global.mcps.push(McpServer::new(
			"global-filesystem",
			McpTransport::stdio("npx", vec![]),
		));

		let mut project = AgentConfig::new();
		project.mcps.push(McpServer::new(
			"project-filesystem",
			McpTransport::stdio("npx", vec![]),
		));

		let conflicts = ConflictDetector::detect(&global, Some(&project));

		assert!(conflicts.is_empty());
	}

	#[test]
	fn detects_mcp_scope_overlap() {
		let mut global = AgentConfig::new();
		global.mcps.push(McpServer::new(
			"filesystem",
			McpTransport::stdio("npx", vec![]),
		));

		let mut project = AgentConfig::new();
		project.mcps.push(McpServer::new(
			"filesystem",
			McpTransport::stdio("npx", vec![]),
		));

		let conflicts = ConflictDetector::detect(&global, Some(&project));

		assert_eq!(conflicts.len(), 1);
		assert_eq!(conflicts[0].resource_type, ResourceType::Mcp);
		assert_eq!(conflicts[0].name, "filesystem");
		assert_eq!(conflicts[0].conflict_type, ConflictType::ScopeOverlap);
		assert_eq!(
			conflicts[0].global_instance.as_ref().unwrap().scope,
			InstallScope::Global
		);
		assert_eq!(
			conflicts[0].project_instance.as_ref().unwrap().scope,
			InstallScope::Project
		);
	}

	#[test]
	fn detects_skill_scope_overlap_with_paths() {
		let mut global = AgentConfig::new();
		let mut global_skill = Skill::new("review");
		global_skill.source_path =
			Some("~/.claude/skills/review/SKILL.md".into());
		global.skills.push(global_skill);

		let mut project = AgentConfig::new();
		let mut project_skill = Skill::new("review");
		project_skill.source_path =
			Some(".claude/skills/review/SKILL.md".into());
		project.skills.push(project_skill);

		let conflicts = ConflictDetector::detect(&global, Some(&project));

		assert_eq!(conflicts.len(), 1);
		assert_eq!(conflicts[0].resource_type, ResourceType::Skill);
		assert_eq!(conflicts[0].name, "review");
		assert_eq!(conflicts[0].conflict_type, ConflictType::ScopeOverlap);
		assert_eq!(
			conflicts[0]
				.global_instance
				.as_ref()
				.unwrap()
				.source_path
				.as_deref(),
			Some("~/.claude/skills/review/SKILL.md")
		);
	}

	#[test]
	fn detects_sub_agent_scope_overlap() {
		let mut global = AgentConfig::new();
		global.sub_agents.push(SubAgent::new("planner"));

		let mut project = AgentConfig::new();
		project.sub_agents.push(SubAgent::new("planner"));

		let conflicts = ConflictDetector::detect(&global, Some(&project));

		assert_eq!(conflicts.len(), 1);
		assert_eq!(conflicts[0].resource_type, ResourceType::SubAgent);
		assert_eq!(conflicts[0].name, "planner");
	}

	#[test]
	fn detects_broken_skill_symlink() {
		let mut global = AgentConfig::new();
		let mut skill = Skill::new("broken-skill");
		skill.source_path =
			Some("~/.claude/skills/broken-skill/SKILL.md".into());
		skill.canonical_path =
			Some("/tmp/aghub-missing-symlink-target/SKILL.md".into());
		global.skills.push(skill);

		let conflicts = ConflictDetector::detect(&global, None);

		assert_eq!(conflicts.len(), 1);
		assert_eq!(conflicts[0].resource_type, ResourceType::Skill);
		assert_eq!(conflicts[0].name, "broken-skill");
		assert_eq!(conflicts[0].conflict_type, ConflictType::BrokenSymlink);
		assert!(conflicts[0].project_instance.is_none());
		assert_eq!(
			conflicts[0]
				.global_instance
				.as_ref()
				.unwrap()
				.canonical_path
				.as_deref(),
			Some("/tmp/aghub-missing-symlink-target/SKILL.md")
		);
	}
}
