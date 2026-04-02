use crate::descriptor::*;
use std::path::{Path, PathBuf};

fn mcp_global_path() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".config/opencode/opencode.json")
}
fn mcp_project_path(root: &Path) -> PathBuf {
	root.join(".opencode/settings.json")
}
fn global_data_dir() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".config/opencode")
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
		mcp_strategy::PARSE_JSON_OPCODE,
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
		mcp_strategy::SERIALIZE_JSON_OPCODE,
	)
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
	mcp_parse_config: Some(mcp_strategy::PARSE_JSON_OPCODE),
	mcp_serialize_config: Some(mcp_strategy::SERIALIZE_JSON_OPCODE),
	load_mcps,
	save_mcps,
	mcp_global_path,
	mcp_project_path,
	global_data_dir,
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
