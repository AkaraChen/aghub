use crate::registry::descriptor::*;
use std::path::{Path, PathBuf};

fn global_path() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".kimi/mcp.json")
}
fn project_path(root: &Path) -> PathBuf {
	root.join(".kimi/mcp.json")
}
fn global_skills_path() -> PathBuf {
	std::env::var_os("XDG_CONFIG_HOME")
		.map(std::path::PathBuf::from)
		.or_else(|| dirs::home_dir().map(|h| h.join(".config")))
		.unwrap_or_else(|| {
			dirs::home_dir()
				.unwrap_or_else(|| std::path::PathBuf::from(""))
				.join(".config")
		})
		.join("agents/skills")
}
fn project_skills_path(root: &Path) -> PathBuf {
	root.join(".agents/skills")
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "kimi",
	display_name: "Kimi Code CLI",
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
	cli_name: "kimi",
	validate_args: &["--version"],
	project_markers: &[".kimi"],
	skills_cli_name: Some("kimi-cli"),
};
