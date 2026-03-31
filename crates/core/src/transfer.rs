use crate::{
	create_adapter,
	errors::{ConfigError, Result},
	manager::ConfigManager,
	models::{AgentType, McpServer, McpTransport, Skill},
	registry,
};
use skill::sanitize::sanitize_name;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum InstallScope {
	Global,
	Project,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallTarget {
	pub agent: AgentType,
	pub scope: InstallScope,
	pub project_root: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct ResourceLocator {
	pub agent: AgentType,
	pub scope: InstallScope,
	pub project_root: Option<PathBuf>,
	pub name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OperationAction {
	Copy,
	Delete,
}

#[derive(Debug, Clone)]
pub struct OperationResult {
	pub target: InstallTarget,
	pub action: OperationAction,
	pub success: bool,
	pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct OperationBatchResult {
	pub results: Vec<OperationResult>,
}

impl OperationBatchResult {
	pub fn success_count(&self) -> usize {
		self.results.iter().filter(|r| r.success).count()
	}

	pub fn failed_count(&self) -> usize {
		self.results.iter().filter(|r| !r.success).count()
	}
}

fn build_manager(target: &InstallTarget) -> ConfigManager {
	let adapter = create_adapter(target.agent);
	match target.scope {
		InstallScope::Global => ConfigManager::new(adapter, true, None),
		InstallScope::Project => {
			ConfigManager::new(adapter, false, target.project_root.as_deref())
		}
	}
}

fn validate_target(target: &InstallTarget) -> Result<()> {
	if target.scope == InstallScope::Project && target.project_root.is_none() {
		return Err(ConfigError::InvalidConfig(
			"project_root is required for project targets".to_string(),
		));
	}
	Ok(())
}

fn mcp_supported_for_target(
	target: &InstallTarget,
	mcp: &McpServer,
) -> Result<()> {
	let descriptor = registry::get(target.agent);
	let supported = match &mcp.transport {
		McpTransport::Stdio { .. } => descriptor.capabilities.mcp_stdio,
		McpTransport::Sse { .. } | McpTransport::StreamableHttp { .. } => {
			descriptor.capabilities.mcp_remote
		}
	};

	if supported {
		return Ok(());
	}

	Err(ConfigError::unsupported_operation(
		"copy incompatible",
		"MCP server",
		descriptor.id,
	))
}

fn load_source_mcp(source: &ResourceLocator) -> Result<McpServer> {
	let mut manager = build_manager(&InstallTarget {
		agent: source.agent,
		scope: source.scope,
		project_root: source.project_root.clone(),
	});
	manager.load()?;
	manager.get_mcp(&source.name).cloned().ok_or_else(|| {
		ConfigError::resource_not_found("MCP server", &source.name)
	})
}

fn load_source_skill(source: &ResourceLocator) -> Result<Skill> {
	let mut manager = build_manager(&InstallTarget {
		agent: source.agent,
		scope: source.scope,
		project_root: source.project_root.clone(),
	});
	manager.load()?;
	manager
		.get_skill(&source.name)
		.cloned()
		.ok_or_else(|| ConfigError::resource_not_found("skill", &source.name))
}

fn ensure_loaded(manager: &mut ConfigManager) -> Result<()> {
	match manager.load() {
		Ok(_) => Ok(()),
		Err(ConfigError::NotFound { .. }) => {
			manager.init_empty_config();
			Ok(())
		}
		Err(err) => Err(err),
	}
}

fn resolve_skill_file(path: &str) -> PathBuf {
	if let Some(stripped) = path.strip_prefix("~/") {
		dirs::home_dir().unwrap().join(stripped)
	} else {
		PathBuf::from(path)
	}
}

fn resolve_skill_root(skill: &Skill) -> Result<PathBuf> {
	let path = skill
		.canonical_path
		.as_deref()
		.or(skill.source_path.as_deref())
		.map(resolve_skill_file)
		.ok_or_else(|| {
			ConfigError::InvalidConfig(format!(
				"Skill '{}' has no source path to copy from",
				skill.name
			))
		})?;

	let root = if path.is_dir() {
		path
	} else {
		path.parent().map(Path::to_path_buf).ok_or_else(|| {
			ConfigError::InvalidConfig(format!(
				"Skill '{}' has invalid source path",
				skill.name
			))
		})?
	};

	if !root.exists() {
		return Err(ConfigError::InvalidConfig(format!(
			"Skill source path '{}' does not exist",
			root.display()
		)));
	}

	Ok(root)
}

fn copy_dir_recursive(from: &Path, to: &Path) -> Result<()> {
	fs::create_dir_all(to)?;
	for entry in fs::read_dir(from)? {
		let entry = entry?;
		let from_path = entry.path();
		let to_path = to.join(entry.file_name());
		let file_type = entry.file_type()?;
		if file_type.is_dir() {
			copy_dir_recursive(&from_path, &to_path)?;
		} else {
			fs::copy(&from_path, &to_path)?;
		}
	}
	Ok(())
}

fn skill_target_dir(target: &InstallTarget) -> Result<PathBuf> {
	let adapter = create_adapter(target.agent);
	let dir = adapter.target_skills_dir(
		target.project_root.as_deref(),
		match target.scope {
			InstallScope::Global => crate::models::ResourceScope::GlobalOnly,
			InstallScope::Project => crate::models::ResourceScope::ProjectOnly,
		},
	);

	dir.ok_or_else(|| {
		ConfigError::unsupported_operation(
			"persist",
			"skill",
			registry::get(target.agent).id,
		)
	})
}

/// Find where a skill actually exists in each agent's skills directories.
/// Returns (skill_path, agent) pairs for locations where the skill exists.
fn find_skill_locations_in_agents(
	skill_name: &str,
	agents: &[AgentType],
	scope: InstallScope,
	project_root: Option<&PathBuf>,
) -> Vec<(PathBuf, AgentType)> {
	let safe_name = sanitize_name(skill_name);
	let mut locations = Vec::new();

	for agent in agents {
		let adapter = create_adapter(*agent);
		let resource_scope = match scope {
			InstallScope::Global => crate::models::ResourceScope::GlobalOnly,
			InstallScope::Project => crate::models::ResourceScope::ProjectOnly,
		};
		let skills_dirs = adapter.get_skills_paths(
			project_root.map(|p| p.as_path()),
			resource_scope,
		);

		for dir in skills_dirs {
			let skill_path = dir.join(&safe_name);
			if skill_path.exists() {
				locations.push((skill_path, *agent));
			}
		}
	}

	locations
}

fn group_agents_by_target_dir(
	agents: &[AgentType],
	scope: InstallScope,
	project_root: Option<&PathBuf>,
) -> HashMap<PathBuf, Vec<AgentType>> {
	let mut dir_to_agents: HashMap<PathBuf, Vec<AgentType>> = HashMap::new();
	for agent in agents {
		let target = InstallTarget {
			agent: *agent,
			scope,
			project_root: project_root.cloned(),
		};
		if let Ok(target_dir) = skill_target_dir(&target) {
			dir_to_agents.entry(target_dir).or_default().push(*agent);
		}
	}
	dir_to_agents
}

fn unique_targets(targets: Vec<InstallTarget>) -> Vec<InstallTarget> {
	let mut seen = HashSet::new();
	let mut unique = Vec::new();
	for target in targets {
		let key = format!(
			"{}|{:?}|{}",
			target.agent.as_str(),
			target.scope,
			target
				.project_root
				.as_ref()
				.map(|path| path.display().to_string())
				.unwrap_or_default()
		);
		if seen.insert(key) {
			unique.push(target);
		}
	}
	unique
}

pub fn transfer_mcp(
	source: ResourceLocator,
	destinations: Vec<InstallTarget>,
) -> Result<OperationBatchResult> {
	let mcp = load_source_mcp(&source)?;
	let mut results = Vec::new();

	for target in unique_targets(destinations) {
		let outcome = (|| -> Result<()> {
			validate_target(&target)?;
			mcp_supported_for_target(&target, &mcp)?;
			let mut manager = build_manager(&target);
			ensure_loaded(&mut manager)?;
			manager.add_mcp(mcp.clone())
		})();

		results.push(OperationResult {
			target,
			action: OperationAction::Copy,
			success: outcome.is_ok(),
			error: outcome.err().map(|err| err.to_string()),
		});
	}

	Ok(OperationBatchResult { results })
}

pub fn reconcile_mcp(
	source: ResourceLocator,
	added: Vec<AgentType>,
	removed: Vec<AgentType>,
) -> Result<OperationBatchResult> {
	let mcp = load_source_mcp(&source)?;
	let mut results = Vec::new();

	let target_scope = source.scope;
	let target_project_root = source.project_root.clone();

	for agent in added {
		let target = InstallTarget {
			agent,
			scope: target_scope,
			project_root: target_project_root.clone(),
		};
		let outcome = (|| -> Result<()> {
			validate_target(&target)?;
			mcp_supported_for_target(&target, &mcp)?;
			let mut manager = build_manager(&target);
			ensure_loaded(&mut manager)?;
			manager.add_mcp(mcp.clone())
		})();

		results.push(OperationResult {
			target,
			action: OperationAction::Copy,
			success: outcome.is_ok(),
			error: outcome.err().map(|err| err.to_string()),
		});
	}

	for agent in removed {
		let target = InstallTarget {
			agent,
			scope: target_scope,
			project_root: target_project_root.clone(),
		};
		let outcome = (|| -> Result<()> {
			validate_target(&target)?;
			let mut manager = build_manager(&target);
			ensure_loaded(&mut manager)?;
			manager.remove_mcp(&source.name)
		})();

		results.push(OperationResult {
			target,
			action: OperationAction::Delete,
			success: outcome.is_ok(),
			error: outcome.err().map(|err| err.to_string()),
		});
	}

	Ok(OperationBatchResult { results })
}

pub fn transfer_skill(
	source: ResourceLocator,
	destinations: Vec<InstallTarget>,
) -> Result<OperationBatchResult> {
	let skill = load_source_skill(&source)?;
	let source_root = resolve_skill_root(&skill)?;
	let safe_name = sanitize_name(&skill.name);
	let mut results = Vec::new();

	for target in unique_targets(destinations) {
		let outcome = (|| -> Result<()> {
			validate_target(&target)?;
			let target_dir = skill_target_dir(&target)?;
			let mut manager = build_manager(&target);
			ensure_loaded(&mut manager)?;
			if manager.get_skill(&skill.name).is_some() {
				return Err(ConfigError::resource_exists("skill", &skill.name));
			}

			let dest_root = target_dir.join(&safe_name);
			if dest_root.exists() {
				return Err(ConfigError::resource_exists("skill", &skill.name));
			}

			copy_dir_recursive(&source_root, &dest_root)
		})();

		results.push(OperationResult {
			target,
			action: OperationAction::Copy,
			success: outcome.is_ok(),
			error: outcome.err().map(|err| err.to_string()),
		});
	}

	Ok(OperationBatchResult { results })
}

pub fn reconcile_skill(
	source: ResourceLocator,
	added: Vec<AgentType>,
	removed: Vec<AgentType>,
) -> Result<OperationBatchResult> {
	let skill = load_source_skill(&source)?;
	let source_root = resolve_skill_root(&skill)?;
	let safe_name = sanitize_name(&skill.name);
	let mut results = Vec::new();

	let target_scope = source.scope;
	let target_project_root = source.project_root.clone();

	// Group agents by target directory to avoid redundant copies
	let dir_to_agents = group_agents_by_target_dir(
		&added,
		target_scope,
		target_project_root.as_ref(),
	);

	// Process each unique directory
	for (target_dir, agents) in dir_to_agents {
		let dest_root = target_dir.join(&safe_name);
		let already_exists = dest_root.exists();

		// Copy once per directory (if doesn't exist)
		if !already_exists {
			if let Err(e) = copy_dir_recursive(&source_root, &dest_root) {
				// If copy fails, all agents in this group fail
				for agent in agents {
					results.push(OperationResult {
						target: InstallTarget {
							agent,
							scope: target_scope,
							project_root: target_project_root.clone(),
						},
						action: OperationAction::Copy,
						success: false,
						error: Some(e.to_string()),
					});
				}
				continue;
			}
		}

		// All agents in this group succeed (skill is auto-discovered from dir)
		for agent in agents {
			results.push(OperationResult {
				target: InstallTarget {
					agent,
					scope: target_scope,
					project_root: target_project_root.clone(),
				},
				action: OperationAction::Copy,
				success: true,
				error: None,
			});
		}
	}

	// Find actual locations of the skill in removed agents' directories
	let skill_locations = find_skill_locations_in_agents(
		&skill.name,
		&removed,
		target_scope,
		target_project_root.as_ref(),
	);

	// Process each actual location for deletion
	for (skill_path, agent) in skill_locations {
		let delete_error = fs::remove_dir_all(&skill_path).err();

		results.push(OperationResult {
			target: InstallTarget {
				agent,
				scope: target_scope,
				project_root: target_project_root.clone(),
			},
			action: OperationAction::Delete,
			success: delete_error.is_none(),
			error: delete_error.as_ref().map(|e| e.to_string()),
		});
	}

	Ok(OperationBatchResult { results })
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::models::McpTransport;
	use std::sync::{Mutex, OnceLock};
	use tempfile::tempdir;

	fn env_lock() -> &'static Mutex<()> {
		static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
		LOCK.get_or_init(|| Mutex::new(()))
	}

	#[test]
	fn transfer_mcp_copies_to_other_agent_project() {
		let _guard = env_lock().lock().unwrap();
		let temp = tempdir().unwrap();
		let source_root = temp.path().join("source");
		let dest_root = temp.path().join("dest");
		fs::create_dir_all(&source_root).unwrap();
		fs::create_dir_all(&dest_root).unwrap();

		let mut source_manager = ConfigManager::new(
			create_adapter(AgentType::Claude),
			false,
			Some(&source_root),
		);
		source_manager.load().unwrap();
		source_manager
			.add_mcp(McpServer::new(
				"filesystem",
				McpTransport::stdio("npx", vec!["mcp-filesystem".to_string()]),
			))
			.unwrap();

		let result = transfer_mcp(
			ResourceLocator {
				agent: AgentType::Claude,
				scope: InstallScope::Project,
				project_root: Some(source_root.clone()),
				name: "filesystem".to_string(),
			},
			vec![InstallTarget {
				agent: AgentType::Cursor,
				scope: InstallScope::Project,
				project_root: Some(dest_root.clone()),
			}],
		)
		.unwrap();

		assert_eq!(result.success_count(), 1);

		let mut dest_manager = ConfigManager::new(
			create_adapter(AgentType::Cursor),
			false,
			Some(&dest_root),
		);
		dest_manager.load().unwrap();
		assert!(dest_manager.get_mcp("filesystem").is_some());
	}

	#[test]
	fn reconcile_mcp_deletes_when_removed() {
		let _guard = env_lock().lock().unwrap();
		let temp = tempdir().unwrap();
		let root = temp.path().join("project");
		fs::create_dir_all(&root).unwrap();

		let mut manager = ConfigManager::new(
			create_adapter(AgentType::Claude),
			false,
			Some(&root),
		);
		manager.load().unwrap();
		manager
			.add_mcp(McpServer::new(
				"filesystem",
				McpTransport::stdio("npx", vec!["mcp-filesystem".to_string()]),
			))
			.unwrap();

		let result = reconcile_mcp(
			ResourceLocator {
				agent: AgentType::Claude,
				scope: InstallScope::Project,
				project_root: Some(root.clone()),
				name: "filesystem".to_string(),
			},
			vec![],                  // added
			vec![AgentType::Claude], // removed
		)
		.unwrap();

		assert_eq!(result.results.len(), 1);
		assert_eq!(result.results[0].action, OperationAction::Delete);

		let mut manager = ConfigManager::new(
			create_adapter(AgentType::Claude),
			false,
			Some(&root),
		);
		manager.load().unwrap();
		assert!(manager.get_mcp("filesystem").is_none());
	}

	#[test]
	fn transfer_skill_copies_whole_folder() {
		let _guard = env_lock().lock().unwrap();
		let temp = tempdir().unwrap();
		let source_root = temp.path().join("source");
		let dest_root = temp.path().join("dest");
		fs::create_dir_all(&source_root).unwrap();
		fs::create_dir_all(&dest_root).unwrap();

		let mut source_manager = ConfigManager::new(
			create_adapter(AgentType::Claude),
			false,
			Some(&source_root),
		);
		source_manager.load().unwrap();
		let mut skill = Skill::new("repo-helper");
		skill.description = Some("Copies files".to_string());
		source_manager.add_skill(skill).unwrap();
		let asset_dir = source_root.join(".claude/skills/repo-helper/assets");
		fs::create_dir_all(&asset_dir).unwrap();
		fs::write(asset_dir.join("notes.txt"), "hello").unwrap();

		let result = transfer_skill(
			ResourceLocator {
				agent: AgentType::Claude,
				scope: InstallScope::Project,
				project_root: Some(source_root.clone()),
				name: "repo-helper".to_string(),
			},
			vec![InstallTarget {
				agent: AgentType::Cursor,
				scope: InstallScope::Project,
				project_root: Some(dest_root.clone()),
			}],
		)
		.unwrap();

		assert_eq!(result.success_count(), 1);
		assert!(dest_root
			.join(".cursor/skills/repo-helper/assets/notes.txt")
			.exists());
	}

	#[test]
	fn reconcile_skill_deletes_when_removed() {
		let _guard = env_lock().lock().unwrap();
		let temp = tempdir().unwrap();
		let root = temp.path().join("project");
		fs::create_dir_all(&root).unwrap();

		let mut manager = ConfigManager::new(
			create_adapter(AgentType::Claude),
			false,
			Some(&root),
		);
		manager.load().unwrap();
		let mut skill = Skill::new("repo-helper");
		skill.description = Some("Copies files".to_string());
		manager.add_skill(skill).unwrap();

		let result = reconcile_skill(
			ResourceLocator {
				agent: AgentType::Claude,
				scope: InstallScope::Project,
				project_root: Some(root.clone()),
				name: "repo-helper".to_string(),
			},
			vec![],                  // added
			vec![AgentType::Claude], // removed
		)
		.unwrap();

		assert_eq!(result.results.len(), 1);
		assert_eq!(result.results[0].action, OperationAction::Delete);

		let mut manager = ConfigManager::new(
			create_adapter(AgentType::Claude),
			false,
			Some(&root),
		);
		manager.load().unwrap();
		assert!(manager.get_skill("repo-helper").is_none());
	}
}
