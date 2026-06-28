use crate::descriptor::*;
use std::path::{Path, PathBuf};

// The Auggie CLI persists MCP servers in ~/.augment/settings.json (a top-level
// "mcpServers" map). There is no project-level MCP file — project servers are
// per-run via `--mcp-config` only — and the IDE extension is GUI-managed.
// See https://docs.augmentcode.com/cli/integrations.
fn mcp_global_path() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".augment/settings.json"))
}
fn global_data_dir() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".augment"))
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

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "augmentcode",
	display_name: "AugmentCode",
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
				global: false,
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
	global_skill_paths: None,
	project_skill_paths: None,
	load_sub_agents: load_sub_agents_noop,
	save_sub_agents: save_sub_agents_noop,
	cli_name: "augmentcode",
	validate_args: &["--version"],
	project_markers: &[],
	skills_cli_name: Some("augment"),
};
