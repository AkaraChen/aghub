use crate::descriptor::*;
use std::path::{Path, PathBuf};

fn data_dir() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".zencoder"))
}

fn global_skills_paths() -> Vec<PathBuf> {
	home_dir()
		.map(|home| vec![home.join(".agents/skills")])
		.unwrap_or_default()
}

fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![
		root.join(".agents/skills"),
		root.join(".claude/skills"),
		root.join(".zencoder/skills"),
	]
}

fn global_skill_write_path() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".agents/skills"))
}

fn project_skill_write_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".agents/skills"))
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "zencoder",
	display_name: "Zencoder",
	surfaces: &[
		AgentSurface::ide("ide", &[], &[data_dir]),
		AgentSurface::desktop("zenflow", &[], &[data_dir]),
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
	project_markers: &[".agents", ".zencoder"],
	skills_cli_name: Some("zencoder"),
	rule_paths: None,
};
