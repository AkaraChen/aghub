use crate::descriptor::*;
use crate::{ResourceSourceKind, RuntimeVisibility};
use std::path::{Path, PathBuf};

fn data_dir() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".codewhale"))
}

fn global_skills_paths() -> Vec<PathBuf> {
	let Some(home) = home_dir() else {
		return Vec::new();
	};
	vec![
		home.join(".codewhale/skills"),
		home.join(".agents/skills"),
		home.join("skills"),
		home.join(".claude/skills"),
		home.join(".cursor/skills"),
		home.join(".opencode/skills"),
		home.join(".codex/skills"),
	]
}

fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![
		root.join(".codewhale/skills"),
		root.join(".agents/skills"),
		root.join("skills"),
		root.join(".claude/skills"),
		root.join(".cursor/skills"),
		root.join(".opencode/skills"),
		root.join(".codex/skills"),
	]
}

fn global_skill_write_path() -> Option<PathBuf> {
	data_dir().map(|root| root.join("skills"))
}

fn project_skill_write_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".codewhale/skills"))
}

fn classify(path: &Path) -> SkillSourceClassification {
	let path = path.to_string_lossy().replace('\\', "/");
	if path.contains("/.codex/") {
		return SkillSourceClassification {
			source_kind: ResourceSourceKind::Compatible,
			runtime_visibility: RuntimeVisibility::AuditOnly,
			runtime_visibility_evidence:
				"CodeWhale audits this source but does not load it",
		};
	}
	let source_kind = if path.contains("/.codewhale/") {
		ResourceSourceKind::Native
	} else if path.contains("/.agents/") {
		ResourceSourceKind::Standard
	} else if path.contains("/.claude/")
		|| path.contains("/.cursor/")
		|| path.contains("/.opencode/")
	{
		ResourceSourceKind::Compatible
	} else {
		ResourceSourceKind::External
	};
	SkillSourceClassification {
		source_kind,
		runtime_visibility: RuntimeVisibility::Visible,
		runtime_visibility_evidence: "declared by the CodeWhale Skill loader",
	}
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "codewhale",
	display_name: "CodeWhale",
	surfaces: &[AgentSurface::cli(
		"cli",
		&["codewhale", "codew"],
		&[data_dir],
		&["--version"],
	)],
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
	project_markers: &[".codewhale"],
	skills_cli_name: None,
	rule_paths: None,
};
