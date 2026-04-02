use crate::descriptor::*;
use crate::errors::ConfigError;
use std::path::{Path, PathBuf};

fn mcp_global_path() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".pi/agent/config.json")
}
fn mcp_project_path(root: &Path) -> PathBuf {
	root.join(".pi/agent/config.json")
}
fn global_data_dir() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".pi/agent")
}
fn load_mcps(
	_: Option<&Path>,
	_: crate::ResourceScope,
) -> crate::Result<Vec<crate::McpServer>> {
	Ok(Vec::new())
}
fn save_mcps(
	_: Option<&Path>,
	_: crate::ResourceScope,
	_: &[crate::McpServer],
) -> crate::Result<()> {
	Err(ConfigError::unsupported_operation(
		"persist",
		"MCP server",
		"pi",
	))
}
fn global_skills_paths() -> Vec<PathBuf> {
	vec![dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".pi/agent/skills")]
}
fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![root.join(".pi/skills")]
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "pi",
	display_name: "Pi Coding Agent",
	mcp_parse_config: None,
	mcp_serialize_config: None,
	load_mcps,
	save_mcps,
	mcp_global_path,
	mcp_project_path,
	global_data_dir,
	capabilities: Capabilities {
		mcp_stdio: false,
		mcp_remote: false,
		mcp_enable_disable: false,
		skills: true,
		universal_skills: false,
	},
	global_skills_paths: Some(global_skills_paths),
	project_skills_paths: Some(project_skills_paths),
	cli_name: "pi",
	validate_args: &["--version"],
	project_markers: &[".pi"],
	skills_cli_name: Some("pi"),
};
