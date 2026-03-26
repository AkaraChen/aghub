use crate::registry::descriptor::*;
use std::path::{Path, PathBuf};

fn global_path() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".augmentcode/mcp.json")
}
fn project_path(root: &Path) -> PathBuf {
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
		skills: true,
		universal_skills: false,
	},
	global_skills_path: None,
	project_skills_path: None,
	cli_name: "augmentcode",
	validate_args: &["--version"],
	project_markers: &[".augmentcode"],
	skills_cli_name: Some("augment"),
};
