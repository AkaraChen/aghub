use crate::errors::{ConfigError, Result};
use crate::models::{AgentConfig, McpServer, McpTransport, ResourceScope};
use std::fs;
use std::path::{Path, PathBuf};

/// Parse function type for MCP-backed agent configuration content
pub type McpParseFn = fn(&str) -> Result<AgentConfig>;

/// Serialize function type for MCP-backed agent configuration content
pub type McpSerializeFn = fn(&AgentConfig, Option<&str>) -> Result<String>;

/// Load function type for agent MCP configuration
pub type LoadMcpsFn =
	fn(Option<&Path>, ResourceScope) -> Result<Vec<McpServer>>;

/// Save function type for agent MCP configuration
pub type SaveMcpsFn =
	fn(Option<&Path>, ResourceScope, &[McpServer]) -> Result<()>;

pub type OptionalPathFn = fn() -> Option<PathBuf>;
pub type OptionalProjectPathFn = fn(&Path) -> Option<PathBuf>;

#[derive(Debug, Clone, Copy)]
pub struct ScopeSupport {
	pub global: bool,
	pub project: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct SkillCapabilities {
	pub scopes: ScopeSupport,
	pub universal: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct McpCapabilities {
	pub scopes: ScopeSupport,
	pub stdio: bool,
	pub remote: bool,
	pub enable_disable: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct Capabilities {
	pub skills: SkillCapabilities,
	pub mcp: McpCapabilities,
}

#[derive(Clone, Copy)]
pub struct GlobalSkillPaths {
	pub read: fn() -> Vec<PathBuf>,
	pub write: fn() -> Option<PathBuf>,
}

#[derive(Clone, Copy)]
pub struct ProjectSkillPaths {
	pub read: fn(&Path) -> Vec<PathBuf>,
	pub write: fn(&Path) -> Option<PathBuf>,
}

/// Static descriptor for an agent — one per agent, declared in agents/*.rs
pub struct AgentDescriptor {
	pub id: &'static str,
	pub display_name: &'static str,
	/// Parse raw MCP config content into AgentConfig.
	pub mcp_parse_config: Option<McpParseFn>,
	/// Serialize MCP config content back to raw text.
	pub mcp_serialize_config: Option<McpSerializeFn>,
	/// Load MCPs for the requested scope. The descriptor owns all I/O.
	pub load_mcps: LoadMcpsFn,
	/// Persist MCPs for the requested scope. The descriptor owns all I/O.
	pub save_mcps: SaveMcpsFn,
	/// Global MCP config path for display, validation, and discovery.
	pub mcp_global_path: Option<OptionalPathFn>,
	/// Project MCP config path for display, validation, and discovery.
	pub mcp_project_path: Option<OptionalProjectPathFn>,
	/// Agent-specific global data directory used for availability checks.
	pub global_data_dir: fn() -> Option<PathBuf>,
	pub capabilities: Capabilities,
	pub global_skill_paths: Option<GlobalSkillPaths>,
	pub project_skill_paths: Option<ProjectSkillPaths>,
	pub cli_name: &'static str,
	pub validate_args: &'static [&'static str],
	/// Directory/file markers that indicate this agent's project root
	pub project_markers: &'static [&'static str],
	/// Maps to the `-a, --agent` argument of `npx skills add` CLI
	/// e.g., "claude-code" becomes `npx skills add <source> -a claude-code`
	pub skills_cli_name: Option<&'static str>,
}

impl AgentDescriptor {
	pub fn supports_skill_scope(&self, scope: ResourceScope) -> bool {
		match scope {
			ResourceScope::GlobalOnly => self.capabilities.skills.scopes.global,
			ResourceScope::ProjectOnly => {
				self.capabilities.skills.scopes.project
			}
			ResourceScope::Both => {
				self.capabilities.skills.scopes.global
					|| self.capabilities.skills.scopes.project
			}
		}
	}

	pub fn supports_mcp_scope(&self, scope: ResourceScope) -> bool {
		match scope {
			ResourceScope::GlobalOnly => self.capabilities.mcp.scopes.global,
			ResourceScope::ProjectOnly => self.capabilities.mcp.scopes.project,
			ResourceScope::Both => {
				self.capabilities.mcp.scopes.global
					|| self.capabilities.mcp.scopes.project
			}
		}
	}

	pub fn skill_write_path(
		&self,
		project_root: Option<&Path>,
		scope: ResourceScope,
	) -> Option<PathBuf> {
		match scope {
			ResourceScope::GlobalOnly => {
				if !self.capabilities.skills.scopes.global {
					return None;
				}
				self.global_skill_paths.and_then(|paths| (paths.write)())
			}
			ResourceScope::ProjectOnly => {
				if !self.capabilities.skills.scopes.project {
					return None;
				}
				project_root
					.and_then(|root| {
						self.project_skill_paths.map(|p| (p.write)(root))
					})
					.flatten()
			}
			ResourceScope::Both => None,
		}
	}

	pub fn global_skill_read_paths(&self) -> Vec<PathBuf> {
		let mut dirs = Vec::new();

		if let Some(paths) = self.global_skill_paths {
			dirs.extend((paths.read)());
		}

		if self.capabilities.skills.universal {
			if let Some(path) = get_universal_skills_path() {
				dirs.push(path);
			}
		}

		dirs
	}

	pub fn project_skill_read_paths(
		&self,
		project_root: &Path,
	) -> Vec<PathBuf> {
		let mut dirs = Vec::new();

		if let Some(paths) = self.project_skill_paths {
			dirs.extend((paths.read)(project_root));
		}

		if self.capabilities.skills.universal {
			dirs.push(project_root.join(".agents/skills"));
		}

		dirs
	}

