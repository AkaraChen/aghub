use crate::descriptor::*;
use std::fs;
use std::path::{Path, PathBuf};

fn data_dir() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".continue"))
}

fn collect_markdown(root: &Path, files: &mut Vec<PathBuf>) {
	let Ok(entries) = fs::read_dir(root) else {
		return;
	};
	let mut entries = entries.flatten().collect::<Vec<_>>();
	entries.sort_by_key(|entry| entry.file_name());
	for entry in entries {
		let path = entry.path();
		let Ok(file_type) = entry.file_type() else {
			continue;
		};
		if file_type.is_dir() {
			collect_markdown(&path, files);
		} else if file_type.is_file()
			&& path.extension().and_then(|value| value.to_str()) == Some("md")
		{
			files.push(path);
		}
	}
}

fn global_rule_paths() -> Vec<PathBuf> {
	let mut files = Vec::new();
	if let Some(root) = data_dir() {
		collect_markdown(&root.join("rules"), &mut files);
	}
	files
}

fn project_rule_paths(root: &Path) -> Vec<PathBuf> {
	let mut files = Vec::new();
	collect_markdown(&root.join(".continue/rules"), &mut files);
	files
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "continue",
	display_name: "Continue",
	surfaces: &[
		AgentSurface::cli("cli", &["cn"], &[data_dir], &["--version"]),
		AgentSurface::ide("ide", &[], &[data_dir]),
	],
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
	project_markers: &[".continue"],
	skills_cli_name: None,
	rule_paths: Some(RulePaths {
		global: Some(global_rule_paths),
		project: Some(project_rule_paths),
	}),
};
