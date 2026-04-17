use crate::descriptor::*;
use crate::sub_agents::{load_scoped_sub_agents, save_scoped_sub_agents};
use aghub_plugins::claude::{ClaudePluginInfo, ClaudePluginManager};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

fn mcp_global_path() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".claude.json"))
}
fn mcp_project_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".mcp.json"))
}
fn global_data_dir() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".claude"))
}
fn load_mcps(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
) -> crate::Result<Vec<crate::McpServer>> {
	load_scoped_mcps(
		project_root,
		scope,
		Some(mcp_global_path),
		Some(mcp_project_path),
		mcp_strategy::parse_json_map_mcp_servers,
	)
}
fn save_mcps(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
	mcps: &[crate::McpServer],
) -> crate::Result<()> {
	save_scoped_mcps(
		project_root,
		scope,
		mcps,
		Some(mcp_global_path),
		Some(mcp_project_path),
		mcp_strategy::serialize_json_map_mcp_servers,
	)
}
fn global_skills_paths() -> Vec<PathBuf> {
	let mut paths = home_dir()
		.map(|home| vec![home.join(".claude/skills")])
		.unwrap_or_default();
	paths.extend(plugin_skill_paths(crate::ResourceScope::GlobalOnly));
	unique_paths(paths)
}

fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	let mut paths = vec![root.join(".claude/skills")];
	paths.extend(plugin_skill_paths(crate::ResourceScope::ProjectOnly));
	unique_paths(paths)
}

fn global_skill_write_path() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".claude/skills"))
}

fn project_skill_write_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".claude/skills"))
}

fn sub_agent_global_dir() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".claude/agents"))
}

fn sub_agent_project_dir(root: &Path) -> Option<PathBuf> {
	Some(root.join(".claude/agents"))
}

fn load_sub_agents(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
) -> crate::Result<Vec<crate::SubAgent>> {
	load_scoped_sub_agents(
		project_root,
		scope,
		Some(sub_agent_global_dir),
		Some(sub_agent_project_dir),
	)
}

fn save_sub_agents(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
	agents: &[crate::SubAgent],
) -> crate::Result<()> {
	save_scoped_sub_agents(
		project_root,
		scope,
		agents,
		Some(sub_agent_global_dir),
		Some(sub_agent_project_dir),
	)
}

fn plugin_skill_paths(scope: crate::ResourceScope) -> Vec<PathBuf> {
	let manager = match ClaudePluginManager::new() {
		Ok(manager) => manager,
		Err(_) => return Vec::new(),
	};
	plugin_skill_paths_for_scope(manager.list_plugins(), scope)
}

fn plugin_skill_paths_for_scope(
	plugins: &[ClaudePluginInfo],
	scope: crate::ResourceScope,
) -> Vec<PathBuf> {
	let mut paths = Vec::new();
	for plugin in plugins {
		if !plugin.enabled
			|| !plugin_scope_matches_resource_scope(&plugin.scopes, scope)
		{
			continue;
		}
		paths.extend(plugin.all_skills_dirs());
	}
	unique_paths(paths)
}

fn plugin_scope_matches_resource_scope(
	scopes: &[aghub_plugins::claude::PluginScopeInfo],
	scope: crate::ResourceScope,
) -> bool {
	match scope {
		crate::ResourceScope::GlobalOnly => {
			scopes.iter().any(|item| item.scope == "user")
		}
		crate::ResourceScope::ProjectOnly => scopes
			.iter()
			.any(|item| item.scope == "project" || item.scope == "local"),
		crate::ResourceScope::Both => !scopes.is_empty(),
	}
}

fn managed_skill_path(path: &Path) -> Option<String> {
	let manager = ClaudePluginManager::new().ok()?;
	manager
		.plugin_owning_path(path)
		.map(|plugin| format!("plugin '{}'", plugin.display_name))
}

fn unique_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
	let mut seen = HashSet::new();
	paths
		.into_iter()
		.filter(|path| seen.insert(path.clone()))
		.collect()
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "claude",
	display_name: "Claude Code",
	mcp_parse_config: Some(mcp_strategy::parse_json_map_mcp_servers),
	mcp_serialize_config: Some(mcp_strategy::serialize_json_map_mcp_servers),
	load_mcps,
	save_mcps,
	mcp_global_path: Some(mcp_global_path),
	mcp_project_path: Some(mcp_project_path),
	global_data_dir,
	capabilities: Capabilities {
		skills: SkillCapabilities {
			scopes: ScopeSupport {
				global: true,
				project: true,
			},
			universal: false,
		},
		mcp: McpCapabilities {
			scopes: ScopeSupport {
				global: true,
				project: true,
			},
			stdio: true,
			remote: true,
			enable_disable: false,
		},
		sub_agents: SubAgentCapabilities {
			scopes: ScopeSupport {
				global: true,
				project: true,
			},
		},
	},
	managed_skill_path: Some(managed_skill_path),
	global_skill_paths: Some(GlobalSkillPaths {
		read: global_skills_paths,
		write: global_skill_write_path,
	}),
	project_skill_paths: Some(ProjectSkillPaths {
		read: project_skills_paths,
		write: project_skill_write_path,
	}),
	load_sub_agents,
	save_sub_agents,
	cli_name: "claude",
	validate_args: &["--version"],
	project_markers: &[".claude", ".mcp.json"],
	skills_cli_name: Some("claude-code"),
};

