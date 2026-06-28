use crate::descriptor::*;
use crate::errors::ConfigError;
use std::path::{Path, PathBuf};

// JetBrains AI Assistant configures MCP only through the IDE GUI (Settings |
// Tools | AI Assistant | Model Context Protocol), with a global/project "Level"
// and "Import from Claude". There is no externally-writable config file, so
// aghub does not manage MCP for it. (Junie — a different JetBrains agent — is
// file-based at ~/.junie/mcp/mcp.json, but that is a separate product.)
// See https://www.jetbrains.com/help/ai-assistant/configure-an-mcp-server.html.
fn global_data_dir() -> Option<PathBuf> {
	// Detect a JetBrains install via the OS config dir:
	// ~/Library/Application Support/JetBrains (macOS), ~/.config/JetBrains (Linux).
	dirs::config_dir().map(|dir| dir.join("JetBrains"))
}
fn load_mcps(
	_: Option<&Path>,
	_: crate::ResourceScope,
) -> crate::Result<Vec<crate::McpServer>> {
	Ok(Vec::new())
}
fn save_mcps(
	_: Option<&Path>,
	_: crate::ResourceScope,
	_: &[crate::McpServer],
) -> crate::Result<()> {
	Err(ConfigError::unsupported_operation(
		"persist",
		"MCP server",
		"jetbrains-ai",
	))
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "jetbrains-ai",
	display_name: "JetBrains AI",
	mcp_parse_config: None,
	mcp_serialize_config: None,
	load_mcps,
	save_mcps,
	mcp_global_path: None,
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
				global: false,
				project: false,
			},
			stdio: false,
			remote: false,
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
	cli_name: "jetbrains",
	validate_args: &["--version"],
	project_markers: &[],
	skills_cli_name: None,
};
