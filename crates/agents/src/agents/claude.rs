use crate::descriptor::*;
use std::path::{Path, PathBuf};

fn mcp_global_path() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".claude.json")
}
fn mcp_project_path(root: &Path) -> PathBuf {
	root.join(".mcp.json")
}
fn global_data_dir() -> PathBuf {
	dirs::home_dir()
		.unwrap_or_else(|| std::path::PathBuf::from(""))
		.join(".claude")
}
fn load_mcps(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
) -> crate::Result<Vec<crate::McpServer>> {
	load_scoped_mcps(
		project_root,
		scope,
		mcp_global_path,
		mcp_project_path,
		mcp_strategy::parse_json_map_mcp_servers,
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
		mcp_global_path,
		mcp_project_path,
		mcp_strategy::serialize_json_map_mcp_servers,
	)
}
fn global_skills_paths() -> Vec<PathBuf> {
	let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from(""));
	let mut paths = vec![home.join(".claude/skills")];

	let marketplaces = home.join(".claude/plugins/marketplaces");
	if marketplaces.is_dir() {
		collect_skills_dirs(&marketplaces, &mut paths);
	}

	paths
}

fn collect_skills_dirs(dir: &Path, paths: &mut Vec<PathBuf>) {
	if let Ok(entries) = std::fs::read_dir(dir) {
		for entry in entries.filter_map(|e| e.ok()) {
			let path = entry.path();
			if path.is_dir() {
				if path.file_name() == Some(std::ffi::OsStr::new("skills")) {
					paths.push(path);
				} else {
					collect_skills_dirs(&path, paths);
				}
			}
		}
	}
}

fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![root.join(".claude/skills")]
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "claude",
	display_name: "Claude Code",
	mcp_parse_config: Some(mcp_strategy::parse_json_map_mcp_servers),
	mcp_serialize_config: Some(mcp_strategy::serialize_json_map_mcp_servers),
	load_mcps,
	save_mcps,
	mcp_global_path,
	mcp_project_path,
	global_data_dir,
	capabilities: Capabilities {
		mcp_stdio: true,
		mcp_remote: true,
		mcp_enable_disable: false,
		skills: true,
		universal_skills: false,
	},
	global_skills_paths: Some(global_skills_paths),
	project_skills_paths: Some(project_skills_paths),
	cli_name: "claude",
	validate_args: &["--version"],
	project_markers: &[".claude", ".mcp.json"],
	skills_cli_name: Some("claude-code"),
};
