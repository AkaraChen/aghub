use crate::descriptor::*;
use crate::{ResourceSourceKind, RuntimeVisibility};
use std::path::{Path, PathBuf};

const REMOTE_CAPABILITIES: Capabilities = Capabilities {
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
};

fn data_dir() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".xum"))
}

fn global_skills_paths() -> Vec<PathBuf> {
	let Some(home) = home_dir() else {
		return Vec::new();
	};
	vec![home.join(".xum/skills"), home.join(".agents/skills")]
}

fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![
		root.join(".xum/skills"),
		root.join(".agents/skills"),
		root.join(".mux/skills"),
		root.join(".claude/skills"),
	]
}

fn global_skill_write_path() -> Option<PathBuf> {
	data_dir().map(|root| root.join("skills"))
}

fn project_skill_write_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".xum/skills"))
}

fn classify(path: &Path) -> SkillSourceClassification {
	let normalized = path.to_string_lossy().replace('\\', "/");
	if normalized.contains("/.claude/") {
		return SkillSourceClassification {
			source_kind: ResourceSourceKind::Compatible,
			runtime_visibility: RuntimeVisibility::Conditional,
			runtime_visibility_evidence:
				"Xum loads Claude skills only when compatibility is enabled",
		};
	}
	SkillSourceClassification {
		source_kind: if normalized.contains("/.agents/") {
			ResourceSourceKind::Standard
		} else if normalized.contains("/.mux/") {
			ResourceSourceKind::Historical
		} else {
			ResourceSourceKind::Native
		},
		runtime_visibility: RuntimeVisibility::Visible,
		runtime_visibility_evidence: "declared by the Xum Skill loader",
	}
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "xum",
	display_name: "Xum",
	surfaces: &[
		AgentSurface::cli("cli", &["xum"], &[data_dir], &["--version"]),
		AgentSurface::remote_workspace("remote-workspace")
			.with_capabilities(REMOTE_CAPABILITIES),
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
				global: true,
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
				project: false,
			},
		},
	},
	global_skill_paths: Some(GlobalSkillPaths {
		read: global_skills_paths,
		write: global_skill_write_path,
		classify: Some(classify),
	}),
	project_skill_paths: Some(ProjectSkillPaths {
		read: project_skills_paths,
		write: project_skill_write_path,
		classify: Some(classify),
	}),
	global_sub_agent_paths: None,
	project_sub_agent_paths: None,
	load_sub_agents: load_sub_agents_noop,
	save_sub_agents: save_sub_agents_noop,
	project_markers: &[".xum", ".mux"],
	skills_cli_name: None,
	rule_paths: None,
};
