use crate::registry::descriptor::*;
use std::path::{Path, PathBuf};

fn global_path() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".config/opencode/opencode.json")
}
fn project_path(root: &Path) -> PathBuf {
	root.join(".opencode/settings.json")
}
fn global_skills_path() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".config/opencode/skills")
}
fn project_skills_path(root: &Path) -> PathBuf {
	root.join(".agents/skills")
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "opencode",
	display_name: "OpenCode",
	parse_config: mcp_strategy::PARSE_JSON_OPCODE,
	serialize_config: mcp_strategy::SERIALIZE_JSON_OPCODE,
	global_path,
	project_path,
	capabilities: Capabilities {
		mcp_stdio: true,
		mcp_remote: true,
		mcp_enable_disable: true,
		skills: true,
		universal_skills: false,
	},
	global_skills_path: Some(global_skills_path),
	project_skills_path: Some(project_skills_path),
	cli_name: "opencode",
	validate_args: &["--version"],
	project_markers: &[".opencode"],
	skills_cli_name: Some("opencode"),
};
