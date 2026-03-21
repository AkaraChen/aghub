use crate::registry::descriptor::*;
use std::path::{Path, PathBuf};

pub fn global_path() -> PathBuf {
	dirs::home_dir()
		.unwrap()
		.join(".cline/data/settings/cline_mcp_settings.json")
}
pub fn project_path(root: &Path) -> PathBuf {
	root.join(".cline/mcp.json")
}

pub fn global_skills_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".cline/skills")
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "cline",
	display_name: "Cline",
	parse_config: mcp_strategy::parse_none,
	serialize_config: mcp_strategy::serialize_none,
	global_path,
	project_path,
	capabilities: Capabilities {
		mcp_stdio: false,
		mcp_remote: false,
		mcp_enable_disable: false,
		skills: true,
		universal_skills: true,
	},
	skills_dir: Some(".agents/skills"),
	global_skills_path: Some(global_skills_path),
	uses_universal_skills: true,
	cli_name: "cline",
	validate_args: &["--version"],
	project_markers: &[".cline"],
};
