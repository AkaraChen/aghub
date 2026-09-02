use crate::descriptor::*;
use crate::sub_agents::{load_scoped_sub_agents, save_scoped_sub_agents};
use std::fs;
use std::path::{Path, PathBuf};

fn copilot_home() -> Option<PathBuf> {
	std::env::var_os("COPILOT_HOME")
		.filter(|value| !value.is_empty())
		.map(PathBuf::from)
		.or_else(|| home_dir().map(|home| home.join(".copilot")))
}

fn mcp_global_path() -> Option<PathBuf> {
	copilot_home().map(|root| root.join("mcp-config.json"))
}

fn mcp_project_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".mcp.json"))
}

fn project_mcp_sources(root: &Path) -> Vec<McpReadSource> {
	vec![
		McpReadSource {
			path: root.join(".mcp.json"),
			source_kind: crate::ResourceSourceKind::Standard,
			write_policy: crate::ResourceWritePolicy::ReadWrite,
			runtime_visibility: crate::RuntimeVisibility::Conditional,
			runtime_visibility_evidence:
				"Copilot CLI loads workspace MCP after folder trust",
		},
		McpReadSource {
			path: root.join(".github/mcp.json"),
			source_kind: crate::ResourceSourceKind::Native,
			write_policy: crate::ResourceWritePolicy::ReadOnly,
			runtime_visibility: crate::RuntimeVisibility::Conditional,
			runtime_visibility_evidence:
				"Copilot CLI loads repository MCP after folder trust",
		},
	]
}

fn load_mcps(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
) -> crate::Result<Vec<crate::McpServer>> {
	match scope {
		crate::ResourceScope::GlobalOnly => {
			let sources = mcp_global_path()
				.map(|path| {
					vec![McpReadSource {
						path,
						source_kind: crate::ResourceSourceKind::Native,
						write_policy: crate::ResourceWritePolicy::ReadWrite,
						runtime_visibility: crate::RuntimeVisibility::Visible,
						runtime_visibility_evidence:
							"Copilot CLI user MCP configuration",
					}]
				})
				.unwrap_or_default();
			load_mcps_from_sources(
				"copilot",
				&["cli", "ide"],
				crate::ConfigSource::Global,
				sources,
				crate::format::json_map::parse_copilot,
			)
		}
		crate::ResourceScope::ProjectOnly => load_mcps_from_sources(
			"copilot",
			&["cli", "ide", "cloud"],
			crate::ConfigSource::Project,
			project_root.map(project_mcp_sources).unwrap_or_default(),
			crate::format::json_map::parse_copilot,
		),
		crate::ResourceScope::Both => Err(crate::ConfigError::InvalidConfig(
			"MCP path unavailable for Both scope".to_string(),
		)),
	}
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
		crate::format::json_map::serialize_copilot,
	)
}

fn global_skills_paths() -> Vec<PathBuf> {
	let Some(home) = home_dir() else {
		return Vec::new();
	};
	let mut paths = copilot_home()
		.map(|root| vec![root.join("skills")])
		.unwrap_or_default();
	paths.push(home.join(".agents/skills"));
	paths
}

fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![
		root.join(".github/skills"),
		root.join(".claude/skills"),
		root.join(".agents/skills"),
	]
}

fn global_skill_write_path() -> Option<PathBuf> {
	copilot_home().map(|root| root.join("skills"))
}

fn project_skill_write_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".github/skills"))
}

fn global_agent_dir() -> Option<PathBuf> {
	copilot_home().map(|root| root.join("agents"))
}

fn project_agent_dir(root: &Path) -> Option<PathBuf> {
	Some(root.join(".github/agents"))
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

fn collect_instructions(root: &Path, files: &mut Vec<PathBuf>) {
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
			collect_instructions(&path, files);
		} else if file_type.is_file()
			&& path
				.file_name()
				.and_then(|value| value.to_str())
				.is_some_and(|name| name.ends_with(".instructions.md"))
		{
			files.push(path);
		}
	}
}

fn global_rule_paths() -> Vec<PathBuf> {
	let Some(root) = copilot_home() else {
		return Vec::new();
	};
	let mut files = vec![root.join("copilot-instructions.md")];
	collect_instructions(&root.join("instructions"), &mut files);
	files
}

fn project_rule_paths(root: &Path) -> Vec<PathBuf> {
	let mut files = vec![
		root.join(".github/copilot-instructions.md"),
		root.join("AGENTS.md"),
	];
	collect_instructions(&root.join(".github/instructions"), &mut files);
	files
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "copilot",
	display_name: "GitHub Copilot",
	surfaces: &[
		AgentSurface::cli("cli", &["copilot"], &[copilot_home], &["--version"]),
		AgentSurface::ide("ide", &[], &[copilot_home]),
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
					project: true,
				},
			},
		}),
	],
	precedence: ResourcePrecedence::uniform(ScopePrecedence::ProjectThenGlobal),
	mcp_parse_config: Some(crate::format::json_map::parse_copilot),
	mcp_serialize_config: Some(crate::format::json_map::serialize_copilot),
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
		read: global_agent_paths,
		write: global_agent_dir,
	}),
	project_sub_agent_paths: Some(ProjectSubAgentPaths {
		read: project_agent_paths,
		write: project_agent_dir,
	}),
	load_sub_agents,
	save_sub_agents,
	project_markers: &[".github", ".mcp.json"],
	skills_cli_name: Some("github-copilot"),
	rule_paths: Some(RulePaths {
		global: Some(global_rule_paths),
		project: Some(project_rule_paths),
	}),
};
