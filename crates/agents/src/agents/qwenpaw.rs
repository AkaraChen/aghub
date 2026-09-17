use crate::descriptor::*;
use crate::{ResourceSourceKind, RuntimeVisibility};
use std::path::{Path, PathBuf};

fn working_dir() -> Option<PathBuf> {
	std::env::var_os("QWENPAW_WORKING_DIR")
		.filter(|value| !value.is_empty())
		.map(PathBuf::from)
		.or_else(|| home_dir().map(|home| home.join(".qwenpaw")))
}

fn skill_paths(root: &Path) -> Vec<PathBuf> {
	let mut paths = vec![root.join("skill_pool")];
	let Ok(entries) = std::fs::read_dir(root.join("workspaces")) else {
		return paths;
	};
	let mut workspaces = entries
		.filter_map(Result::ok)
		.filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
		.map(|entry| entry.path().join("skills"))
		.collect::<Vec<_>>();
	workspaces.sort();
	paths.extend(workspaces);
	paths
}

fn global_skills_paths() -> Vec<PathBuf> {
	working_dir()
		.map(|root| skill_paths(&root))
		.unwrap_or_default()
}

fn no_skill_write_path() -> Option<PathBuf> {
	None
}

fn classify(path: &Path) -> SkillSourceClassification {
	let path = path.to_string_lossy().replace('\\', "/");
	let evidence = if path.contains("/workspaces/") {
		"QwenPaw workspace skill.json controls activation"
	} else {
		"QwenPaw copies enabled pool Skills into a workspace"
	};
	SkillSourceClassification {
		source_kind: ResourceSourceKind::Native,
		runtime_visibility: RuntimeVisibility::Conditional,
		runtime_visibility_evidence: evidence,
	}
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "qwenpaw",
	display_name: "QwenPaw",
	surfaces: &[AgentSurface::cli(
		"cli",
		&["qwenpaw"],
		&[working_dir],
		&["--version"],
	)],
	precedence: ResourcePrecedence::uniform(ScopePrecedence::GlobalThenProject),
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
	},
	global_skill_paths: Some(GlobalSkillPaths {
		read: global_skills_paths,
		write: no_skill_write_path,
		classify: Some(classify),
	}),
	project_skill_paths: None,
	global_sub_agent_paths: None,
	project_sub_agent_paths: None,
	load_sub_agents: load_sub_agents_noop,
	save_sub_agents: save_sub_agents_noop,
	project_markers: &[],
	skills_cli_name: None,
	rule_paths: None,
};

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn finds_existing_workspace_skill_directories() {
		let temp = tempfile::tempdir().unwrap();
		std::fs::create_dir_all(temp.path().join("workspaces/beta/skills"))
			.unwrap();
		std::fs::create_dir_all(temp.path().join("workspaces/alpha/skills"))
			.unwrap();

		assert_eq!(
			skill_paths(temp.path()),
			vec![
				temp.path().join("skill_pool"),
				temp.path().join("workspaces/alpha/skills"),
				temp.path().join("workspaces/beta/skills"),
			]
		);
	}
}
