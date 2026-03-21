use crate::registry::descriptor::*;
use std::path::{Path, PathBuf};

fn global_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".cursor/mcp.json")
}
fn project_path(root: &Path) -> PathBuf {
	root.join(".cursor/mcp.json")
}
fn global_skills_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".cursor/skills")
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "cursor",
	display_name: "Cursor",
	parse_config: mcp_strategy::parse_json_map_mcp_servers,
	serialize_config: mcp_strategy::serialize_json_map_mcp_servers,
	global_path,
	project_path,
	capabilities: Capabilities {
		mcp_stdio: true,
		mcp_remote: true,
		mcp_enable_disable: false,
		skills: true,
		universal_skills: true,
	},
	skills_dir: Some(".agents/skills"),
	global_skills_path: Some(global_skills_path),
	uses_universal_skills: true,
	cli_name: "cursor",
	validate_args: &["--version"],
	project_markers: &[".cursor"],
};
