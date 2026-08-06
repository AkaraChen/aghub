use crate::{
	adapters::AgentAdapter,
	errors::{ConfigError, Result},
	manager::ConfigManager,
	models::{
		AgentConfig, AgentType, McpServer, McpTransport, ResourceScope,
		SubAgent,
	},
	registry,
};
use aghub_agents::descriptor::{
	get_universal_project_skills_path, get_universal_skills_path,
	UNIVERSAL_SKILL_TARGET_ID,
};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkillTarget {
	Universal,
	Agent(AgentType),
}

impl SkillTarget {
	pub fn id(self) -> &'static str {
		match self {
			Self::Universal => UNIVERSAL_SKILL_TARGET_ID,
			Self::Agent(agent) => agent.as_str(),
		}
	}

	pub fn manager(
		self,
		scope: ResourceScope,
		project_root: Option<&Path>,
	) -> ConfigManager {
		let adapter: Box<dyn AgentAdapter> =
			Box::new(SkillTargetAdapter { target: self });
		ConfigManager::with_scope(
			adapter,
			scope == ResourceScope::GlobalOnly,
			project_root,
			scope,
		)
	}

	pub fn write_path(
		self,
		scope: ResourceScope,
		project_root: Option<&Path>,
	) -> Option<PathBuf> {
		match self {
			Self::Universal => universal_skill_write_path(project_root, scope),
			Self::Agent(agent) => crate::create_adapter(agent)
				.target_skills_dir(project_root, scope),
		}
	}

	pub fn write_path_identity(
		self,
		scope: ResourceScope,
		project_root: Option<&Path>,
	) -> Option<PathBuf> {
		self.write_path(scope, project_root)
			.map(resolve_destination_identity)
	}

	pub fn supports_scope(
		self,
		scope: ResourceScope,
		project_root: Option<&Path>,
	) -> bool {
		self.write_path(scope, project_root).is_some()
	}

	pub fn supports_read_scope(
		self,
		scope: ResourceScope,
		project_root: Option<&Path>,
	) -> bool {
		!self.read_paths(scope, project_root).is_empty()
	}

	pub(crate) fn read_paths(
		self,
		scope: ResourceScope,
		project_root: Option<&Path>,
	) -> Vec<PathBuf> {
		match self {
			Self::Universal => universal_skill_paths(project_root, scope),
			Self::Agent(agent) => agent_skill_paths(agent, project_root, scope),
		}
	}
}

fn resolve_destination_identity(path: PathBuf) -> PathBuf {
	if let Ok(canonical) = std::fs::canonicalize(&path) {
		return canonical;
	}

	let mut missing = Vec::new();
	let mut current = path.as_path();
	while std::fs::symlink_metadata(current).is_err() {
		let Some(name) = current.file_name() else {
			return path;
		};
		missing.push(name.to_os_string());
		let Some(parent) = current.parent() else {
			return path;
		};
		current = parent;
	}

	let Ok(mut resolved) = std::fs::canonicalize(current) else {
		return path;
	};
	for component in missing.iter().rev() {
		resolved.push(component);
	}
	resolved
}

pub(crate) fn ensure_skill_target_not_linked(
	target_dir: &Path,
	scope: ResourceScope,
	project_root: Option<&Path>,
) -> Result<()> {
	let boundary = match scope {
		ResourceScope::GlobalOnly => dirs::home_dir(),
		ResourceScope::ProjectOnly => project_root.map(Path::to_path_buf),
		ResourceScope::Both => None,
	};
	let mut current = Some(target_dir);

	while let Some(path) = current {
		if boundary.as_deref() == Some(path) {
			break;
		}
		if std::fs::symlink_metadata(path)
			.is_ok_and(|metadata| metadata.file_type().is_symlink())
		{
			return Err(ConfigError::InvalidConfig(format!(
				"Cannot remove one Skill through linked directory '{}'; remove it from the shared target instead",
				path.display()
			)));
		}
		current = path.parent();
		if let (Some(path), Some(boundary)) = (current, boundary.as_deref()) {
			if !path.starts_with(boundary) {
				break;
			}
		}
	}

	Ok(())
}

impl FromStr for SkillTarget {
	type Err = String;

	fn from_str(value: &str) -> std::result::Result<Self, Self::Err> {
		if value == UNIVERSAL_SKILL_TARGET_ID {
			return Ok(Self::Universal);
		}
		value
			.parse::<AgentType>()
			.map(Self::Agent)
			.map_err(|_| format!("Unknown Skill target '{value}'"))
	}
}

impl From<AgentType> for SkillTarget {
	fn from(agent: AgentType) -> Self {
		Self::Agent(agent)
	}
}