#[cfg(test)]
mod tests {
	use super::{
		plugin_scope_matches_resource_scope, plugin_skill_paths_for_scope,
	};
	use aghub_plugins::{
		claude::{ClaudePluginInfo, PluginScopeInfo},
		PluginId, PluginSource,
	};
	use std::path::PathBuf;

	fn demo_plugin(
		name: &str,
		enabled: bool,
		scope: &str,
		install_path: PathBuf,
	) -> ClaudePluginInfo {
		ClaudePluginInfo {
			id: PluginId {
				name: name.to_string(),
				source: "claude-plugins-official".to_string(),
			},
			display_name: name.to_string(),
			version: "1.0.0".to_string(),
			description: None,
			author: None,
			repository: None,
			license: None,
			keywords: None,
			source: PluginSource::OfficialRegistry,
			install_path: install_path.clone(),
			enabled,
			commit_hash: String::new(),
			scopes: vec![PluginScopeInfo {
				scope: scope.to_string(),
				install_path,
				version: "1.0.0".to_string(),
				installed_at: "2024-01-01T00:00:00Z".to_string(),
				last_updated: "2024-01-01T00:00:00Z".to_string(),
				git_commit_sha: None,
			}],
		}
	}

	#[test]
	fn test_plugin_scope_matches_resource_scope() {
		let user_scope = vec![PluginScopeInfo {
			scope: "user".to_string(),
			install_path: PathBuf::from("/tmp/user"),
			version: "1.0.0".to_string(),
			installed_at: String::new(),
			last_updated: String::new(),
			git_commit_sha: None,
		}];
		let project_scope = vec![PluginScopeInfo {
			scope: "project".to_string(),
			install_path: PathBuf::from("/tmp/project"),
			version: "1.0.0".to_string(),
			installed_at: String::new(),
			last_updated: String::new(),
			git_commit_sha: None,
		}];
		let local_scope = vec![PluginScopeInfo {
			scope: "local".to_string(),
			install_path: PathBuf::from("/tmp/local"),
			version: "1.0.0".to_string(),
			installed_at: String::new(),
			last_updated: String::new(),
			git_commit_sha: None,
		}];

		assert!(plugin_scope_matches_resource_scope(
			&user_scope,
			crate::ResourceScope::GlobalOnly,
		));
		assert!(!plugin_scope_matches_resource_scope(
			&user_scope,
			crate::ResourceScope::ProjectOnly,
		));
		assert!(plugin_scope_matches_resource_scope(
			&project_scope,
			crate::ResourceScope::ProjectOnly,
		));
		assert!(plugin_scope_matches_resource_scope(
			&local_scope,
			crate::ResourceScope::ProjectOnly,
		));
	}

	#[test]
	fn test_plugin_skill_paths_for_scope_only_returns_enabled_matching_plugins()
	{
		let tmp = tempfile::tempdir().unwrap();
		let user_path = tmp.path().join("user-plugin");
		let project_path = tmp.path().join("project-plugin");
		let disabled_path = tmp.path().join("disabled-plugin");
		std::fs::create_dir_all(user_path.join("skills")).unwrap();
		std::fs::create_dir_all(project_path.join("skills")).unwrap();
		std::fs::create_dir_all(disabled_path.join("skills")).unwrap();

		let plugins = vec![
			demo_plugin("user-plugin", true, "user", user_path.clone()),
			demo_plugin(
				"project-plugin",
				true,
				"project",
				project_path.clone(),
			),
			demo_plugin(
				"disabled-plugin",
				false,
				"user",
				disabled_path.clone(),
			),
		];

		let global_paths = plugin_skill_paths_for_scope(
			&plugins,
			crate::ResourceScope::GlobalOnly,
		);
		assert!(global_paths.contains(&user_path.join("skills")));
		assert!(!global_paths.contains(&project_path.join("skills")));
		assert!(!global_paths.contains(&disabled_path.join("skills")));

		let project_paths = plugin_skill_paths_for_scope(
			&plugins,
			crate::ResourceScope::ProjectOnly,
		);
		assert!(project_paths.contains(&project_path.join("skills")));
		assert!(!project_paths.contains(&user_path.join("skills")));
	}
}
