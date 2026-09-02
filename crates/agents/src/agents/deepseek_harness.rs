use crate::descriptor::*;
use crate::errors::ConfigError;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

const DSH_HOME_ENV: &str = "DSH_HOME";
const DSH_AGENTS_HOME_ENV: &str = "DSH_AGENTS_HOME";

fn configured_home(value: Option<OsString>) -> Option<PathBuf> {
	value
		.filter(|path| !path.to_string_lossy().trim().is_empty())
		.map(PathBuf::from)
}

fn resolve_dsh_home(
	home: Option<PathBuf>,
	configured: Option<OsString>,
) -> Option<PathBuf> {
	configured_home(configured).or_else(|| home.map(|path| path.join(".dsh")))
}

fn resolve_agents_home(
	home: Option<PathBuf>,
	configured: Option<OsString>,
) -> Option<PathBuf> {
	configured_home(configured)
		.or_else(|| home.map(|path| path.join(".agents")))
}

fn dsh_home() -> Option<PathBuf> {
	resolve_dsh_home(home_dir(), std::env::var_os(DSH_HOME_ENV))
}

fn agents_home() -> Option<PathBuf> {
	resolve_agents_home(home_dir(), std::env::var_os(DSH_AGENTS_HOME_ENV))
}

fn global_data_dir() -> Option<PathBuf> {
	dsh_home()
}

fn load_mcps(
	_: Option<&Path>,
	_: crate::ResourceScope,
) -> crate::Result<Vec<crate::McpServer>> {
	Ok(Vec::new())
}

fn save_mcps(
	_: Option<&Path>,
	_: crate::ResourceScope,
	_: &[crate::McpServer],
) -> crate::Result<()> {
	Err(ConfigError::unsupported_operation(
		"persist",
		"MCP server",
		"deepseek-harness",
	))
}

fn global_skills_paths() -> Vec<PathBuf> {
	dsh_home()
		.map(|path| vec![path.join("skills")])
		.unwrap_or_default()
}

fn global_skill_write_path() -> Option<PathBuf> {
	dsh_home().map(|path| path.join("skills"))
}

fn universal_global_skill_path() -> Option<PathBuf> {
	agents_home().map(|path| path.join("skills"))
}

fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![root.join(".dsh/skills")]
}

fn project_skill_write_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".dsh/skills"))
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "deepseek-harness",
	display_name: "DeepSeek Harness",
	surfaces: &[AgentSurface::cli(
		"cli",
		&["dsh"],
		&[global_data_dir],
		&["--help"],
	)],
	precedence: ResourcePrecedence::uniform(ScopePrecedence::ProjectThenGlobal),
	mcp_parse_config: None,
	mcp_serialize_config: None,
	load_mcps,
	save_mcps,
	mcp_global_path: None,
	mcp_project_path: None,
	capabilities: Capabilities {
		skills: SkillCapabilities {
			scopes: ScopeSupport {
				global: true,
				project: true,
			},
			universal: true,
			discovery: SkillDiscovery::DIRECT_BUNDLES_AND_MARKDOWN,
			universal_global_path: Some(universal_global_skill_path),
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
		classify: None,
	}),
	project_skill_paths: Some(ProjectSkillPaths {
		read: project_skills_paths,
		write: project_skill_write_path,
		classify: None,
	}),
	global_sub_agent_paths: None,
	project_sub_agent_paths: None,
	load_sub_agents: load_sub_agents_noop,
	save_sub_agents: save_sub_agents_noop,
	project_markers: &[".dsh"],
	skills_cli_name: None,
	rule_paths: None,
};

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn blank_home_overrides_use_defaults() {
		let home = PathBuf::from("/home/tester");
		assert_eq!(
			resolve_dsh_home(Some(home.clone()), Some("  ".into())),
			Some(home.join(".dsh"))
		);
		assert_eq!(
			resolve_agents_home(Some(home.clone()), Some("".into())),
			Some(home.join(".agents"))
		);
	}

	#[test]
	fn configured_homes_replace_defaults() {
		let home = PathBuf::from("/home/tester");
		assert_eq!(
			resolve_dsh_home(
				Some(home.clone()),
				Some(OsString::from("/data/dsh")),
			),
			Some(PathBuf::from("/data/dsh"))
		);
		assert_eq!(
			resolve_agents_home(
				Some(home),
				Some(OsString::from("/data/agents")),
			),
			Some(PathBuf::from("/data/agents"))
		);
	}
}