fn universal_skill_paths(
	project_root: Option<&Path>,
	scope: ResourceScope,
) -> Vec<PathBuf> {
	match scope {
		ResourceScope::GlobalOnly => {
			get_universal_skills_path().into_iter().collect()
		}
		ResourceScope::ProjectOnly => project_root
			.map(get_universal_project_skills_path)
			.into_iter()
			.collect(),
		ResourceScope::Both => {
			let mut paths = project_root
				.map(get_universal_project_skills_path)
				.into_iter()
				.collect::<Vec<_>>();
			paths.extend(get_universal_skills_path());
			paths
		}
	}
}

fn universal_skill_write_path(
	project_root: Option<&Path>,
	scope: ResourceScope,
) -> Option<PathBuf> {
	match scope {
		ResourceScope::GlobalOnly => get_universal_skills_path(),
		ResourceScope::ProjectOnly => {
			project_root.map(get_universal_project_skills_path)
		}
		ResourceScope::Both => None,
	}
}

fn agent_skill_paths(
	agent: AgentType,
	project_root: Option<&Path>,
	scope: ResourceScope,
) -> Vec<PathBuf> {
	let descriptor = registry::get(agent);
	let universal_paths = universal_skill_paths(project_root, scope);
	let native_write = descriptor.skill_write_path(project_root, scope);

	if native_write
		.as_ref()
		.is_some_and(|path| universal_paths.contains(path))
	{
		return universal_paths;
	}

	let claimed_paths = registered_skill_write_paths(project_root, scope);
	descriptor
		.native_skill_read_paths(project_root, scope)
		.into_iter()
		.filter(|path| {
			if native_write.as_ref() == Some(path) {
				return true;
			}
			!universal_paths.contains(path) && !claimed_paths.contains(path)
		})
		.collect()
}

fn registered_skill_write_paths(
	project_root: Option<&Path>,
	scope: ResourceScope,
) -> Vec<PathBuf> {
	let mut paths = universal_skill_paths(project_root, scope);
	for descriptor in registry::iter_all() {
		if let Some(path) = descriptor.skill_write_path(project_root, scope) {
			if !paths.contains(&path) {
				paths.push(path);
			}
		}
	}
	paths
}

struct SkillTargetAdapter {
	target: SkillTarget,
}

impl AgentAdapter for SkillTargetAdapter {
	fn name(&self) -> &'static str {
		self.target.id()
	}

	fn supports_skill_scope(&self, scope: ResourceScope) -> bool {
		match self.target {
			SkillTarget::Universal => scope != ResourceScope::Both,
			SkillTarget::Agent(agent) => {
				registry::get(agent).supports_skill_scope(scope)
			}
		}
	}

	fn supports_mcp_scope(&self, _scope: ResourceScope) -> bool {
		false
	}

	fn supports_sub_agent_scope(&self, _scope: ResourceScope) -> bool {
		false
	}

	fn mcp_config_path(
		&self,
		_project_root: Option<&Path>,
		_scope: ResourceScope,
	) -> Option<PathBuf> {
		None
	}

	fn load_mcps(
		&self,
		_project_root: Option<&Path>,
		_scope: ResourceScope,
	) -> Result<Vec<McpServer>> {
		Err(unsupported_target_resource(
			self.target,
			"read",
			"MCP server",
		))
	}

	fn save_mcps(
		&self,
		_project_root: Option<&Path>,
		_scope: ResourceScope,
		_mcps: &[McpServer],
	) -> Result<()> {
		Err(unsupported_target_resource(
			self.target,
			"persist",
			"MCP server",
		))
	}

	fn load_sub_agents(
		&self,
		_project_root: Option<&Path>,
		_scope: ResourceScope,
	) -> Result<Vec<SubAgent>> {
		Err(unsupported_target_resource(
			self.target,
			"read",
			"sub-agent",
		))
	}

	fn save_sub_agents(
		&self,
		_project_root: Option<&Path>,
		_scope: ResourceScope,
		_agents: &[SubAgent],
	) -> Result<()> {
		Err(unsupported_target_resource(
			self.target,
			"persist",
			"sub-agent",
		))
	}

	fn load_config(
		&self,
		project_root: Option<&Path>,
		scope: ResourceScope,
	) -> Result<AgentConfig> {
		let mut config = AgentConfig::new();
		config.skills = crate::skills::load_skills_from_dirs(
			&self.target.read_paths(scope, project_root),
		);
		Ok(config)
	}

	fn get_skills_paths(
		&self,
		project_root: Option<&Path>,
		scope: ResourceScope,
	) -> Vec<PathBuf> {
		self.target.read_paths(scope, project_root)
	}

	fn target_skills_dir(
		&self,
		project_root: Option<&Path>,
		scope: ResourceScope,
	) -> Option<PathBuf> {
		self.target.write_path(scope, project_root)
	}

	fn mcp_supports_transport(&self, _transport: &McpTransport) -> bool {
		false
	}

	fn validate_command(&self, _config_path: Option<&Path>) -> Command {
		Command::new(self.target.id())
	}
}

