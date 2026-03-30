use crate::registry::descriptor::*;
use std::path::{Path, PathBuf};

fn global_path() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".openclaw/openclaw.json")
}
fn project_path(root: &Path) -> PathBuf {
	root.join(".openclaw/openclaw.json")
}

/// Return the global skills directories for OpenClaw, checking fallback dirs.
///
/// Priority: `.openclaw` → `.clawdbot` → `.moltbot`, defaulting to `.openclaw`.
/// The `exists` parameter allows dependency injection for testing.
pub fn get_openclaw_skills_dirs(
	home: &Path,
	exists: impl Fn(&Path) -> bool,
) -> Vec<PathBuf> {
	for dir in [".openclaw", ".clawdbot", ".moltbot"] {
		if exists(&home.join(dir)) {
			return vec![home.join(dir).join("skills")];
		}
	}
	vec![home.join(".openclaw/skills")]
}

fn global_skills_paths() -> Vec<PathBuf> {
	let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from(""));
	get_openclaw_skills_dirs(&home, |p| p.exists())
}
fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![root.join("skills")]
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
		skills: true,
		universal_skills: false,
	},
	global_skills_paths: Some(global_skills_paths),
	project_skills_paths: Some(project_skills_paths),
	cli_name: "openclaw",
	validate_args: &["--version"],
	project_markers: &[".openclaw"],
	skills_cli_name: Some("openclaw"),
};
