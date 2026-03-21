use crate::registry::descriptor::*;
use std::path::{Path, PathBuf};

fn global_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".config/zed/settings.json")
}
fn project_path(root: &Path) -> PathBuf {
	root.join(".zed/settings.json")
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "zed",
	display_name: "Zed",
	parse_config: mcp_strategy::parse_json_map_context_servers,
	serialize_config: mcp_strategy::serialize_json_map_context_servers,
	global_path,
	project_path,
	capabilities: Capabilities {
		mcp_stdio: true,
		mcp_remote: true,
		mcp_enable_disable: false,
		skills: false,
		universal_skills: false,
	},
	skills_dir: None,
	global_skills_path: None,
	project_skills_path: None,
	uses_universal_skills: false,
	cli_name: "zed",
	validate_args: &["--version"],
	project_markers: &[".zed"],
};
