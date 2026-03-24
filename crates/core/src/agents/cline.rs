use crate::registry::descriptor::*;
use std::path::{Path, PathBuf};

fn global_path() -> PathBuf {
	dirs::home_dir()
		.unwrap()
		.join(".cline/data/settings/cline_mcp_settings.json")
}
fn project_path(root: &Path) -> PathBuf {
	root.join(".cline/mcp.json")
}

fn global_skills_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".cline/skills")
}
fn project_skills_path(root: &Path) -> PathBuf {
	root.join(".agents/skills")
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "cline",
	display_name: "Cline",
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
	global_skills_path: Some(global_skills_path),
	project_skills_path: Some(project_skills_path),
	cli_name: "cline",
	validate_args: &["--version"],
	project_markers: &[".cline"],
	skills_cli_name: Some("cline"),
};
