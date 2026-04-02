use crate::descriptor::*;
use std::path::{Path, PathBuf};

fn mcp_global_path() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".augmentcode/mcp.json")
}
fn mcp_project_path(root: &Path) -> PathBuf {
	root.join(".augmentcode/mcp.json")
}
fn global_data_dir() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".augmentcode")
}
fn load_mcps(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
) -> crate::Result<Vec<crate::McpServer>> {
	load_scoped_mcps(
		project_root,
		scope,
		mcp_global_path,
		mcp_project_path,
		mcp_strategy::parse_json_map_mcp_servers,
	)
}
fn save_mcps(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
	mcps: &[crate::McpServer],
) -> crate::Result<()> {
	save_scoped_mcps(
		project_root,
		scope,
		mcps,
		mcp_global_path,
		mcp_project_path,
		mcp_strategy::serialize_json_map_mcp_servers,
	)
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "augmentcode",
	display_name: "AugmentCode",
	mcp_parse_config: Some(mcp_strategy::parse_json_map_mcp_servers),
	mcp_serialize_config: Some(mcp_strategy::serialize_json_map_mcp_servers),
	load_mcps,
	save_mcps,
	mcp_global_path,
	mcp_project_path,
	global_data_dir,
	capabilities: Capabilities {
		mcp_stdio: true,
		mcp_remote: true,
		mcp_enable_disable: false,
		skills: true,
		universal_skills: false,
	},
	global_skills_paths: None,
	project_skills_paths: None,
	cli_name: "augmentcode",
	validate_args: &["--version"],
	project_markers: &[".augmentcode"],
	skills_cli_name: Some("augment"),
};