fn unsupported_target_resource(
	target: SkillTarget,
	operation: &str,
	resource: &str,
) -> ConfigError {
	ConfigError::unsupported_operation(operation, resource, target.id())
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::fs;

	#[test]
	fn parses_universal_and_agent_targets() {
		assert_eq!(
			"universal".parse::<SkillTarget>(),
			Ok(SkillTarget::Universal)
		);
		assert_eq!(
			"codex".parse::<SkillTarget>(),
			Ok(SkillTarget::Agent(AgentType::Codex))
		);
	}

	#[test]
	fn universal_and_codex_global_targets_use_distinct_directories() {
		let home = dirs::home_dir().expect("test home directory");

		assert_eq!(
			SkillTarget::Universal.write_path(ResourceScope::GlobalOnly, None,),
			Some(home.join(".agents/skills"))
		);
		assert_eq!(
			SkillTarget::Agent(AgentType::Codex)
				.write_path(ResourceScope::GlobalOnly, None,),
			Some(home.join(".codex/skills"))
		);
	}

	#[test]
	fn compatibility_read_paths_are_owned_by_their_installation_target() {
		let home = dirs::home_dir().expect("test home directory");
		let cursor_paths = SkillTarget::Agent(AgentType::Cursor)
			.read_paths(ResourceScope::GlobalOnly, None);

		assert!(cursor_paths.contains(&home.join(".cursor/skills")));
		assert!(!cursor_paths.contains(&home.join(".claude/skills")));
		assert!(!cursor_paths.contains(&home.join(".codex/skills")));
	}

	#[test]
	fn universal_project_target_uses_the_project_agents_directory() {
		let project_root = Path::new("/tmp/project");

		assert_eq!(
			SkillTarget::Universal
				.write_path(ResourceScope::ProjectOnly, Some(project_root),),
			Some(project_root.join(".agents/skills"))
		);
	}

	#[test]
	fn agent_target_rejects_unknown_ids() {
		assert!("unknown".parse::<SkillTarget>().is_err());
	}

	#[test]
	fn agent_target_uses_registered_descriptor() {
		let target = SkillTarget::Agent(AgentType::Claude);

		assert_eq!(crate::registry::get(AgentType::Claude).id, target.id());
	}

	#[cfg(unix)]
	#[test]
	fn linked_parent_inside_project_is_not_an_independent_target() {
		let temp = tempfile::tempdir().unwrap();
		let shared = temp.path().join("shared");
		fs::create_dir_all(shared.join("skills")).unwrap();
		let linked_parent = temp.path().join(".claude");
		std::os::unix::fs::symlink(&shared, &linked_parent).unwrap();

		let result = ensure_skill_target_not_linked(
			&linked_parent.join("skills"),
			ResourceScope::ProjectOnly,
			Some(temp.path()),
		);

		assert!(result.is_err());
	}

	#[test]
	fn agent_target_does_not_load_the_universal_installation() {
		let temp = tempfile::tempdir().unwrap();
		let root = temp.path();
		let universal_skill = root.join(".agents/skills/shared-skill");
		fs::create_dir_all(&universal_skill).unwrap();
		fs::write(
			universal_skill.join("SKILL.md"),
			"---\nname: shared-skill\ndescription: Shared\n---\n",
		)
		.unwrap();

		let mut universal = SkillTarget::Universal
			.manager(ResourceScope::ProjectOnly, Some(root));
		universal.load().unwrap();
		assert!(universal.get_skill("shared-skill").is_some());

		let mut opencode = SkillTarget::Agent(AgentType::OpenCode)
			.manager(ResourceScope::ProjectOnly, Some(root));
		opencode.load().unwrap();
		assert!(opencode.get_skill("shared-skill").is_none());

		opencode
			.add_skill(crate::models::Skill::new("shared-skill"))
			.unwrap();
		assert!(root
			.join(".opencode/skills/shared-skill/SKILL.md")
			.is_file());
		assert!(universal_skill.join("SKILL.md").is_file());
	}

	#[test]
	fn shared_native_target_reads_the_universal_installation() {
		let temp = tempfile::tempdir().unwrap();
		let root = temp.path();
		let universal_skill = root.join(".agents/skills/shared-skill");
		fs::create_dir_all(&universal_skill).unwrap();
		fs::write(
			universal_skill.join("SKILL.md"),
			"---\nname: shared-skill\ndescription: Shared\n---\n",
		)
		.unwrap();

		let mut cline = SkillTarget::Agent(AgentType::Cline)
			.manager(ResourceScope::ProjectOnly, Some(root));
		cline.load().unwrap();

		assert!(cline.get_skill("shared-skill").is_some());
	}
}
