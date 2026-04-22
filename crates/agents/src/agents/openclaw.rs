use crate::descriptor::*;
use std::path::{Path, PathBuf};

fn mcp_global_path() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".openclaw/workspace/config/mcporter.json"))
}
fn global_data_dir() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".openclaw"))
}
fn load_mcps(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
) -> crate::Result<Vec<crate::McpServer>> {
	load_scoped_mcps(
		project_root,
		scope,
		Some(mcp_global_path),
		None,
		mcp_strategy::parse_json_map_mcp_servers,
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
		Some(mcp_global_path),
		None,
		mcp_strategy::serialize_json_map_mcp_servers,
	)
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
	let Some(home) = home_dir() else {
		return Vec::new();
	};
	let mut paths = get_openclaw_skills_dirs(&home, |p| p.exists());

	// Dynamic discovery: which openclaw → canonicalize → parent/skills
	// This allows finding skills from npm global installation or other symlinked locations
	if let Ok(cli_path) = which::which("openclaw") {
		if let Ok(real_path) = cli_path.canonicalize() {
			// real_path might be: /opt/homebrew/lib/node_modules/openclaw/openclaw.mjs
			// skills dir should be: /opt/homebrew/lib/node_modules/openclaw/skills/
			if let Some(parent) = real_path.parent() {
				let npm_skills_dir = parent.join("skills");
				if npm_skills_dir.exists() {
					paths.push(npm_skills_dir);
				}
			}
		}
	}

	paths
}
fn global_skill_write_path() -> Option<PathBuf> {
	home_dir().map(|home| {
		get_openclaw_skills_dirs(&home, |p| p.exists())
			.into_iter()
			.next()
			.unwrap_or_else(|| home.join(".openclaw/skills"))
	})
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "openclaw",
	display_name: "OpenClaw",
	mcp_parse_config: Some(mcp_strategy::parse_json_map_mcp_servers),
	mcp_serialize_config: Some(mcp_strategy::serialize_json_map_mcp_servers),
	load_mcps,
	save_mcps,
	mcp_global_path: Some(mcp_global_path),
	mcp_project_path: None,
	global_data_dir,
	capabilities: Capabilities {
		skills: SkillCapabilities {
			scopes: ScopeSupport {
				global: true,
				project: false,
			},
			universal: false,
		},
		mcp: McpCapabilities {
			scopes: ScopeSupport {
				global: true,
				project: false,
			},
			stdio: true,
			remote: true,
			enable_disable: false,
		},
		sub_agents: SubAgentCapabilities {
			scopes: ScopeSupport {
				global: false,
				project: false,
			},
		},
	},
	global_skill_paths: Some(GlobalSkillPaths {
		read: global_skills_paths,
		write: global_skill_write_path,
	}),
	project_skill_paths: None,
	load_sub_agents: load_sub_agents_noop,
	save_sub_agents: save_sub_agents_noop,
	cli_name: "openclaw",
	validate_args: &["--version"],
	project_markers: &[".openclaw"],
	skills_cli_name: Some("openclaw"),
};
