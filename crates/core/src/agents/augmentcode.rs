use crate::registry::descriptor::*;
use std::path::{Path, PathBuf};

pub fn global_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".augmentcode/mcp.json")
}
pub fn project_path(root: &Path) -> PathBuf {
	root.join(".augmentcode/mcp.json")
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "augmentcode",
	display_name: "AugmentCode",
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
	skills_dir: Some(".augment/skills"),
	global_skills_path: None,
	uses_universal_skills: false,
	cli_name: "augmentcode",
	validate_args: &["--version"],
	project_markers: &[".augmentcode"],
};
