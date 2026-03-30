use crate::registry::descriptor::*;
use std::path::{Path, PathBuf};

fn global_path() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".vscode/mcp.json")
}
fn project_path(root: &Path) -> PathBuf {
	root.join(".vscode/mcp.json")
}
fn global_skills_path() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".copilot/skills")
}
fn project_skills_path(root: &Path) -> PathBuf {
	root.join(".agents/skills")
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "copilot",
	display_name: "GitHub Copilot",
	parse_config: mcp_strategy::parse_json_map_servers,
	serialize_config: mcp_strategy::serialize_json_map_servers,
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
	cli_name: "code",
	validate_args: &["--version"],
	project_markers: &[".vscode"],
	skills_cli_name: Some("github-copilot"),
};
