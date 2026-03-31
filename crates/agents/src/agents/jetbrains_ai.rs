use crate::descriptor::*;
use std::path::{Path, PathBuf};

fn global_path() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".jetbrains-ai/mcp.json")
}
fn project_path(root: &Path) -> PathBuf {
	root.join(".jetbrains-ai/mcp.json")
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "jetbrains-ai",
	display_name: "JetBrains AI",
	parse_config: mcp_strategy::parse_json_map_mcp_servers,
	serialize_config: mcp_strategy::serialize_json_map_mcp_servers,
	global_path,
	project_path,
	capabilities: Capabilities {
		mcp_stdio: true,
		mcp_remote: true,
		mcp_enable_disable: false,
		skills: false,
		universal_skills: false,
	},
	global_skills_paths: None,
	project_skills_paths: None,
	cli_name: "jetbrains",
	validate_args: &["--version"],
	project_markers: &[".jetbrains-ai"],
	skills_cli_name: None,
};
