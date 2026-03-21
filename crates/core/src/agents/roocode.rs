use crate::registry::descriptor::*;
use std::path::{Path, PathBuf};

fn global_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".roo/mcp.json")
}
fn project_path(root: &Path) -> PathBuf {
	root.join(".roo/mcp.json")
}
fn global_skills_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".roo/skills")
}
fn project_skills_path(root: &Path) -> PathBuf {
	root.join(".roo/skills")
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "roocode",
	display_name: "RooCode",
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
	skills_dir: Some(".roo/skills"),
	global_skills_path: Some(global_skills_path),
	project_skills_path: Some(project_skills_path),
	uses_universal_skills: false,
	cli_name: "roocode",
	validate_args: &["--version"],
	project_markers: &[".roo"],
};
