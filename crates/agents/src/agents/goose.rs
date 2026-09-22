use crate::descriptor::*;
use crate::sub_agents::{load_sub_agents_from_dir, save_scoped_sub_agents};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

fn data_dir() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".config/goose"))
}

fn desktop_runtime_path() -> Option<PathBuf> {
	#[cfg(target_os = "macos")]
	{
		Some(PathBuf::from("/Applications/goose.app"))
	}
	#[cfg(target_os = "linux")]
	{
		Some(PathBuf::from("/usr/share/applications/goose.desktop"))
	}
	#[cfg(target_os = "windows")]
	{
		dirs::data_local_dir().map(|root| root.join("goose/goose.exe"))
	}
}

fn global_skills_paths() -> Vec<PathBuf> {
	let Some(home) = home_dir() else {
		return Vec::new();
	};
	vec![
		home.join(".agents/skills"),
		home.join(".agents/plugins"),
		home.join(".goose/skills"),
		home.join(".claude/skills"),
		home.join(".config/goose/skills"),
	]
}

fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![
		root.join(".agents/skills"),
		root.join(".goose/skills"),
		root.join(".claude/skills"),
	]
}

fn global_skill_write_path() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".agents/skills"))
}

fn project_skill_write_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".agents/skills"))
}

fn global_agent_paths() -> Vec<PathBuf> {
	let Some(home) = home_dir() else {
		return Vec::new();
	};
	vec![
		home.join(".agents/agents"),
		home.join(".goose/agents"),
		home.join(".claude/agents"),
		home.join(".config/goose/agents"),
	]
}

fn project_agent_paths(root: &Path) -> Vec<PathBuf> {
	vec![
		root.join(".agents/agents"),
		root.join(".goose/agents"),
		root.join(".claude/agents"),
	]
}

fn global_agent_write_path() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".agents/agents"))
}

fn project_agent_write_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".agents/agents"))
}

fn load_sub_agents(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
) -> crate::Result<Vec<crate::SubAgent>> {
	let paths = match scope {
		crate::ResourceScope::GlobalOnly => global_agent_paths(),
		crate::ResourceScope::ProjectOnly => {
			project_root.map(project_agent_paths).unwrap_or_default()
		}
		crate::ResourceScope::Both => {
			return Err(crate::ConfigError::InvalidConfig(
				"Sub-agent load unavailable for Both scope".to_string(),
			));
		}
	};
	let mut seen = HashSet::new();
	let mut agents = Vec::new();
	for path in paths {
		for agent in load_sub_agents_from_dir(&path) {
			if seen.insert(agent.name.clone()) {
				agents.push(agent);
			}
		}
	}
	Ok(agents)
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
		Some(global_agent_write_path),
		Some(project_agent_write_path),
	)
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "goose",
	display_name: "goose",
	surfaces: &[
		AgentSurface::cli("cli", &["goose"], &[data_dir], &["--version"]),
		AgentSurface::desktop("desktop", &[desktop_runtime_path], &[data_dir]),
	],
	precedence: ResourcePrecedence::uniform(ScopePrecedence::ProjectThenGlobal),
	mcp_parse_config: None,
	mcp_serialize_config: None,
	load_mcps: load_no_mcps,
	save_mcps: reject_mcp_save,
	mcp_global_path: None,
	mcp_project_path: None,
	capabilities: Capabilities {
		skills: SkillCapabilities {
			scopes: ScopeSupport {
				global: true,
				project: true,
			},
			universal: true,
			discovery: SkillDiscovery::STANDARD,
			universal_global_path: None,
		},
		mcp: McpCapabilities {
			scopes: ScopeSupport {
				global: false,
				project: false,
			},
			stdio: false,
			sse: false,
			streamable_http: false,
			enable_disable: false,
		},
		sub_agents: SubAgentCapabilities {
			scopes: ScopeSupport {
				global: true,
				project: true,
			},
		},
	},
	global_skill_paths: Some(GlobalSkillPaths {
		read: global_skills_paths,
		write: global_skill_write_path,
		classify: None,
	}),
	project_skill_paths: Some(ProjectSkillPaths {
		read: project_skills_paths,
		write: project_skill_write_path,
		classify: None,
	}),
	global_sub_agent_paths: Some(GlobalSubAgentPaths {
		read: global_agent_paths,
		write: global_agent_write_path,
	}),
	project_sub_agent_paths: Some(ProjectSubAgentPaths {
		read: project_agent_paths,
		write: project_agent_write_path,
	}),
	load_sub_agents,
	save_sub_agents,
	project_markers: &[".agents", ".goose"],
	skills_cli_name: Some("goose"),
	rule_paths: None,
};
