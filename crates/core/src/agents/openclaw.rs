use crate::registry::descriptor::*;
use std::path::{Path, PathBuf};

fn global_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".openclaw/openclaw.json")
}
fn project_path(root: &Path) -> PathBuf {
	root.join(".openclaw/openclaw.json")
}

/// Return the global skills directory for OpenClaw, checking fallback dirs.
///
/// Priority: `.openclaw` → `.clawdbot` → `.moltbot`, defaulting to `.openclaw`.
/// The `exists` parameter allows dependency injection for testing.
pub fn get_openclaw_skills_dir(
	home: &Path,
	exists: impl Fn(&Path) -> bool,
) -> PathBuf {
	for dir in [".openclaw", ".clawdbot", ".moltbot"] {
		if exists(&home.join(dir)) {
			return home.join(dir).join("skills");
		}
	}
	home.join(".openclaw/skills")
}

fn global_skills_path() -> PathBuf {
	let home = dirs::home_dir().unwrap();
	get_openclaw_skills_dir(&home, |p| p.exists())
}
fn project_skills_path(root: &Path) -> PathBuf {
	root.join(".openclaw/skills")
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
	skills_dir: Some(".openclaw/skills"),
	global_skills_path: Some(global_skills_path),
	project_skills_path: Some(project_skills_path),
	uses_universal_skills: false,
	cli_name: "openclaw",
	validate_args: &["--version"],
	project_markers: &[".openclaw"],
};
