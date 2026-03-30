use crate::errors::Result;
use crate::models::{AgentConfig, ResourceScope};
use std::path::{Path, PathBuf};

/// Parse function type for agent configuration
pub type ParseFn = fn(&str) -> Result<AgentConfig>;

/// Serialize function type for agent configuration
pub type SerializeFn = fn(&AgentConfig, Option<&str>) -> Result<String>;

/// Agent capabilities
#[derive(Debug, Clone, Copy)]
pub struct Capabilities {
	pub mcp_stdio: bool,
	pub mcp_remote: bool,
	pub mcp_enable_disable: bool,
	pub skills: bool,
	/// Whether this agent reads from the universal .agents/skills directory
	pub universal_skills: bool,
}

/// Static descriptor for an agent — one per agent, declared in agents/*.rs
pub struct AgentDescriptor {
	pub id: &'static str,
	pub display_name: &'static str,
	/// Parse raw config content into AgentConfig
	pub parse_config: ParseFn,
	/// Serialize AgentConfig back to raw content
	pub serialize_config: SerializeFn,
	pub global_path: fn() -> PathBuf,
	pub project_path: fn(&Path) -> PathBuf,
	pub capabilities: Capabilities,
	/// Function returning global skills directories.
	///
	/// **Convention**: The first path in the Vec is agent-specific and
	/// should not overlap with other agents' paths. Subsequent paths may
	/// include fallback/compatibility locations shared with other agents.
	pub global_skills_paths: Option<fn() -> Vec<PathBuf>>,
	/// Function returning project skills directories.
	///
	/// **Convention**: The first path in the Vec is agent-specific and
	/// should not overlap with other agents' paths. Subsequent paths may
	/// include fallback/compatibility locations shared with other agents.
	pub project_skills_paths: Option<fn(&Path) -> Vec<PathBuf>>,
	pub cli_name: &'static str,
	pub validate_args: &'static [&'static str],
	/// Directory/file markers that indicate this agent's project root
	pub project_markers: &'static [&'static str],
	/// Maps to the `-a, --agent` argument of `npx skills add` CLI
	/// e.g., "claude-code" becomes `npx skills add <source> -a claude-code`
	pub skills_cli_name: Option<&'static str>,
}

impl AgentDescriptor {
	/// Get the target skills directory for writing, based on scope.
	///
	/// Returns the first element from the skills directories Vec,
	/// per the convention that the first path is agent-specific.
	pub fn target_skills_dir(
		&self,
		project_root: Option<&Path>,
		scope: ResourceScope,
	) -> Option<PathBuf> {
		match scope {
			ResourceScope::GlobalOnly => {
				self.global_skills_dirs().first().cloned()
			}
			ResourceScope::ProjectOnly | ResourceScope::Both => {
				if let Some(root) = project_root {
					self.project_skills_dirs(root).first().cloned()
				} else {
					self.global_skills_dirs().first().cloned()
				}
			}
		}
	}

	/// Get all global skills directories for this agent.
	///
	/// Returns agent-specific paths first, then fallback/compatibility paths.
	/// Also includes universal skills path if `universal_skills` capability is set.
	pub fn global_skills_dirs(&self) -> Vec<PathBuf> {
		let mut dirs = Vec::new();

		if let Some(paths_fn) = self.global_skills_paths {
			dirs.extend(paths_fn());
		}

		if self.capabilities.universal_skills {
			dirs.push(get_universal_skills_path());
		}

		dirs
	}

	/// Get all project skills directories for this agent.
	///
	/// Returns agent-specific paths first, then fallback/compatibility paths.
	/// Also includes universal project skills path if `universal_skills` capability is set.
	pub fn project_skills_dirs(&self, project_root: &Path) -> Vec<PathBuf> {
		let mut dirs = Vec::new();

		if let Some(paths_fn) = self.project_skills_paths {
			dirs.extend(paths_fn(project_root));
		}

		if self.capabilities.universal_skills {
			dirs.push(project_root.join(".agents/skills"));
		}

		dirs
	}

	/// Get all skills paths for reading (may include universal path)
	pub fn get_skills_paths(
		&self,
		project_root: Option<&Path>,
		scope: ResourceScope,
	) -> Vec<PathBuf> {
		let mut paths = Vec::new();

		if scope == ResourceScope::ProjectOnly || scope == ResourceScope::Both {
			if let Some(root) = project_root {
				paths.extend(self.project_skills_dirs(root));
			}
		}

		if scope == ResourceScope::GlobalOnly || scope == ResourceScope::Both {
			paths.extend(self.global_skills_dirs());
		}

		paths
	}
}

/// Get the universal skills directory path following XDG config spec
pub fn get_universal_skills_path() -> PathBuf {
	std::env::var_os("XDG_CONFIG_HOME")
		.map(PathBuf::from)
		.or_else(|| dirs::home_dir().map(|h| h.join(".config")))
		.unwrap_or_else(|| PathBuf::from(".config"))
		.join("agents/skills")
}

/// MCP config strategy functions for common config formats
pub mod mcp_strategy {
	use super::*;
	use crate::format::{json_list, json_map, json_opencode, toml_format};

	// JsonMap with "mcpServers" key (most common)
	pub fn parse_json_map_mcp_servers(content: &str) -> Result<AgentConfig> {
		json_map::parse(content, "mcpServers")
	}
	pub fn serialize_json_map_mcp_servers(
		config: &AgentConfig,
		original: Option<&str>,
	) -> Result<String> {
		json_map::serialize(config, original, "mcpServers")
	}

	// JsonMap with "servers" key (Copilot)
	pub fn parse_json_map_servers(content: &str) -> Result<AgentConfig> {
		json_map::parse(content, "servers")
	}
	pub fn serialize_json_map_servers(
		config: &AgentConfig,
		original: Option<&str>,
	) -> Result<String> {
		json_map::serialize(config, original, "servers")
	}

	// JsonMap with "context_servers" key (Zed)
	pub fn parse_json_map_context_servers(
		content: &str,
	) -> Result<AgentConfig> {
		json_map::parse(content, "context_servers")
	}
	pub fn serialize_json_map_context_servers(
		config: &AgentConfig,
		original: Option<&str>,
	) -> Result<String> {
		json_map::serialize(config, original, "context_servers")
	}

	// JsonMap with nested "amp.mcpServers" key (Amp)
	pub fn parse_json_map_nested_amp_mcp_servers(
		content: &str,
	) -> Result<AgentConfig> {
		json_map::parse(content, "amp.mcpServers")
	}
	pub fn serialize_json_map_nested_amp_mcp_servers(
		config: &AgentConfig,
		original: Option<&str>,
	) -> Result<String> {
		json_map::serialize(config, original, "amp.mcpServers")
	}

	// JsonOpenCode format
	pub const PARSE_JSON_OPCODE: ParseFn = json_opencode::parse;
	pub const SERIALIZE_JSON_OPCODE: SerializeFn = json_opencode::serialize;

	// JsonList format
	pub const PARSE_JSON_LIST: ParseFn = json_list::parse;
	pub const SERIALIZE_JSON_LIST: SerializeFn = json_list::serialize;

	// TOML format
	pub const PARSE_TOML: ParseFn = toml_format::parse;
	pub const SERIALIZE_TOML: SerializeFn = toml_format::serialize;

	// No config
	pub fn parse_none(_: &str) -> Result<AgentConfig> {
		Ok(AgentConfig::new())
	}
	pub fn serialize_none(_: &AgentConfig, _: Option<&str>) -> Result<String> {
		Ok(String::new())
	}
}
