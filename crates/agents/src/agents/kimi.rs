use crate::define_mcp_paths;
use crate::define_skill_paths;
use crate::descriptor::*;

define_mcp_paths! {
	symmetric: ".kimi/mcp.json",
	strategy: mcp_strategy::parse_json_map_mcp_servers,
			  mcp_strategy::serialize_json_map_mcp_servers,
}

define_skill_paths! {
	global: ".config/agents/skills",
	project: ".agents/skills",
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "kimi",
	display_name: "Kimi Code CLI",
	surfaces: &[AgentSurface::cli(
		"cli",
		&["kimi"],
		&[global_data_dir],
		&["--version"],
	)],
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
				global: true,
				project: true,
			},
			universal: true,
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
	project_markers: &[".kimi"],
	skills_cli_name: Some("kimi-cli"),
	rule_paths: None,
};
