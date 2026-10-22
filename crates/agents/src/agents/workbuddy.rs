use crate::define_mcp_paths;
use crate::descriptor::*;

define_mcp_paths! {
	symmetric: ".workbuddy/mcp.json",
	strategy: mcp_strategy::parse_json_map_mcp_servers,
			  mcp_strategy::serialize_json_map_mcp_servers,
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "workbuddy",
	display_name: "WorkBuddy",
	surfaces: &[
		AgentSurface::ide("ide", &[], &[global_data_dir]),
		AgentSurface::desktop("desktop", &[], &[global_data_dir]),
	],
	precedence: ResourcePrecedence::uniform(ScopePrecedence::ProjectThenGlobal),
	mcp_parse_config: Some(mcp_strategy::parse_json_map_mcp_servers),
	mcp_serialize_config: Some(mcp_strategy::serialize_json_map_mcp_servers),
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
	project_markers: &[".workbuddy"],
	skills_cli_name: None,
	rule_paths: None,
};
