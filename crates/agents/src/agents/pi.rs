use crate::descriptor::*;
use std::path::{Path, PathBuf};

fn global_path() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".pi/agent/config.json")
}
fn project_path(root: &Path) -> PathBuf {
	root.join(".pi/agent/config.json")
}
fn global_skills_paths() -> Vec<PathBuf> {
	vec![dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".pi/agent/skills")]
}
fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![root.join(".pi/skills")]
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "pi",
	display_name: "Pi Coding Agent",
	parse_config: mcp_strategy::parse_none,
	serialize_config: mcp_strategy::serialize_none,
	global_path,
	project_path,
	capabilities: Capabilities {
		mcp_stdio: false,
		mcp_remote: false,
		mcp_enable_disable: false,
		skills: true,
		universal_skills: false,
	},
	global_skills_paths: Some(global_skills_paths),
	project_skills_paths: Some(project_skills_paths),
	cli_name: "pi",
	validate_args: &["--version"],
	project_markers: &[".pi"],
	skills_cli_name: Some("pi"),
};
