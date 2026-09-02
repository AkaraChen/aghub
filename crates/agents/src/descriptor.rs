use crate::errors::{ConfigError, Result};
use crate::models::{
	AgentConfig, ConfigSource, McpServer, McpTransport, ResourceOrigin,
	ResourceScope, ResourceSourceKind, ResourceWritePolicy, RuntimeVisibility,
	SubAgent,
};
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

/// Load function type for agent sub-agent configuration.
/// The implementation fully owns all I/O; no path is exposed.
pub type LoadSubAgentsFn =
	fn(Option<&Path>, ResourceScope) -> Result<Vec<SubAgent>>;

/// Save function type for agent sub-agent configuration.
/// The implementation fully owns all I/O; no path is exposed.
pub type SaveSubAgentsFn =
	fn(Option<&Path>, ResourceScope, &[SubAgent]) -> Result<()>;

pub type OptionalPathFn = fn() -> Option<PathBuf>;
pub type OptionalProjectPathFn = fn(&Path) -> Option<PathBuf>;

pub const UNIVERSAL_SKILL_TARGET_ID: &str = "universal";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScopePrecedence {
	ProjectThenGlobal,
	GlobalThenProject,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResourcePrecedence {
	pub skills: ScopePrecedence,
	pub mcp: ScopePrecedence,
	pub sub_agents: ScopePrecedence,
	pub rules: ScopePrecedence,
}

impl ResourcePrecedence {
	pub const fn uniform(precedence: ScopePrecedence) -> Self {
		Self {
			skills: precedence,
			mcp: precedence,
			sub_agents: precedence,
			rules: precedence,
		}
	}
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentSurfaceKind {
	Cli,
	Ide,
	Desktop,
	Cloud,
	RemoteWorkspace,
}

#[derive(Debug, Clone, Copy)]
pub struct AgentSurface {
	pub id: &'static str,
	pub kind: AgentSurfaceKind,
	pub cli_names: &'static [&'static str],
	pub runtime_paths: &'static [OptionalPathFn],
	pub configuration_paths: &'static [OptionalPathFn],
	pub validate_args: &'static [&'static str],
	pub skill_path_markers: &'static [&'static str],
	pub capabilities: Option<Capabilities>,
}

impl AgentSurface {
	pub const fn cli(
		id: &'static str,
		cli_names: &'static [&'static str],
		configuration_paths: &'static [OptionalPathFn],
		validate_args: &'static [&'static str],
	) -> Self {
		Self {
			id,
			kind: AgentSurfaceKind::Cli,
			cli_names,
			runtime_paths: &[],
			configuration_paths,
			validate_args,
			skill_path_markers: &[],
			capabilities: None,
		}
	}

	pub const fn ide(
		id: &'static str,
		runtime_paths: &'static [OptionalPathFn],
		configuration_paths: &'static [OptionalPathFn],
	) -> Self {
		Self {
			id,
			kind: AgentSurfaceKind::Ide,
			cli_names: &[],
			runtime_paths,
			configuration_paths,
			validate_args: &[],
			skill_path_markers: &[],
			capabilities: None,
		}
	}

	pub const fn desktop(
		id: &'static str,
		runtime_paths: &'static [OptionalPathFn],
		configuration_paths: &'static [OptionalPathFn],
	) -> Self {
		Self {
			id,
			kind: AgentSurfaceKind::Desktop,
			cli_names: &[],
			runtime_paths,
			configuration_paths,
			validate_args: &[],
			skill_path_markers: &[],
			capabilities: None,
		}
	}

	pub const fn cloud(id: &'static str) -> Self {
		Self {
			id,
			kind: AgentSurfaceKind::Cloud,
			cli_names: &[],
			runtime_paths: &[],
			configuration_paths: &[],
			validate_args: &[],
			skill_path_markers: &[],
			capabilities: None,
		}
	}

	pub const fn remote_workspace(id: &'static str) -> Self {
		Self {
			id,
			kind: AgentSurfaceKind::RemoteWorkspace,
			cli_names: &[],
			runtime_paths: &[],
			configuration_paths: &[],
			validate_args: &[],
			skill_path_markers: &[],
			capabilities: None,
		}
	}

	pub const fn with_capabilities(
		mut self,
		capabilities: Capabilities,
	) -> Self {
		self.capabilities = Some(capabilities);
		self
	}

	pub const fn with_skill_path_markers(
		mut self,
		markers: &'static [&'static str],
	) -> Self {
		self.skill_path_markers = markers;
		self
	}
}

