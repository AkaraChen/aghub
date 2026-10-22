use crate::define_mcp_paths;
use crate::descriptor::*;
use crate::sub_agents::{load_sub_agents_from_dir, save_scoped_sub_agents};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

define_mcp_paths! {
	symmetric: ".cursor/mcp.json",
	strategy: mcp_strategy::parse_json_map_mcp_servers,
			  mcp_strategy::serialize_json_map_mcp_servers,
}

fn global_skills_paths() -> Vec<PathBuf> {
	let Some(home) = home_dir() else {
		return Vec::new();
	};
	vec![
		home.join(".cursor/skills"),
		home.join(".claude/skills"),
		home.join(".codex/skills"),
	]
}
fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![
		root.join(".cursor/skills"),
		root.join(".agents/skills"),
		root.join(".claude/skills"),
		root.join(".codex/skills"),
	]
}

fn global_skill_write_path() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".cursor/skills"))
}

fn project_skill_write_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".cursor/skills"))
}

fn global_sub_agent_paths() -> Vec<PathBuf> {
	let Some(home) = home_dir() else {
		return Vec::new();
	};
	vec![
		home.join(".cursor/agents"),
		home.join(".claude/agents"),
		home.join(".codex/agents"),
	]
}

fn project_sub_agent_paths(root: &Path) -> Vec<PathBuf> {
	vec![
		root.join(".cursor/agents"),
		root.join(".claude/agents"),
		root.join(".codex/agents"),
	]
}

fn global_sub_agent_write_path() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".cursor/agents"))
}

fn project_sub_agent_write_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".cursor/agents"))
}

fn load_sub_agents(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
) -> crate::Result<Vec<crate::SubAgent>> {
	let paths = match scope {
		crate::ResourceScope::GlobalOnly => global_sub_agent_paths(),
		crate::ResourceScope::ProjectOnly => project_root
			.map(project_sub_agent_paths)
			.unwrap_or_default(),
		crate::ResourceScope::Both => {
			return Err(crate::ConfigError::InvalidConfig(
				"Sub-agent load unavailable for Both scope".to_string(),
			));
		}
	};
	let mut seen = HashSet::new();
	let mut agents = Vec::new();
	for path in paths {
		for agent in load_sub_agents_from_dir(&path) {
			if seen.insert(agent.name.clone()) {
				agents.push(agent);
			}
		}
	}
	Ok(agents)
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
		Some(global_sub_agent_write_path),
		Some(project_sub_agent_write_path),
	)
}

fn collect_rule_files(root: &Path, files: &mut Vec<PathBuf>) {
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
			collect_rule_files(&path, files);
		} else if file_type.is_file()
			&& path.extension().and_then(|extension| extension.to_str())
				== Some("mdc")
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
	collect_rule_files(&home.join(".cursor/rules"), &mut files);
	files
}

fn project_rule_paths(root: &Path) -> Vec<PathBuf> {
	let mut files = Vec::new();
	collect_rule_files(&root.join(".cursor/rules"), &mut files);
	files.push(root.join(".cursorrules"));
	files
}

fn ide_runtime_path() -> Option<PathBuf> {
	#[cfg(target_os = "macos")]
	{
		Some(PathBuf::from("/Applications/Cursor.app"))
	}
	#[cfg(target_os = "linux")]
	{
		Some(PathBuf::from("/usr/share/applications/cursor.desktop"))
	}
	#[cfg(target_os = "windows")]
	{
		dirs::data_local_dir().map(|dir| dir.join("Programs/Cursor/Cursor.exe"))
	}
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "cursor",
	display_name: "Cursor",
	surfaces: &[
		AgentSurface::ide("ide", &[ide_runtime_path], &[global_data_dir]),
		AgentSurface::cli(
			"cli",
			&["cursor"],
			&[global_data_dir],
			&["--version"],
		),
		AgentSurface::cloud("cloud").with_capabilities(Capabilities {
			skills: SkillCapabilities {
				scopes: ScopeSupport {
					global: false,
					project: true,
				},
				universal: true,
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
					project: true,
				},
			},
		}),
	],
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
		read: global_sub_agent_paths,
		write: global_sub_agent_write_path,
	}),
	project_sub_agent_paths: Some(ProjectSubAgentPaths {
		read: project_sub_agent_paths,
		write: project_sub_agent_write_path,
	}),
	load_sub_agents,
	save_sub_agents,
	project_markers: &[".cursor"],
	skills_cli_name: Some("cursor"),
	rule_paths: Some(RulePaths {
		global: Some(global_rule_paths),
		project: Some(project_rule_paths),
	}),
};

#[cfg(test)]
mod tests {
	use super::*;

	fn write_sub_agent(dir: &Path, name: &str) {
		fs::create_dir_all(dir).unwrap();
		fs::write(
			dir.join(format!("{name}.md")),
			format!("---\nname: {name}\ndescription: Test\n---\nBody"),
		)
		.unwrap();
	}

	#[test]
	fn project_sub_agents_use_cursor_then_compatible_sources() {
		let temp = tempfile::tempdir().unwrap();
		write_sub_agent(&temp.path().join(".cursor/agents"), "same");
		write_sub_agent(&temp.path().join(".claude/agents"), "same");
		write_sub_agent(&temp.path().join(".codex/agents"), "codex-only");

		let agents = load_sub_agents(
			Some(temp.path()),
			crate::ResourceScope::ProjectOnly,
		)
		.unwrap();
		assert_eq!(agents.len(), 2);
		assert!(agents[0]
			.source_path
			.as_deref()
			.is_some_and(|path| path.contains(".cursor/agents")));
	}

	#[test]
	fn project_rules_include_nested_mdc_and_legacy_file() {
		let temp = tempfile::tempdir().unwrap();
		let nested = temp.path().join(".cursor/rules/imported/team");
		fs::create_dir_all(&nested).unwrap();
		fs::write(nested.join("typescript.mdc"), "rule").unwrap();
		fs::write(nested.join("ignore.md"), "ignore").unwrap();

		let rules = project_rule_paths(temp.path());
		assert!(rules.iter().any(|path| path.ends_with("typescript.mdc")));
		assert!(!rules.iter().any(|path| path.ends_with("ignore.md")));
		assert!(rules.iter().any(|path| path.ends_with(".cursorrules")));
	}
}
