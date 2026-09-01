use crate::define_mcp_paths;
use crate::define_skill_paths;
use crate::descriptor::*;

define_mcp_paths! {
	global: ".vscode/mcp.json",
	project: ".vscode/mcp.json",
	data_dir: ".copilot",
	strategy: mcp_strategy::parse_json_map_servers,
			  mcp_strategy::serialize_json_map_servers,
}

define_skill_paths! {
	global: ".copilot/skills",
	project: ".agents/skills",
}

fn global_rule_paths() -> Vec<std::path::PathBuf> {
	home_dir()
		.map(|home| vec![home.join(".copilot/copilot-instructions.md")])
		.unwrap_or_default()
}

fn project_rule_paths(root: &std::path::Path) -> Vec<std::path::PathBuf> {
	vec![
		root.join(".github/copilot-instructions.md"),
		root.join("AGENTS.md"),
	]
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "copilot",
	display_name: "GitHub Copilot",
	mcp_parse_config: Some(mcp_strategy::parse_json_map_servers),
	mcp_serialize_config: Some(mcp_strategy::serialize_json_map_servers),
	load_mcps,
	save_mcps,
	mcp_global_path: Some(mcp_global_path),
	mcp_project_path: Some(mcp_project_path),
	global_data_dir,
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
	}),
	project_skill_paths: Some(ProjectSkillPaths {
		read: project_skills_paths,
		write: project_skill_write_path,
	}),
	load_sub_agents: load_sub_agents_noop,
	save_sub_agents: save_sub_agents_noop,
	cli_name: "code",
	validate_args: &["--version"],
	project_markers: &[".vscode"],
	skills_cli_name: Some("github-copilot"),
	rule_paths: Some(RulePaths {
		global: Some(global_rule_paths),
		project: Some(project_rule_paths),
	}),
};
