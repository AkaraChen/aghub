mod mcp;
mod sub_agent;

use crate::descriptor::*;
use std::path::{Path, PathBuf};

fn global_data_dir() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".codex"))
}

fn global_skills_paths() -> Vec<PathBuf> {
	let Some(home) = home_dir() else {
		return Vec::new();
	};
	vec![
		home.join(".codex/skills"),
		home.join(".agents/skills"),
		PathBuf::from("/etc/codex/skills"),
	]
}

fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![root.join(".agents/skills")]
}

fn global_skill_write_path() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".codex/skills"))
}

fn project_skill_write_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".agents/skills"))
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "codex",
	display_name: "OpenAI Codex",
	mcp_parse_config: Some(mcp_strategy::PARSE_TOML),
	mcp_serialize_config: Some(mcp_strategy::SERIALIZE_TOML),
	load_mcps: mcp::load,
	save_mcps: mcp::save,
	mcp_global_path: Some(mcp::global_path),
	mcp_project_path: Some(mcp::project_path),
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
			remote: false,
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
	}),
	project_skill_paths: Some(ProjectSkillPaths {
		read: project_skills_paths,
		write: project_skill_write_path,
	}),
	load_sub_agents: sub_agent::load,
	save_sub_agents: sub_agent::save,
	cli_name: "codex",
	validate_args: &["--version"],
	project_markers: &[".codex"],
	skills_cli_name: Some("codex"),
};
