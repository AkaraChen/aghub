use crate::errors::Result;
use crate::models::AgentConfig;
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
	pub sub_agents: bool,
	pub skills: bool,
	/// Whether this agent supports the universal .agents/skills directory
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
	/// Relative path under home dir for skills (e.g. ".claude/skills")
	pub skills_dir: Option<&'static str>,
	/// Function returning the global skills path (if skills supported)
	pub global_skills_path: Option<fn() -> PathBuf>,
	/// Whether this agent uses the universal .agents/skills directory
	pub uses_universal_skills: bool,
	pub cli_name: &'static str,
	pub validate_args: &'static [&'static str],
	/// Directory/file markers that indicate this agent's project root
	pub project_markers: &'static [&'static str],
}

/// MCP config strategy functions for common config formats
///
/// These are pre-defined function pointers that can be used directly in
/// const DESCRIPTOR definitions. For JsonMap with custom keys, each
/// agent defines its own wrapper functions.
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
	pub fn parse_json_map_context_servers(content: &str) -> Result<AgentConfig> {
		json_map::parse(content, "context_servers")
	}
	pub fn serialize_json_map_context_servers(
		config: &AgentConfig,
		original: Option<&str>,
	) -> Result<String> {
		json_map::serialize(config, original, "context_servers")
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
