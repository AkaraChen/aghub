use crate::descriptor::*;
use std::path::PathBuf;

fn config_path() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".aider.conf.yml"))
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "aider",
	display_name: "Aider",
	surfaces: &[AgentSurface::cli(
		"cli",
		&["aider"],
		&[config_path],
		&["--version"],
	)],
	precedence: ResourcePrecedence::uniform(ScopePrecedence::ProjectThenGlobal),
	mcp_parse_config: None,
	mcp_serialize_config: None,
	load_mcps: load_no_mcps,
	save_mcps: reject_mcp_save,
	mcp_global_path: None,
	mcp_project_path: None,
	capabilities: Capabilities {
		skills: SkillCapabilities {
			scopes: ScopeSupport {
				global: false,
				project: false,
			},
			universal: false,
			discovery: SkillDiscovery::STANDARD,
			universal_global_path: None,
		},
		mcp: McpCapabilities {
			scopes: ScopeSupport {
				global: false,
				project: false,
			},
			stdio: false,
			sse: false,
			streamable_http: false,
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
	global_sub_agent_paths: None,
	project_sub_agent_paths: None,
	load_sub_agents: load_sub_agents_noop,
	save_sub_agents: save_sub_agents_noop,
	project_markers: &[".aider.conf.yml"],
	skills_cli_name: None,
	rule_paths: None,
};
