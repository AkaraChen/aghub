use crate::registry::descriptor::*;
use std::path::{Path, PathBuf};

fn global_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".kiro/settings/mcp.json")
}
fn project_path(root: &Path) -> PathBuf {
	root.join(".kiro/settings/mcp.json")
}
fn global_skills_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".kiro/skills")
}
fn project_skills_path(root: &Path) -> PathBuf {
	root.join(".kiro/skills")
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "kiro",
	display_name: "Kiro",
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
	global_skills_path: Some(global_skills_path),
	project_skills_path: Some(project_skills_path),
	cli_name: "kiro",
	validate_args: &["--version"],
	project_markers: &[".kiro"],
	skills_cli_name: Some("kiro-cli"),
};
