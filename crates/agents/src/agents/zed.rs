use crate::define_mcp_paths;
use crate::descriptor::*;

define_mcp_paths! {
	global: ".config/zed/settings.json",
	project: ".zed/settings.json",
	data_dir: ".config/zed",
	strategy: mcp_strategy::parse_json_map_context_servers,
			  mcp_strategy::serialize_json_map_context_servers,
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "zed",
	display_name: "Zed",
	surfaces: &[AgentSurface::cli(
		"cli",
		&["zed"],
		&[global_data_dir],
		&["--version"],
	)],
	precedence: ResourcePrecedence::uniform(ScopePrecedence::ProjectThenGlobal),
	mcp_parse_config: Some(mcp_strategy::parse_json_map_context_servers),
	mcp_serialize_config: Some(
		mcp_strategy::serialize_json_map_context_servers,
	),
	load_mcps,
	save_mcps,
	mcp_global_path: Some(mcp_global_path),
	mcp_project_path: Some(mcp_project_path),
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
				global: true,
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
	global_skill_paths: None,
	project_skill_paths: None,
	global_sub_agent_paths: None,
	project_sub_agent_paths: None,
	load_sub_agents: load_sub_agents_noop,
	save_sub_agents: save_sub_agents_noop,
	project_markers: &[".zed"],
	skills_cli_name: None,
	rule_paths: None,
};
