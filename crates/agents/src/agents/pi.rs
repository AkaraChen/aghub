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
	global_skills_paths().into_iter().next()
}

fn project_skill_write_path(root: &Path) -> Option<PathBuf> {
	project_skills_paths(root).into_iter().next()
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "pi",
	display_name: "Pi Coding Agent",
	mcp_parse_config: None,
	mcp_serialize_config: None,
	load_mcps,
	save_mcps,
	mcp_global_path: None,
	mcp_project_path: None,
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
				global: false,
				project: false,
			},
			stdio: false,
			remote: false,
			enable_disable: false,
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
	cli_name: "pi",
	validate_args: &["--version"],
	project_markers: &[".pi"],
	skills_cli_name: Some("pi"),
};
