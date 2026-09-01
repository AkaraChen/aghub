use crate::descriptor::*;
use crate::errors::ConfigError;
use log::warn;
use serde::Deserialize;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

const GROK_HOME_ENV: &str = "GROK_HOME";
const CLAUDE_SKILLS_ENV: &str = "GROK_CLAUDE_SKILLS_ENABLED";
const CURSOR_SKILLS_ENV: &str = "GROK_CURSOR_SKILLS_ENABLED";

#[derive(Default, Deserialize)]
struct GrokConfig {
	#[serde(default)]
	skills: GrokSkillConfig,
}

#[derive(Default, Deserialize)]
struct GrokSkillConfig {
	#[serde(default)]
	paths: Vec<String>,
}

fn resolve_grok_home(
	home: Option<PathBuf>,
	configured: Option<OsString>,
) -> Option<PathBuf> {
	configured
		.filter(|path| !path.is_empty())
		.map(PathBuf::from)
		.or_else(|| home.map(|path| path.join(".grok")))
}

fn grok_home() -> Option<PathBuf> {
	resolve_grok_home(home_dir(), std::env::var_os(GROK_HOME_ENV))
}

fn scanner_enabled(value: Option<&OsStr>) -> bool {
	!value.and_then(OsStr::to_str).is_some_and(|value| {
		matches!(value.to_ascii_lowercase().as_str(), "0" | "false")
	})
}

fn env_scanner_enabled(name: &str) -> bool {
	let value = std::env::var_os(name);
	scanner_enabled(value.as_deref())
}

fn expand_home(path: &str, home: Option<&Path>) -> PathBuf {
	if path == "~" {
		return home.map(Path::to_path_buf).unwrap_or_else(|| path.into());
	}
	if let Some(relative) = path.strip_prefix("~/") {
		if let Some(home) = home {
			return home.join(relative);
		}
	}
	PathBuf::from(path)
}

fn parse_configured_skill_paths(
	content: &str,
	home: Option<&Path>,
) -> crate::Result<Vec<PathBuf>> {
	let config: GrokConfig = toml::from_str(content).map_err(|error| {
		ConfigError::InvalidConfig(format!(
			"Failed to parse Grok config: {error}"
		))
	})?;
	Ok(config
		.skills
		.paths
		.iter()
		.map(|path| expand_home(path, home))
		.collect())
}

fn configured_skill_paths() -> Vec<PathBuf> {
	let Some(config_path) = mcp_global_path() else {
		return Vec::new();
	};
	let content = match std::fs::read_to_string(&config_path) {
		Ok(content) => content,
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			return Vec::new();
		}
		Err(error) => {
			warn!(
				"failed to read Grok skill paths from '{}': {error}",
				config_path.display()
			);
			return Vec::new();
		}
	};
	match parse_configured_skill_paths(&content, home_dir().as_deref()) {
		Ok(paths) => paths,
		Err(error) => {
			warn!(
				"failed to load Grok skill paths from '{}': {error}",
				config_path.display()
			);
			Vec::new()
		}
	}
}

fn push_unique(paths: &mut Vec<PathBuf>, path: PathBuf) {
	if !paths.contains(&path) {
		paths.push(path);
	}
}

fn mcp_global_path() -> Option<PathBuf> {
	grok_home().map(|home| home.join("config.toml"))
}

fn mcp_project_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".grok/config.toml"))
}

fn global_data_dir() -> Option<PathBuf> {
	grok_home()
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
		crate::format::toml_format::parse_grok,
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
		crate::format::toml_format::serialize_grok,
	)
}

fn global_skills_paths() -> Vec<PathBuf> {
	let mut paths = Vec::new();
	if let Some(home) = grok_home() {
		push_unique(&mut paths, home.join("skills"));
	}
	for path in configured_skill_paths() {
		push_unique(&mut paths, path);
	}
	if let Some(home) = home_dir() {
		if env_scanner_enabled(CLAUDE_SKILLS_ENV) {
			push_unique(&mut paths, home.join(".claude/skills"));
		}
		if env_scanner_enabled(CURSOR_SKILLS_ENV) {
			push_unique(&mut paths, home.join(".cursor/skills"));
		}
	}
	paths
}

fn project_skills_paths_with_compat(
	root: &Path,
	claude: bool,
	cursor: bool,
) -> Vec<PathBuf> {
	let mut paths = vec![root.join(".grok/skills")];
	if claude {
		paths.push(root.join(".claude/skills"));
	}
	if cursor {
		paths.push(root.join(".cursor/skills"));
	}
	paths
}

fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	project_skills_paths_with_compat(
		root,
		env_scanner_enabled(CLAUDE_SKILLS_ENV),
		env_scanner_enabled(CURSOR_SKILLS_ENV),
	)
}

fn global_skill_write_path() -> Option<PathBuf> {
	grok_home().map(|home| home.join("skills"))
}

fn project_skill_write_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".grok/skills"))
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "grok",
	display_name: "Grok Build",
	mcp_parse_config: Some(crate::format::toml_format::parse_grok),
	mcp_serialize_config: Some(crate::format::toml_format::serialize_grok),
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
			universal: true,
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
				global: false,
				project: false,
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
	load_sub_agents: load_sub_agents_noop,
	save_sub_agents: save_sub_agents_noop,
	cli_name: "grok",
	validate_args: &["version"],
	project_markers: &[".grok"],
	skills_cli_name: Some("grok"),
	rule_paths: None,
};

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn configured_home_replaces_default_grok_directory() {
		let home = PathBuf::from("/home/user");
		let configured = OsString::from("/var/lib/grok");
		assert_eq!(
			resolve_grok_home(Some(home), Some(configured)),
			Some(PathBuf::from("/var/lib/grok"))
		);
	}

	#[test]
	fn scanner_flags_accept_documented_false_values() {
		assert!(!scanner_enabled(Some(OsStr::new("0"))));
		assert!(!scanner_enabled(Some(OsStr::new("false"))));
		assert!(!scanner_enabled(Some(OsStr::new("FALSE"))));
		assert!(scanner_enabled(Some(OsStr::new("1"))));
		assert!(scanner_enabled(None));
	}

	#[test]
	fn configured_skill_paths_expand_home() {
		let paths = parse_configured_skill_paths(
			"[skills]\npaths = [\"~/shared\", \"/opt/team\"]\n",
			Some(Path::new("/home/user")),
		)
		.unwrap();
		assert_eq!(
			paths,
			vec![
				PathBuf::from("/home/user/shared"),
				PathBuf::from("/opt/team"),
			]
		);
	}

	#[test]
	fn project_paths_prioritize_native_then_compatibility_sources() {
		let root = Path::new("/project");
		let paths = project_skills_paths_with_compat(root, true, true);
		assert_eq!(paths[0], root.join(".grok/skills"));
		assert!(paths.contains(&root.join(".claude/skills")));
		assert!(paths.contains(&root.join(".cursor/skills")));
		assert_eq!(
			project_skill_write_path(root),
			Some(root.join(".grok/skills"))
		);
	}
}
