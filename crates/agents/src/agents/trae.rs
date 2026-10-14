use crate::descriptor::*;
use std::path::{Path, PathBuf};

// Trae configures MCP through its GUI (Settings > MCP); there is no documented
// hand-editable GLOBAL file — the global store is the IDE's opaque app data.
// Only the project-level `.trae/` directory (mcp.json, skills, rules) is real.
// See https://docs.trae.ai and https://github.com/trae-community/trae-mcp.
fn mcp_project_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".trae/mcp.json"))
}
fn global_data_dir() -> Option<PathBuf> {
	// Trae is a VS Code fork: its app data lives in the OS config dir —
	// ~/Library/Application Support/Trae (macOS), ~/.config/Trae (Linux),
	// %APPDATA%\Trae (Windows). Used for availability/reveal, not for writing.
	dirs::config_dir().map(|dir| dir.join("Trae"))
}
fn load_mcps(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
) -> crate::Result<Vec<crate::McpServer>> {
	load_scoped_mcps(
		project_root,
		scope,
		None,
		Some(mcp_project_path),
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
		None,
		Some(mcp_project_path),
		mcp_strategy::serialize_json_map_mcp_servers,
	)
}
fn global_skills_paths() -> Vec<PathBuf> {
	let Some(home) = home_dir() else {
		return Vec::new();
	};
	vec![home.join(".traecli/skills"), home.join(".trae-cn/skills")]
}
fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![
		root.join(".traecli/skills"),
		root.join(".trae/skills"),
		root.join(".agents/skills"),
	]
}
fn global_skill_write_path() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".traecli/skills"))
}
fn project_skill_write_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".traecli/skills"))
}

fn ide_runtime_path() -> Option<PathBuf> {
	#[cfg(target_os = "macos")]
	{
		Some(PathBuf::from("/Applications/Trae.app"))
	}
	#[cfg(target_os = "linux")]
	{
		Some(PathBuf::from("/usr/share/applications/trae.desktop"))
	}
	#[cfg(target_os = "windows")]
	{
		dirs::data_local_dir().map(|dir| dir.join("Programs/Trae/Trae.exe"))
	}
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "trae",
	display_name: "Trae",
	surfaces: &[
		AgentSurface::ide("ide", &[ide_runtime_path], &[global_data_dir])
			.with_skill_path_markers(&["/.trae/", "/.trae-cn/"]),
		AgentSurface::cli("cli", &["traecli"], &[], &["--version"])
			.with_skill_path_markers(&["/.traecli/", "/.trae/", "/.trae-cn/"]),
	],
	precedence: ResourcePrecedence::uniform(ScopePrecedence::ProjectThenGlobal),
	mcp_parse_config: Some(mcp_strategy::parse_json_map_mcp_servers),
	mcp_serialize_config: Some(mcp_strategy::serialize_json_map_mcp_servers),
	load_mcps,
	save_mcps,
	mcp_global_path: None,
	mcp_project_path: Some(mcp_project_path),
	capabilities: Capabilities {
		skills: SkillCapabilities {
			scopes: ScopeSupport {
				global: true,
				project: true,
			},
			universal: false,
			discovery: SkillDiscovery::STANDARD,
			universal_global_path: None,
		},
		mcp: McpCapabilities {
			scopes: ScopeSupport {
				global: false,
				project: true,
			},
			stdio: true,
			sse: true,
			streamable_http: true,
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
		classify: None,
	}),
	project_skill_paths: Some(ProjectSkillPaths {
		read: project_skills_paths,
		write: project_skill_write_path,
		classify: None,
	}),
	global_sub_agent_paths: None,
	project_sub_agent_paths: None,
	load_sub_agents: load_sub_agents_noop,
	save_sub_agents: save_sub_agents_noop,
	project_markers: &[".trae", ".traecli"],
	skills_cli_name: Some("trae"),
	rule_paths: None,
};