	pub fn skill_read_paths(
		&self,
		project_root: Option<&Path>,
		scope: ResourceScope,
	) -> Vec<PathBuf> {
		let mut paths = Vec::new();

		if (scope == ResourceScope::ProjectOnly || scope == ResourceScope::Both)
			&& self.capabilities.skills.scopes.project
		{
			if let Some(root) = project_root {
				paths.extend(self.project_skill_read_paths(root));
			}
		}

		if (scope == ResourceScope::GlobalOnly || scope == ResourceScope::Both)
			&& self.capabilities.skills.scopes.global
		{
			paths.extend(self.global_skill_read_paths());
		}

		paths
	}

	pub fn mcp_path(
		&self,
		project_root: Option<&Path>,
		scope: ResourceScope,
	) -> Option<PathBuf> {
		match scope {
			ResourceScope::GlobalOnly => {
				if !self.capabilities.mcp.scopes.global {
					return None;
				}
				self.mcp_global_path.and_then(|path| path())
			}
			ResourceScope::ProjectOnly => {
				if !self.capabilities.mcp.scopes.project {
					return None;
				}
				project_root.and_then(|root| {
					self.mcp_project_path.and_then(|p| p(root))
				})
			}
			ResourceScope::Both => None,
		}
	}
}

/// Get the universal skills directory path following XDG config spec
pub fn get_universal_skills_path() -> Option<PathBuf> {
	std::env::var_os("XDG_CONFIG_HOME")
		.map(PathBuf::from)
		.or_else(|| dirs::home_dir().map(|h| h.join(".config")))
		.map(|path| path.join("agents/skills"))
}

pub fn load_mcps_from_file(
	path: &Path,
	parse: McpParseFn,
) -> Result<Vec<McpServer>> {
	match fs::read_to_string(path) {
		Ok(content) => Ok(parse(&content)?.mcps),
		Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
		Err(e) => Err(e.into()),
	}
}

pub fn save_mcps_to_file(
	path: &Path,
	mcps: &[McpServer],
	serialize: McpSerializeFn,
) -> Result<()> {
	if let Some(parent) = path.parent() {
		fs::create_dir_all(parent)?;
	}

	let original_content = fs::read_to_string(path).ok();
	let mut config = AgentConfig::new();
	config.mcps = mcps.to_vec();

	let content = serialize(&config, original_content.as_deref())?;
	fs::write(path, content)?;
	Ok(())
}

pub fn load_scoped_mcps(
	project_root: Option<&Path>,
	scope: ResourceScope,
	global_path: Option<OptionalPathFn>,
	project_path: Option<OptionalProjectPathFn>,
	parse: McpParseFn,
) -> Result<Vec<McpServer>> {
	match scope {
		ResourceScope::GlobalOnly => {
			let Some(path) = global_path.and_then(|path| path()) else {
				return Ok(Vec::new());
			};
			load_mcps_from_file(&path, parse)
		}
		ResourceScope::ProjectOnly => {
			let Some(path) = project_root
				.and_then(|root| project_path.and_then(|path| path(root)))
			else {
				return Ok(Vec::new());
			};
			load_mcps_from_file(&path, parse)
		}
		ResourceScope::Both => Err(ConfigError::InvalidConfig(
			"MCP path unavailable for Both scope".to_string(),
		)),
	}
}

pub fn save_scoped_mcps(
	project_root: Option<&Path>,
	scope: ResourceScope,
	mcps: &[McpServer],
	global_path: Option<OptionalPathFn>,
	project_path: Option<OptionalProjectPathFn>,
	serialize: McpSerializeFn,
) -> Result<()> {
	let path = match scope {
		ResourceScope::GlobalOnly => global_path.and_then(|path| path()),
		ResourceScope::ProjectOnly => project_root
			.and_then(|root| project_path.and_then(|path| path(root))),
		ResourceScope::Both => {
			return Err(ConfigError::InvalidConfig(
				"MCP path unavailable for Both scope".to_string(),
			))
		}
	}
	.ok_or_else(|| {
		ConfigError::InvalidConfig(format!(
			"MCP path unavailable for {:?} scope",
			scope
		))
	})?;
	save_mcps_to_file(&path, mcps, serialize)
}

pub fn supports_mcp_transport(
	capabilities: Capabilities,
	transport: &McpTransport,
) -> bool {
	match transport {
		McpTransport::Stdio { .. } => capabilities.mcp.stdio,
		McpTransport::Sse { .. } | McpTransport::StreamableHttp { .. } => {
			capabilities.mcp.remote
		}
	}
}

pub fn home_dir() -> Option<PathBuf> {
	dirs::home_dir()
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
	pub const PARSE_JSON_OPCODE: McpParseFn = json_opencode::parse;
	pub const SERIALIZE_JSON_OPCODE: McpSerializeFn = json_opencode::serialize;

	// JsonList format
	pub const PARSE_JSON_LIST: McpParseFn = json_list::parse;
	pub const SERIALIZE_JSON_LIST: McpSerializeFn = json_list::serialize;

	// TOML format
	pub const PARSE_TOML: McpParseFn = toml_format::parse;
	pub const SERIALIZE_TOML: McpSerializeFn = toml_format::serialize;

	// No config
	pub fn parse_none(_: &str) -> Result<AgentConfig> {
		Ok(AgentConfig::new())
	}
	pub fn serialize_none(_: &AgentConfig, _: Option<&str>) -> Result<String> {
		Ok(String::new())
	}
}
