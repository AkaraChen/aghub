use crate::registry::descriptor::*;
use std::path::{Path, PathBuf};

fn global_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".vibe/mcp.toml")
}
fn project_path(root: &Path) -> PathBuf {
	root.join(".vibe/mcp.toml")
}
fn global_skills_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".vibe/skills")
}
fn project_skills_path(root: &Path) -> PathBuf {
	root.join(".vibe/skills")
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "mistral",
	display_name: "Mistral Le Chat",
	parse_config: mcp_strategy::PARSE_TOML,
	serialize_config: mcp_strategy::SERIALIZE_TOML,
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
	cli_name: "mistral",
	validate_args: &["--version"],
	project_markers: &[".vibe"],
	skills_cli_name: Some("mistral-vibe"),
};
