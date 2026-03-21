use crate::registry::descriptor::*;
use std::path::{Path, PathBuf};

pub fn global_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".warp/mcp.json")
}
pub fn project_path(root: &Path) -> PathBuf {
	root.join(".warp/mcp.json")
}

pub fn global_skills_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".config/agents/skills")
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "warp",
	display_name: "Warp",
	parse_config: mcp_strategy::parse_json_map_mcp_servers,
	serialize_config: mcp_strategy::serialize_json_map_mcp_servers,
	global_path,
	project_path,
	capabilities: Capabilities {
		mcp_stdio: true,
		mcp_remote: true,
		mcp_enable_disable: false,
		sub_agents: false,
		skills: true,
		universal_skills: true,
	},
	skills_dir: Some(".agents/skills"),
	global_skills_path: Some(global_skills_path),
	uses_universal_skills: true,
	cli_name: "warp",
	validate_args: &["--version"],
	project_markers: &[".warp"],
};
