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
	mcp_parse_config: Some(mcp_strategy::parse_json_map_context_servers),
	mcp_serialize_config: Some(
		mcp_strategy::serialize_json_map_context_servers,
	),
	load_mcps,
	save_mcps,
	mcp_global_path: Some(mcp_global_path),
	mcp_project_path: Some(mcp_project_path),
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
	project_skill_paths: None,
	load_sub_agents: load_sub_agents_noop,
	save_sub_agents: save_sub_agents_noop,
	cli_name: "zed",
	validate_args: &["--version"],
	project_markers: &[".zed"],
	skills_cli_name: None,
};
