use crate::descriptor::*;
use crate::sub_agents::{load_scoped_sub_agents, save_scoped_sub_agents};
use std::fs;
use std::path::{Path, PathBuf};

fn global_data_dir() -> Option<PathBuf> {
	std::env::var_os("QODER_CONFIG_DIR")
		.filter(|value| !value.is_empty())
		.map(PathBuf::from)
		.or_else(|| home_dir().map(|home| home.join(".qoder")))
}

fn mcp_global_path() -> Option<PathBuf> {
	global_data_dir().map(|root| root.join("settings.json"))
}

fn mcp_project_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".qoder/settings.json"))
}

fn project_mcp_sources(root: &Path) -> Vec<McpReadSource> {
	vec![
		McpReadSource {
			path: root.join(".qoder/settings.local.json"),
			source_kind: crate::ResourceSourceKind::Native,
			write_policy: crate::ResourceWritePolicy::ReadOnly,
			runtime_visibility: crate::RuntimeVisibility::Conditional,
			runtime_visibility_evidence:
				"Qoder loads local MCP configuration after folder trust",
		},
		McpReadSource {
			path: root.join(".mcp.json"),
			source_kind: crate::ResourceSourceKind::Standard,
			write_policy: crate::ResourceWritePolicy::ReadOnly,
			runtime_visibility: crate::RuntimeVisibility::Conditional,
			runtime_visibility_evidence:
				"Qoder loads workspace MCP configuration after approval",
		},
		McpReadSource {
			path: root.join(".qoder/settings.json"),
			source_kind: crate::ResourceSourceKind::Native,
			write_policy: crate::ResourceWritePolicy::ReadWrite,
			runtime_visibility: crate::RuntimeVisibility::Conditional,
			runtime_visibility_evidence:
				"Qoder loads project MCP configuration after approval",
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
							"Qoder user MCP configuration",
					}]
				})
				.unwrap_or_default();
			load_mcps_from_sources(
				"qoder",
				&["cli", "ide"],
				crate::ConfigSource::Global,
				sources,
				mcp_strategy::parse_json_map_mcp_servers,
			)
		}
		crate::ResourceScope::ProjectOnly => load_mcps_from_sources(
			"qoder",
			&["cli", "ide"],
			crate::ConfigSource::Project,
			project_root.map(project_mcp_sources).unwrap_or_default(),
			mcp_strategy::parse_json_map_mcp_servers,
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
		mcp_strategy::serialize_json_map_mcp_servers,
	)
}

fn global_skills_paths() -> Vec<PathBuf> {
	global_data_dir()
		.map(|root| vec![root.join("skills")])
		.unwrap_or_default()
}

fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![root.join(".qoder/skills")]
}

fn global_skill_write_path() -> Option<PathBuf> {
	global_data_dir().map(|root| root.join("skills"))
}

fn project_skill_write_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".qoder/skills"))
}

fn global_agent_dir() -> Option<PathBuf> {
	global_data_dir().map(|root| root.join("agents"))
}

fn project_agent_dir(root: &Path) -> Option<PathBuf> {
	Some(root.join(".qoder/agents"))
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
	global_data_dir()
		.map(|root| vec![root.join("AGENTS.md")])
		.unwrap_or_default()
}

fn project_rule_paths(root: &Path) -> Vec<PathBuf> {
	let mut files = Vec::new();
	collect_markdown(&root.join(".qoder/rules"), &mut files);
	files.push(root.join("AGENTS.md"));
	files.push(root.join("AGENTS.local.md"));
	files
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "qoder",
	display_name: "Qoder",
	surfaces: &[
		AgentSurface::cli(
			"cli",
			&["qoder"],
			&[global_data_dir],
			&["--version"],
		),
		AgentSurface::ide("ide", &[], &[global_data_dir]),
	],
	precedence: ResourcePrecedence {
		skills: ScopePrecedence::GlobalThenProject,
		mcp: ScopePrecedence::ProjectThenGlobal,
		sub_agents: ScopePrecedence::ProjectThenGlobal,
		rules: ScopePrecedence::ProjectThenGlobal,
	},
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
	project_markers: &[".qoder"],
	skills_cli_name: None,
	rule_paths: Some(RulePaths {
		global: Some(global_rule_paths),
		project: Some(project_rule_paths),
	}),
};
