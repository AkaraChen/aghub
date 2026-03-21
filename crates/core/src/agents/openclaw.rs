use crate::registry::descriptor::*;
use std::path::{Path, PathBuf};

pub fn global_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".openclaw/openclaw.json")
}
pub fn project_path(root: &Path) -> PathBuf {
	root.join(".openclaw/openclaw.json")
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "openclaw",
	display_name: "OpenClaw",
	parse_config: mcp_strategy::parse_json_map_mcp_servers,
	serialize_config: mcp_strategy::serialize_json_map_mcp_servers,
	global_path,
	project_path,
	capabilities: Capabilities {
		mcp_stdio: true,
		mcp_remote: true,
		mcp_enable_disable: false,
		sub_agents: false,
		skills: false,
		universal_skills: false,
	},
	skills_dir: None,
	global_skills_path: None,
	uses_universal_skills: false,
	cli_name: "openclaw",
	validate_args: &["--version"],
	project_markers: &[".openclaw"],
};
