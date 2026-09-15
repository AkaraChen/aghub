mod mcp;
mod sub_agent;

use crate::descriptor::*;
use std::path::{Path, PathBuf};

fn global_data_dir() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".codex"))
}

fn push_unique(paths: &mut Vec<PathBuf>, path: PathBuf) {
	if !paths.contains(&path) {
		paths.push(path);
	}
}

fn global_skills_paths() -> Vec<PathBuf> {
	let Some(home) = home_dir() else {
		return Vec::new();
	};
	// Current user path first, then legacy ~/.codex/skills, then admin.
	// Provider/plugin/system-owned directories stay read-only and are
	// never added as write targets.
	let mut paths = Vec::new();
	push_unique(&mut paths, home.join(".agents/skills"));
	push_unique(&mut paths, home.join(".codex/skills"));
	#[cfg(not(target_os = "windows"))]
	push_unique(&mut paths, PathBuf::from("/etc/codex/skills"));
	paths
}

fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	// Codex 0.154.0 skills/list still reports $REPO/.codex/skills as
	// scope=repo when cwd is the repo root. Keep it as a read-only
	// legacy path; the current write target is .agents/skills.
	let mut paths = Vec::new();
	push_unique(&mut paths, root.join(".agents/skills"));
	push_unique(&mut paths, root.join(".codex/skills"));
	paths
}

fn global_skill_write_path() -> Option<PathBuf> {
	// Keep the Codex-owned legacy directory as the global write target so
	// ~/.agents/skills stays the shared universal target and other agents
	// do not inherit ~/.codex/skills as an unclaimed compatibility path.
	home_dir().map(|home| home.join(".codex/skills"))
}

fn project_skill_write_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".agents/skills"))
}

fn global_rule_paths() -> Vec<PathBuf> {
	home_dir()
		.map(|home| {
			vec![
				home.join(".codex/AGENTS.override.md"),
				home.join(".codex/AGENTS.md"),
			]
		})
		.unwrap_or_default()
}

fn project_rule_paths(root: &Path) -> Vec<PathBuf> {
	vec![root.join("AGENTS.override.md"), root.join("AGENTS.md")]
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "codex",
	display_name: "OpenAI Codex",
	mcp_parse_config: Some(mcp_strategy::PARSE_TOML),
	mcp_serialize_config: Some(mcp_strategy::SERIALIZE_TOML),
	load_mcps: mcp::load,
	save_mcps: mcp::save,
	mcp_global_path: Some(mcp::global_path),
	mcp_project_path: Some(mcp::project_path),
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
			sse: false,
			streamable_http: true,
			enable_disable: true,
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
	}),
	project_skill_paths: Some(ProjectSkillPaths {
		read: project_skills_paths,
		write: project_skill_write_path,
	}),
	load_sub_agents: sub_agent::load,
	save_sub_agents: sub_agent::save,
	cli_name: "codex",
	validate_args: &["--version"],
	project_markers: &[".codex"],
	skills_cli_name: Some("codex"),
	rule_paths: Some(RulePaths {
		global: Some(global_rule_paths),
		project: Some(project_rule_paths),
	}),
};

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn rule_paths_include_codex_overrides_before_base_files() {
		let global_paths = DESCRIPTOR.global_rule_paths();
		assert_eq!(global_paths.len(), 2);
		assert!(global_paths[0].ends_with(".codex/AGENTS.override.md"));
		assert!(global_paths[1].ends_with(".codex/AGENTS.md"));

		let project_root = Path::new("/project");
		assert_eq!(
			DESCRIPTOR.project_rule_paths(project_root),
			vec![
				project_root.join("AGENTS.override.md"),
				project_root.join("AGENTS.md"),
			],
		);
	}

	#[test]
	fn skill_write_paths_keep_legacy_global_and_current_project() {
		let home = home_dir().expect("home directory");
		assert_eq!(
			DESCRIPTOR.skill_write_path(None, crate::ResourceScope::GlobalOnly),
			Some(home.join(".codex/skills")),
		);

		let project_root = Path::new("/project");
		assert_eq!(
			DESCRIPTOR.skill_write_path(
				Some(project_root),
				crate::ResourceScope::ProjectOnly,
			),
			Some(project_root.join(".agents/skills")),
		);
	}

	#[test]
	fn skill_read_paths_keep_legacy_and_admin_without_duplicating_current() {
		let home = home_dir().expect("home directory");
		let global = DESCRIPTOR.global_skill_read_paths();
		let mut expected =
			vec![home.join(".agents/skills"), home.join(".codex/skills")];
		#[cfg(not(target_os = "windows"))]
		expected.push(PathBuf::from("/etc/codex/skills"));
		assert_eq!(global, expected);
		assert_eq!(
			global
				.iter()
				.filter(|path| *path == &home.join(".agents/skills"))
				.count(),
			1,
		);

		let project_root = Path::new("/project");
		assert_eq!(
			DESCRIPTOR.project_skill_read_paths(project_root),
			vec![
				project_root.join(".agents/skills"),
				project_root.join(".codex/skills"),
			],
		);
		assert_eq!(
			DESCRIPTOR.native_project_skill_read_paths(project_root),
			vec![
				project_root.join(".agents/skills"),
				project_root.join(".codex/skills"),
			],
		);
		assert_eq!(
			DESCRIPTOR
				.project_skill_read_paths(project_root)
				.iter()
				.filter(|path| *path == &project_root.join(".agents/skills"))
				.count(),
			1,
		);
		assert_ne!(
			DESCRIPTOR.skill_write_path(
				Some(project_root),
				crate::ResourceScope::ProjectOnly,
			),
			Some(project_root.join(".codex/skills")),
		);
		assert_ne!(
			DESCRIPTOR.skill_write_path(None, crate::ResourceScope::GlobalOnly),
			Some(PathBuf::from("/etc/codex/skills")),
		);
	}
}
