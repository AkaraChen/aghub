use crate::define_mcp_paths;
use crate::descriptor::*;
use crate::sub_agents::{load_scoped_sub_agents, save_scoped_sub_agents};
use std::fs;
use std::path::{Path, PathBuf};

define_mcp_paths! {
	global: ".codebuddy/.mcp.json",
	project: ".mcp.json",
	data_dir: ".codebuddy",
	strategy: mcp_strategy::parse_json_map_mcp_servers,
			  mcp_strategy::serialize_json_map_mcp_servers,
}

fn global_skills_paths() -> Vec<PathBuf> {
	home_dir()
		.map(|home| vec![home.join(".codebuddy/skills")])
		.unwrap_or_default()
}

fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![root.join(".codebuddy/skills")]
}

fn global_skill_write_path() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".codebuddy/skills"))
}

fn project_skill_write_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".codebuddy/skills"))
}

fn global_agent_dir() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".codebuddy/agents"))
}

fn project_agent_dir(root: &Path) -> Option<PathBuf> {
	Some(root.join(".codebuddy/agents"))
}

fn global_agent_paths() -> Vec<PathBuf> {
	global_agent_dir().into_iter().collect()
}

fn project_agent_paths(root: &Path) -> Vec<PathBuf> {
	project_agent_dir(root).into_iter().collect()
}

fn load_sub_agents(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
) -> crate::Result<Vec<crate::SubAgent>> {
	load_scoped_sub_agents(
		project_root,
		scope,
		Some(global_agent_dir),
		Some(project_agent_dir),
	)
}

fn save_sub_agents(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
	agents: &[crate::SubAgent],
) -> crate::Result<()> {
	save_scoped_sub_agents(
		project_root,
		scope,
		agents,
		Some(global_agent_dir),
		Some(project_agent_dir),
	)
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
	let Some(home) = home_dir() else {
		return Vec::new();
	};
	let mut files = Vec::new();
	collect_markdown(&home.join(".codebuddy/rules"), &mut files);
	files.push(home.join(".codebuddy/CODEBUDDY.md"));
	files
}

fn project_rule_paths(root: &Path) -> Vec<PathBuf> {
	let mut files = Vec::new();
	collect_markdown(&root.join(".codebuddy/rules"), &mut files);
	files.push(root.join("CODEBUDDY.md"));
	files
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "codebuddy",
	display_name: "CodeBuddy",
	surfaces: &[AgentSurface::cli(
		"cli",
		&["codebuddy"],
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
				global: true,
				project: true,
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
	global_sub_agent_paths: Some(GlobalSubAgentPaths {
		read: global_agent_paths,
		write: global_agent_dir,
	}),
	project_sub_agent_paths: Some(ProjectSubAgentPaths {
		read: project_agent_paths,
		write: project_agent_dir,
	}),
	load_sub_agents,
	save_sub_agents,
	project_markers: &[".codebuddy"],
	skills_cli_name: None,
	rule_paths: Some(RulePaths {
		global: Some(global_rule_paths),
		project: Some(project_rule_paths),
	}),
};
