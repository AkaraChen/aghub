use crate::registry::descriptor::*;
use std::path::{Path, PathBuf};

fn global_path() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".config/amp/settings.json")
}
fn project_path(root: &Path) -> PathBuf {
	root.join(".amp/mcp.json")
}
fn global_skills_paths() -> Vec<PathBuf> {
	vec![dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".config/agents/skills")]
}
fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![root.join(".agents/skills")]
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "amp",
	display_name: "Amp",
	parse_config: mcp_strategy::parse_json_map_nested_amp_mcp_servers,
	serialize_config: mcp_strategy::serialize_json_map_nested_amp_mcp_servers,
	global_path,
	project_path,
	capabilities: Capabilities {
		mcp_stdio: true,
		mcp_remote: true,
		mcp_enable_disable: false,
		skills: true,
		universal_skills: true,
	},
	global_skills_paths: Some(global_skills_paths),
	project_skills_paths: Some(project_skills_paths),
	cli_name: "amp",
	validate_args: &["--version"],
	project_markers: &[".amp"],
	skills_cli_name: Some("amp"),
};