#[derive(Debug, Clone, Copy)]
pub struct ScopeSupport {
	pub global: bool,
	pub project: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct SkillCapabilities {
	pub scopes: ScopeSupport,
	pub universal: bool,
	pub discovery: SkillDiscovery,
	pub universal_global_path: Option<OptionalPathFn>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SkillDiscovery {
	pub include_nested: bool,
	pub include_flat_markdown: bool,
}

impl SkillDiscovery {
	pub const STANDARD: Self = Self {
		include_nested: true,
		include_flat_markdown: false,
	};

	pub const DIRECT_BUNDLES_AND_MARKDOWN: Self = Self {
		include_nested: false,
		include_flat_markdown: true,
	};
}

#[derive(Debug, Clone, Copy)]
pub struct McpCapabilities {
	pub scopes: ScopeSupport,
	pub stdio: bool,
	pub sse: bool,
	pub streamable_http: bool,
	pub enable_disable: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct SubAgentCapabilities {
	pub scopes: ScopeSupport,
}

#[derive(Debug, Clone, Copy)]
pub struct Capabilities {
	pub skills: SkillCapabilities,
	pub mcp: McpCapabilities,
	pub sub_agents: SubAgentCapabilities,
}

#[derive(Clone, Copy)]
pub struct GlobalSkillPaths {
	pub read: fn() -> Vec<PathBuf>,
	pub write: fn() -> Option<PathBuf>,
	pub classify: Option<SkillSourceClassifier>,
}

#[derive(Clone, Copy)]
pub struct ProjectSkillPaths {
	pub read: fn(&Path) -> Vec<PathBuf>,
	pub write: fn(&Path) -> Option<PathBuf>,
	pub classify: Option<SkillSourceClassifier>,
}

pub type SkillSourceClassifier = fn(&Path) -> SkillSourceClassification;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SkillSourceClassification {
	pub source_kind: ResourceSourceKind,
	pub runtime_visibility: RuntimeVisibility,
	pub runtime_visibility_evidence: &'static str,
}

#[derive(Clone, Copy)]
pub struct GlobalSubAgentPaths {
	pub read: fn() -> Vec<PathBuf>,
	pub write: OptionalPathFn,
}

#[derive(Clone, Copy)]
pub struct ProjectSubAgentPaths {
	pub read: fn(&Path) -> Vec<PathBuf>,
	pub write: OptionalProjectPathFn,
}

/// Locations of an agent's instruction/rule files (e.g. CLAUDE.md, AGENTS.md).
/// `None` for a scope means the agent has no rule file there.
#[derive(Clone, Copy)]
pub struct RulePaths {
	pub global: Option<fn() -> Vec<PathBuf>>,
	pub project: Option<fn(&Path) -> Vec<PathBuf>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillReadSource {
	pub root: PathBuf,
	pub surface_ids: Vec<&'static str>,
	pub scope: ConfigSource,
	pub source_kind: ResourceSourceKind,
	pub precedence: usize,
	pub write_policy: ResourceWritePolicy,
	pub runtime_visibility: RuntimeVisibility,
	pub runtime_visibility_evidence: &'static str,
}

pub struct McpReadSource {
	pub path: PathBuf,
	pub source_kind: ResourceSourceKind,
	pub write_policy: ResourceWritePolicy,
	pub runtime_visibility: RuntimeVisibility,
	pub runtime_visibility_evidence: &'static str,
}

/// Static descriptor for an agent — one per agent, declared in agents/*.rs
pub struct AgentDescriptor {
	pub id: &'static str,
	pub display_name: &'static str,
	pub surfaces: &'static [AgentSurface],
	pub precedence: ResourcePrecedence,
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
	pub capabilities: Capabilities,
	pub global_skill_paths: Option<GlobalSkillPaths>,
	pub project_skill_paths: Option<ProjectSkillPaths>,
	pub global_sub_agent_paths: Option<GlobalSubAgentPaths>,
	pub project_sub_agent_paths: Option<ProjectSubAgentPaths>,
	/// Load sub-agents for the requested scope.
	/// Implementation is fully internal — no path information is exposed.
	pub load_sub_agents: LoadSubAgentsFn,
	/// Persist sub-agents for the requested scope.
	/// Implementation is fully internal — no path information is exposed.
	pub save_sub_agents: SaveSubAgentsFn,
	/// Directory/file markers that indicate this agent's project root
	pub project_markers: &'static [&'static str],
	/// Maps to the `-a, --agent` argument of `npx skills add` CLI
	/// e.g., "claude-code" becomes `npx skills add <source> -a claude-code`
	pub skills_cli_name: Option<&'static str>,
	/// Instruction/rule file locations (CLAUDE.md, AGENTS.md, …).
	/// `None` if the agent has no managed rule files.
	pub rule_paths: Option<RulePaths>,
}

impl AgentDescriptor {
	pub fn skill_read_sources(
		&self,
		project_root: Option<&Path>,
		scope: ResourceScope,
	) -> Vec<SkillReadSource> {
		let config_source = match scope {
			ResourceScope::GlobalOnly => ConfigSource::Global,
			ResourceScope::ProjectOnly => ConfigSource::Project,
			ResourceScope::Both => return Vec::new(),
		};
		let write_path = self.skill_write_path(project_root, scope);
		let classify = match scope {
			ResourceScope::GlobalOnly => {
				self.global_skill_paths.and_then(|paths| paths.classify)
			}
			ResourceScope::ProjectOnly => {
				self.project_skill_paths.and_then(|paths| paths.classify)
			}
			ResourceScope::Both => None,
		};

		self.skill_read_paths(project_root, scope)
			.into_iter()
			.enumerate()
			.map(|(precedence, root)| {
				let surface_ids = self
					.surfaces
					.iter()
					.filter(|surface| {
						let capabilities =
							surface.capabilities.unwrap_or(self.capabilities);
						let supports_scope = match scope {
							ResourceScope::GlobalOnly => {
								capabilities.skills.scopes.global
							}
							ResourceScope::ProjectOnly => {
								capabilities.skills.scopes.project
							}
							ResourceScope::Both => false,
						};
						supports_scope
							&& surface_matches_skill_path(surface, &root)
					})
					.map(|surface| surface.id)
					.collect::<Vec<_>>();
				let write_policy = if write_path.as_ref() == Some(&root) {
					ResourceWritePolicy::ReadWrite
				} else {
					ResourceWritePolicy::ReadOnly
				};
				let classification = classify.map(|classify| classify(&root));
				let source_kind = classification
					.map(|value| value.source_kind)
					.unwrap_or_else(|| {
						resource_source_kind(
							self.id,
							&root,
							precedence,
							write_path.as_deref(),
						)
					});
				let runtime_visibility = classification
					.map(|value| value.runtime_visibility)
					.unwrap_or_else(|| match source_kind {
						ResourceSourceKind::External => {
							RuntimeVisibility::Conditional
						}
						_ => RuntimeVisibility::Visible,
					});
				SkillReadSource {
					root,
					surface_ids,
					scope: config_source,
					source_kind,
					precedence,
					write_policy,
					runtime_visibility,
					runtime_visibility_evidence: classification
						.map(|value| value.runtime_visibility_evidence)
						.unwrap_or("declared by the Agent Skill loader"),
				}
			})
			.collect()
	}

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

	pub fn supports_sub_agent_scope(&self, scope: ResourceScope) -> bool {
		match scope {
			ResourceScope::GlobalOnly => {
				self.capabilities.sub_agents.scopes.global
			}
			ResourceScope::ProjectOnly => {
				self.capabilities.sub_agents.scopes.project
			}
			ResourceScope::Both => {
				self.capabilities.sub_agents.scopes.global
					|| self.capabilities.sub_agents.scopes.project
			}
		}
	}

	pub fn sub_agent_read_sources(
		&self,
		project_root: Option<&Path>,
		scope: ResourceScope,
	) -> Vec<SkillReadSource> {
		let config_source = match scope {
			ResourceScope::GlobalOnly => ConfigSource::Global,
			ResourceScope::ProjectOnly => ConfigSource::Project,
			ResourceScope::Both => return Vec::new(),
		};
		let paths = match scope {
			ResourceScope::GlobalOnly => self
				.global_sub_agent_paths
				.map(|paths| (paths.read)())
				.unwrap_or_default(),
			ResourceScope::ProjectOnly => project_root
				.and_then(|root| {
					self.project_sub_agent_paths.map(|paths| (paths.read)(root))
				})
				.unwrap_or_default(),
			ResourceScope::Both => Vec::new(),
		};
		let write_path = match scope {
			ResourceScope::GlobalOnly => self
				.global_sub_agent_paths
				.and_then(|paths| (paths.write)()),
			ResourceScope::ProjectOnly => project_root.and_then(|root| {
				self.project_sub_agent_paths
					.and_then(|paths| (paths.write)(root))
			}),
			ResourceScope::Both => None,
		};
		let surface_ids = self
			.surfaces
			.iter()
			.filter(|surface| {
				let scopes = surface
					.capabilities
					.unwrap_or(self.capabilities)
					.sub_agents
					.scopes;
				match scope {
					ResourceScope::GlobalOnly => scopes.global,
					ResourceScope::ProjectOnly => scopes.project,
					ResourceScope::Both => false,
				}
			})
			.map(|surface| surface.id)
			.collect::<Vec<_>>();

		paths
			.into_iter()
			.enumerate()
			.map(|(precedence, root)| SkillReadSource {
				write_policy: if write_path.as_ref() == Some(&root) {
					ResourceWritePolicy::ReadWrite
				} else {
					ResourceWritePolicy::ReadOnly
				},
				source_kind: resource_source_kind(
					self.id,
					&root,
					precedence,
					write_path.as_deref(),
				),
				root,
				surface_ids: surface_ids.clone(),
				scope: config_source,
				precedence,
				runtime_visibility: RuntimeVisibility::Visible,
				runtime_visibility_evidence:
					"declared by the Agent subagent loader",
			})
			.collect()
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
		let mut dirs = self.native_global_skill_read_paths();

		if self.capabilities.skills.universal {
			let universal_path = self
				.capabilities
				.skills
				.universal_global_path
				.and_then(|resolve| resolve())
				.or_else(get_universal_skills_path);
			if let Some(path) = universal_path {
				if !dirs.contains(&path) {
					dirs.push(path);
				}
			}
		}

		dirs
	}

	pub fn project_skill_read_paths(
		&self,
		project_root: &Path,
	) -> Vec<PathBuf> {
		let mut dirs = self.native_project_skill_read_paths(project_root);

		if self.capabilities.skills.universal {
			let path = get_universal_project_skills_path(project_root);
			if !dirs.contains(&path) {
				dirs.push(path);
			}
		}

		dirs
	}

	pub fn native_global_skill_read_paths(&self) -> Vec<PathBuf> {
		self.global_skill_paths
			.map(|paths| (paths.read)())
			.unwrap_or_default()
	}

	pub fn native_project_skill_read_paths(
		&self,
		project_root: &Path,
	) -> Vec<PathBuf> {
		self.project_skill_paths
			.map(|paths| (paths.read)(project_root))
			.unwrap_or_default()
	}

	pub fn native_skill_read_paths(
		&self,
		project_root: Option<&Path>,
		scope: ResourceScope,
	) -> Vec<PathBuf> {
		let mut paths = Vec::new();

		if scope == ResourceScope::ProjectOnly || scope == ResourceScope::Both {
			if let Some(root) = project_root {
				paths.extend(self.native_project_skill_read_paths(root));
			}
		}

		if scope == ResourceScope::GlobalOnly || scope == ResourceScope::Both {
			paths.extend(self.native_global_skill_read_paths());
		}

		paths
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

	pub fn global_rule_paths(&self) -> Vec<PathBuf> {
		self.rule_paths
			.and_then(|rules| rules.global)
			.map(|read| read())
			.unwrap_or_default()
	}

	pub fn project_rule_paths(&self, project_root: &Path) -> Vec<PathBuf> {
		self.rule_paths
			.and_then(|rules| rules.project)
			.map(|read| read(project_root))
			.unwrap_or_default()
	}

	pub fn rule_origin(
		&self,
		path: &Path,
		scope: ConfigSource,
		precedence: usize,
	) -> ResourceOrigin {
		let file_name = path.file_name().and_then(|value| value.to_str());
		let source_kind = if path.ends_with(".cursorrules") {
			ResourceSourceKind::Historical
		} else if file_name == Some("AGENTS.md") {
			ResourceSourceKind::Standard
		} else if file_name == Some("CLAUDE.md") && self.id != "claude" {
			ResourceSourceKind::Compatible
		} else {
			ResourceSourceKind::Native
		};
		ResourceOrigin {
			product_id: self.id.to_string(),
			surface_ids: self
				.surfaces
				.iter()
				.map(|surface| surface.id)
				.map(str::to_string)
				.collect(),
			scope,
			source_kind,
			physical_location: Some(path.to_string_lossy().into_owned()),
			precedence,
			write_policy: ResourceWritePolicy::ReadWrite,
			runtime_visibility: RuntimeVisibility::Visible,
			runtime_visibility_evidence: Some(
				"declared by the Agent rule loader".to_string(),
			),
		}
	}
}

fn surface_matches_skill_path(surface: &AgentSurface, path: &Path) -> bool {
	if surface.skill_path_markers.is_empty() {
		return true;
	}
	let normalized = path.to_string_lossy().replace('\\', "/");
	surface
		.skill_path_markers
		.iter()
		.any(|marker| normalized.contains(marker))
}

fn resource_source_kind(
	product_id: &str,
	path: &Path,
	precedence: usize,
	write_path: Option<&Path>,
) -> ResourceSourceKind {
	let normalized = path.to_string_lossy().replace('\\', "/");
	if normalized.contains("/plugin-cache/") || normalized.contains("/plugins/")
	{
		ResourceSourceKind::Plugin
	} else if normalized.contains("/.agents/") {
		ResourceSourceKind::Standard
	} else if normalized.starts_with("/etc/") {
		ResourceSourceKind::System
	} else if ["/.clawdbot/", "/.moltbot/", "/.mux/", "/.zencoder/"]
		.iter()
		.any(|part| normalized.contains(part))
	{
		ResourceSourceKind::Historical
	} else if write_path == Some(path) {
		ResourceSourceKind::Native
	} else if [
		("claude", "/.claude/"),
		("cursor", "/.cursor/"),
		("codex", "/.codex/"),
	]
	.iter()
	.any(|(owner, part)| product_id != *owner && normalized.contains(part))
	{
		ResourceSourceKind::Compatible
	} else if precedence == 0 {
		ResourceSourceKind::Native
	} else {
		ResourceSourceKind::External
	}
}

/// Get the global directory shared by Agent Skills compatible tools.
pub fn get_universal_skills_path() -> Option<PathBuf> {
	dirs::home_dir().map(|home| home.join(".agents/skills"))
}

pub fn get_universal_project_skills_path(project_root: &Path) -> PathBuf {
	project_root.join(".agents/skills")
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

pub fn load_mcps_from_sources(
	product_id: &str,
	surface_ids: &[&str],
	scope: ConfigSource,
	sources: Vec<McpReadSource>,
	parse: McpParseFn,
) -> Result<Vec<McpServer>> {
	let mut mcps = Vec::new();
	for (precedence, source) in sources.into_iter().enumerate() {
		let loaded = load_mcps_from_file(&source.path, parse)?;
		for mut mcp in loaded {
			mcp.config_source = Some(scope);
			mcp.origin = Some(ResourceOrigin {
				product_id: product_id.to_string(),
				surface_ids: surface_ids
					.iter()
					.map(|id| (*id).to_string())
					.collect(),
				scope,
				source_kind: source.source_kind,
				physical_location: Some(
					source.path.to_string_lossy().into_owned(),
				),
				precedence,
				write_policy: source.write_policy,
				runtime_visibility: source.runtime_visibility,
				runtime_visibility_evidence: Some(
					source.runtime_visibility_evidence.to_string(),
				),
			});
			mcps.push(mcp);
		}
	}
	Ok(mcps)
}

pub fn save_mcps_to_file(
	path: &Path,
	mcps: &[McpServer],
	serialize: McpSerializeFn,
) -> Result<()> {
	if let Some(parent) = path.parent() {
		fs::create_dir_all(parent)?;
	}

	let original_content = match fs::read_to_string(path) {
		Ok(content) => Some(content),
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
		Err(error) => return Err(error.into()),
	};
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
		McpTransport::Sse { .. } => capabilities.mcp.sse,
		McpTransport::StreamableHttp { .. } => capabilities.mcp.streamable_http,
	}
}

pub fn home_dir() -> Option<PathBuf> {
	dirs::home_dir()
}

/// Project-level `AGENTS.md`, the shared instruction file convention used by
/// several agents (Codex, OpenCode, Amp, …).
pub fn project_agents_md(project_root: &Path) -> Vec<PathBuf> {
	vec![project_root.join("AGENTS.md")]
}

// ── Sub-agent no-ops (used by agents that do not support sub-agents) ─────────

/// No-op sub-agent loader for agents that do not support sub-agents.
pub fn load_sub_agents_noop(
	_: Option<&Path>,
	_: ResourceScope,
) -> Result<Vec<SubAgent>> {
	Ok(Vec::new())
}

/// No-op sub-agent saver for agents that do not support sub-agents.
pub fn save_sub_agents_noop(
	_: Option<&Path>,
	_: ResourceScope,
	_: &[SubAgent],
) -> Result<()> {
	Ok(())
}

pub(crate) fn load_no_mcps(
	_: Option<&Path>,
	_: ResourceScope,
) -> Result<Vec<McpServer>> {
	Ok(Vec::new())
}

pub(crate) fn reject_mcp_save(
	_: Option<&Path>,
	_: ResourceScope,
	_: &[McpServer],
) -> Result<()> {
	Err(ConfigError::unsupported_operation(
		"persist",
		"MCP server",
		"Agent without MCP support",
	))
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

	// Amp uses a literal dotted key, not a nested object.
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

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn universal_skills_use_the_home_agents_directory() {
		let home = dirs::home_dir().expect("test home directory");

		assert_eq!(
			get_universal_skills_path(),
			Some(home.join(".agents/skills"))
		);
	}
}
