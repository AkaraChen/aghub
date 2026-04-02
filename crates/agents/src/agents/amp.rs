use crate::descriptor::*;
use std::path::{Path, PathBuf};

fn mcp_global_path() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".config/amp/settings.json"))
}
fn mcp_project_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".amp/mcp.json"))
}
fn global_data_dir() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".config/amp"))
}
fn load_mcps(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
) -> crate::Result<Vec<crate::McpServer>> {
	load_scoped_mcps(
		project_root,
		scope,
		Some(mcp_global_path),
		Some(mcp_project_path),
		mcp_strategy::parse_json_map_nested_amp_mcp_servers,
	)
}
fn save_mcps(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
	mcps: &[crate::McpServer],
) -> crate::Result<()> {
	save_scoped_mcps(
		project_root,
		scope,
		mcps,
		Some(mcp_global_path),
		Some(mcp_project_path),
		mcp_strategy::serialize_json_map_nested_amp_mcp_servers,
	)
}
fn global_skills_paths() -> Vec<PathBuf> {
	match home_dir() {
		Some(home) => vec![home.join(".config/agents/skills")],
		None => Vec::new(),
	}
}
fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![root.join(".agents/skills")]
}

fn global_skill_write_path() -> Option<PathBuf> {
	global_skills_paths().into_iter().next()
}

fn project_skill_write_path(root: &Path) -> Option<PathBuf> {
	project_skills_paths(root).into_iter().next()
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "amp",
	display_name: "Amp",
	mcp_parse_config: Some(mcp_strategy::parse_json_map_nested_amp_mcp_servers),
	mcp_serialize_config: Some(
		mcp_strategy::serialize_json_map_nested_amp_mcp_servers,
	),
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
			remote: true,
			enable_disable: false,
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
	cli_name: "amp",
	validate_args: &["--version"],
	project_markers: &[".amp"],
	skills_cli_name: Some("amp"),
};
