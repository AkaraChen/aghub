use crate::descriptor::*;
use std::path::{Path, PathBuf};

fn global_path() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".trae/mcp.json")
}
fn project_path(root: &Path) -> PathBuf {
	root.join(".trae/mcp.json")
}

fn global_skills_paths() -> Vec<PathBuf> {
	vec![dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".trae/skills")]
}
fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![root.join(".trae/skills")]
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "trae",
	display_name: "Trae",
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
	global_skills_paths: Some(global_skills_paths),
	project_skills_paths: Some(project_skills_paths),
	cli_name: "trae",
	validate_args: &["--version"],
	project_markers: &[".trae"],
	skills_cli_name: Some("trae"),
};
