use crate::descriptor::*;
use crate::errors::ConfigError;
use std::path::{Path, PathBuf};

fn global_data_dir() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".pi/agent"))
}
fn load_mcps(
	_: Option<&Path>,
	_: crate::ResourceScope,
) -> crate::Result<Vec<crate::McpServer>> {
	Ok(Vec::new())
}
fn save_mcps(
	_: Option<&Path>,
	_: crate::ResourceScope,
	_: &[crate::McpServer],
) -> crate::Result<()> {
	Err(ConfigError::unsupported_operation(
		"persist",
		"MCP server",
		"pi",
	))
}
fn global_skills_paths() -> Vec<PathBuf> {
	match home_dir() {
		Some(home) => vec![home.join(".pi/agent/skills")],
		None => Vec::new(),
	}
}
fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![root.join(".pi/skills")]
}

fn global_skill_write_path() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".pi/agent/skills"))
}

fn project_skill_write_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".pi/skills"))
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "pi",
	display_name: "Pi Coding Agent",
	surfaces: &[AgentSurface::cli(
		"cli",
		&["pi"],
		&[global_data_dir],
		&["--version"],
	)],
	precedence: ResourcePrecedence::uniform(ScopePrecedence::ProjectThenGlobal),
	mcp_parse_config: None,
	mcp_serialize_config: None,
	load_mcps,
	save_mcps,
	mcp_global_path: None,
	mcp_project_path: None,
	capabilities: Capabilities {
		skills: SkillCapabilities {
			scopes: ScopeSupport {
				global: true,
				project: true,
			},
			universal: false,
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
				global: false,
				project: false,
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
	global_sub_agent_paths: None,
	project_sub_agent_paths: None,
	load_sub_agents: load_sub_agents_noop,
	save_sub_agents: save_sub_agents_noop,
	project_markers: &[".pi"],
	skills_cli_name: Some("pi"),
	rule_paths: None,
};
