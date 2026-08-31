use crate::define_mcp_paths;
use crate::define_skill_paths;
use crate::descriptor::*;

define_mcp_paths! {
	symmetric: ".gemini/settings.json",
	strategy: crate::format::json_map::parse_gemini,
			  crate::format::json_map::serialize_gemini,
}

define_skill_paths! {
	global: ".gemini/skills",
	project: ".agents/skills",
}

fn global_rule_paths() -> Vec<std::path::PathBuf> {
	home_dir()
		.map(|home| vec![home.join(".gemini/GEMINI.md")])
		.unwrap_or_default()
}

fn project_rule_paths(root: &std::path::Path) -> Vec<std::path::PathBuf> {
	vec![root.join("GEMINI.md")]
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "gemini",
	display_name: "Gemini CLI",
	mcp_parse_config: Some(crate::format::json_map::parse_gemini),
	mcp_serialize_config: Some(crate::format::json_map::serialize_gemini),
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
	cli_name: "gemini",
	validate_args: &["--version"],
	project_markers: &[".gemini"],
	skills_cli_name: Some("gemini-cli"),
	rule_paths: Some(RulePaths {
		global: Some(global_rule_paths),
		project: Some(project_rule_paths),
	}),
};
