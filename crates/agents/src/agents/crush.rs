use crate::descriptor::*;
use std::path::{Path, PathBuf};

fn config_dir() -> Option<PathBuf> {
	std::env::var_os("XDG_CONFIG_HOME")
		.filter(|value| !value.is_empty())
		.map(PathBuf::from)
		.or_else(|| home_dir().map(|home| home.join(".config")))
}

fn data_dir() -> Option<PathBuf> {
	config_dir().map(|root| root.join("crush"))
}

fn global_skills_paths() -> Vec<PathBuf> {
	let mut paths = std::env::var_os("CRUSH_SKILLS_DIR")
		.filter(|value| !value.is_empty())
		.map(PathBuf::from)
		.into_iter()
		.collect::<Vec<_>>();
	if let Some(root) = config_dir() {
		paths.push(root.join("agents/skills"));
		paths.push(root.join("crush/skills"));
	}
	if let Some(home) = home_dir() {
		paths.push(home.join(".agents/skills"));
		paths.push(home.join(".claude/skills"));
	}
	paths
}

fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![
		root.join(".agents/skills"),
		root.join(".crush/skills"),
		root.join(".claude/skills"),
		root.join(".cursor/skills"),
	]
}

fn global_skill_write_path() -> Option<PathBuf> {
	data_dir().map(|root| root.join("skills"))
}

fn project_skill_write_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".crush/skills"))
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "crush",
	display_name: "Crush",
	surfaces: &[AgentSurface::cli(
		"cli",
		&["crush"],
		&[data_dir],
		&["--version"],
	)],
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
	project_markers: &[".crush", ".crushrc", "crushrc"],
	skills_cli_name: Some("crush"),
	rule_paths: None,
};
