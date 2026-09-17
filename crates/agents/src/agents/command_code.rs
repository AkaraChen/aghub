use crate::descriptor::*;
use crate::sub_agents::{load_scoped_sub_agents, save_scoped_sub_agents};
use std::path::{Path, PathBuf};

fn data_dir() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".commandcode"))
}

fn mcp_global_path() -> Option<PathBuf> {
	data_dir().map(|root| root.join("mcp.json"))
}

fn load_mcps(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
) -> crate::Result<Vec<crate::McpServer>> {
	load_scoped_mcps(
		project_root,
		scope,
		Some(mcp_global_path),
		None,
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
		None,
		mcp_strategy::serialize_json_map_mcp_servers,
	)
}

fn global_skills_paths() -> Vec<PathBuf> {
	let Some(home) = home_dir() else {
		return Vec::new();
	};
	vec![
		home.join(".commandcode/skills"),
		home.join(".agents/skills"),
	]
}

fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![
		root.join(".commandcode/skills"),
		root.join(".agents/skills"),
	]
}

fn global_skill_write_path() -> Option<PathBuf> {
	data_dir().map(|root| root.join("skills"))
}

fn project_skill_write_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".commandcode/skills"))
}

fn global_agent_dir() -> Option<PathBuf> {
	data_dir().map(|root| root.join("agents"))
}

fn project_agent_dir(root: &Path) -> Option<PathBuf> {
	Some(root.join(".commandcode/agents"))
}

fn global_agent_paths() -> Vec<PathBuf> {
	global_agent_dir().into_iter().collect()
}

fn project_agent_paths(root: &Path) -> Vec<PathBuf> {
	project_agent_dir(root).into_iter().collect()
}

fn load_sub_agents(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
) -> crate::Result<Vec<crate::SubAgent>> {
	load_scoped_sub_agents(
		project_root,
		scope,
		Some(global_agent_dir),
		Some(project_agent_dir),
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
		Some(global_agent_dir),
		Some(project_agent_dir),
	)
}

fn global_rule_paths() -> Vec<PathBuf> {
	data_dir()
		.map(|root| vec![root.join("AGENTS.md")])
		.unwrap_or_default()
}

fn project_rule_paths(root: &Path) -> Vec<PathBuf> {
	vec![root.join("AGENTS.md")]
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "command-code",
	display_name: "Command Code",
	surfaces: &[AgentSurface::cli(
		"cli",
		&["command-code", "cmd", "cmdc"],
		&[data_dir],
		&["--version"],
	)],
	precedence: ResourcePrecedence::uniform(ScopePrecedence::ProjectThenGlobal),
	mcp_parse_config: Some(mcp_strategy::parse_json_map_mcp_servers),
	mcp_serialize_config: Some(mcp_strategy::serialize_json_map_mcp_servers),
	load_mcps,
	save_mcps,
	mcp_global_path: Some(mcp_global_path),
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
				global: true,
				project: false,
			},
			stdio: true,
			sse: true,
			streamable_http: true,
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
		write: global_agent_dir,
	}),
	project_sub_agent_paths: Some(ProjectSubAgentPaths {
		read: project_agent_paths,
		write: project_agent_dir,
	}),
	load_sub_agents,
	save_sub_agents,
	project_markers: &[".commandcode"],
	skills_cli_name: None,
	rule_paths: Some(RulePaths {
		global: Some(global_rule_paths),
		project: Some(project_rule_paths),
	}),
};
