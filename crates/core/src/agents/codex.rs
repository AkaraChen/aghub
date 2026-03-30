use crate::registry::descriptor::*;
use std::path::{Path, PathBuf};

fn global_path() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".codex/config.toml")
}
fn project_path(root: &Path) -> PathBuf {
	root.join(".codex/config.toml")
}
fn global_skills_path() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".codex/skills")
}
fn project_skills_path(root: &Path) -> PathBuf {
	root.join(".agents/skills")
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "codex",
	display_name: "OpenAI Codex",
	parse_config: mcp_strategy::PARSE_TOML,
	serialize_config: mcp_strategy::SERIALIZE_TOML,
	global_path,
	project_path,
	capabilities: Capabilities {
		mcp_stdio: true,
		mcp_remote: false,
		mcp_enable_disable: false,
		skills: true,
		universal_skills: false,
	},
	global_skills_path: Some(global_skills_path),
	project_skills_path: Some(project_skills_path),
	cli_name: "codex",
	validate_args: &["--version"],
	project_markers: &[".codex"],
	skills_cli_name: Some("codex"),
};
