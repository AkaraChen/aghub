use crate::registry::descriptor::*;
use std::path::{Path, PathBuf};

pub fn global_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".kilocode/mcp.json")
}
pub fn project_path(root: &Path) -> PathBuf {
	root.join(".kilocode/mcp.json")
}
pub fn global_skills_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".kilocode/skills")
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "kilocode",
	display_name: "KiloCode",
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
	skills_dir: Some(".kilocode/skills"),
	global_skills_path: Some(global_skills_path),
	uses_universal_skills: false,
	cli_name: "kilocode",
	validate_args: &["--version"],
	project_markers: &[".kilocode"],
};
