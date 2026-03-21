use crate::registry::descriptor::*;
use std::path::{Path, PathBuf};

pub fn global_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".factory/mcp.json")
}
pub fn project_path(root: &Path) -> PathBuf {
	root.join(".factory/mcp.json")
}
pub fn global_skills_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".factory/skills")
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
		sub_agents: false,
		skills: true,
		universal_skills: false,
	},
	skills_dir: Some(".factory/skills"),
	global_skills_path: Some(global_skills_path),
	uses_universal_skills: false,
	cli_name: "factory",
	validate_args: &["--version"],
	project_markers: &[".factory"],
};
