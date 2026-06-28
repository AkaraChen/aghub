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
fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![root.join(".trae/skills")]
}
fn project_skill_write_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".trae/skills"))
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "trae",
	display_name: "Trae",
	mcp_parse_config: Some(mcp_strategy::parse_json_map_mcp_servers),
	mcp_serialize_config: Some(mcp_strategy::serialize_json_map_mcp_servers),
	load_mcps,
	save_mcps,
	mcp_global_path: None,
	mcp_project_path: Some(mcp_project_path),
	global_data_dir,
	capabilities: Capabilities {
		skills: SkillCapabilities {
			scopes: ScopeSupport {
				global: false,
				project: true,
			},
			universal: false,
		},
		mcp: McpCapabilities {
			scopes: ScopeSupport {
				global: false,
				project: true,
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
	global_skill_paths: None,
	project_skill_paths: Some(ProjectSkillPaths {
		read: project_skills_paths,
		write: project_skill_write_path,
	}),
	load_sub_agents: load_sub_agents_noop,
	save_sub_agents: save_sub_agents_noop,
	cli_name: "trae",
	validate_args: &["--version"],
	project_markers: &[".trae"],
	skills_cli_name: Some("trae"),
};
