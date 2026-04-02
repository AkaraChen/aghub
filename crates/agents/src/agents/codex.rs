use crate::descriptor::*;
use std::path::{Path, PathBuf};

fn mcp_global_path() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".codex/config.toml"))
}
fn mcp_project_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".codex/config.toml"))
}
fn global_data_dir() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".codex"))
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
		mcp_strategy::PARSE_TOML,
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
		mcp_strategy::SERIALIZE_TOML,
	)
}
fn global_skills_paths() -> Vec<PathBuf> {
	let Some(home) = home_dir() else {
		return Vec::new();
	};
	vec![
		home.join(".codex/skills"),
		home.join(".agents/skills"),
		PathBuf::from("/etc/codex/skills"),
	]
}
fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![root.join(".agents/skills")]
}

fn global_skill_write_path() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".codex/skills"))
}

fn project_skill_write_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".agents/skills"))
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "codex",
	display_name: "OpenAI Codex",
	mcp_parse_config: Some(mcp_strategy::PARSE_TOML),
	mcp_serialize_config: Some(mcp_strategy::SERIALIZE_TOML),
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
			universal: false,
		},
		mcp: McpCapabilities {
			scopes: ScopeSupport {
				global: true,
				project: true,
			},
			stdio: true,
			remote: false,
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
	cli_name: "codex",
	validate_args: &["--version"],
	project_markers: &[".codex"],
	skills_cli_name: Some("codex"),
};
