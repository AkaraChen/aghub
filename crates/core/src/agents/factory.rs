use crate::registry::descriptor::*;
use std::path::{Path, PathBuf};

fn global_path() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".factory/mcp.json")
}
fn project_path(root: &Path) -> PathBuf {
	root.join(".factory/mcp.json")
}
fn global_skills_path() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".factory/skills")
}
fn project_skills_path(root: &Path) -> PathBuf {
	root.join(".factory/skills")
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "factory",
	display_name: "Factory",
	parse_config: mcp_strategy::parse_json_map_mcp_servers,
	serialize_config: mcp_strategy::serialize_json_map_mcp_servers,
	global_path,
	project_path,
	capabilities: Capabilities {
		mcp_stdio: true,
		mcp_remote: true,
		mcp_enable_disable: false,
		skills: true,
		universal_skills: false,
	},
	global_skills_path: Some(global_skills_path),
	project_skills_path: Some(project_skills_path),
	cli_name: "factory",
	validate_args: &["--version"],
	project_markers: &[".factory"],
	skills_cli_name: Some("droid"),
};
