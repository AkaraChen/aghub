use crate::descriptor::*;
use std::path::{Path, PathBuf};

fn global_path() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".config/opencode/opencode.json")
}
fn project_path(root: &Path) -> PathBuf {
	root.join(".opencode/settings.json")
}
fn global_skills_paths() -> Vec<PathBuf> {
	let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from(""));
	vec![
		home.join(".config/opencode/skills"),
		home.join(".claude/skills"),
		home.join(".agents/skills"),
	]
}
fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![
		root.join(".opencode/skills"),
		root.join(".claude/skills"),
		root.join(".agents/skills"),
	]
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
	global_skills_paths: Some(global_skills_paths),
	project_skills_paths: Some(project_skills_paths),
	cli_name: "opencode",
	validate_args: &["--version"],
	project_markers: &[".opencode"],
	skills_cli_name: Some("opencode"),
};
