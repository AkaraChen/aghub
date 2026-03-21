use crate::registry::descriptor::*;
use std::path::{Path, PathBuf};

pub fn global_path() -> PathBuf {
	#[cfg(any(target_os = "macos", target_os = "linux"))]
	return dirs::home_dir()
		.unwrap()
		.join(".config/opencode/opencode.json");
	#[cfg(target_os = "windows")]
	return dirs::data_dir().unwrap().join("opencode/opencode.json");
}
pub fn project_path(root: &Path) -> PathBuf {
	root.join(".opencode/settings.json")
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
		sub_agents: true,
		skills: true,
		universal_skills: true,
	},
	skills_dir: Some(".agents/skills"),
	global_skills_path: None,
	uses_universal_skills: true,
	cli_name: "opencode",
	validate_args: &["--version"],
	project_markers: &[".opencode"],
};
