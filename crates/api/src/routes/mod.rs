pub mod agents;
pub mod catchers;
pub mod credentials;
pub mod integrations;
pub mod market;
pub mod mcps;
pub mod plugins;
pub mod skills;
pub mod sub_agents;

use aghub_core::{
	create_adapter, manager::ConfigManager, models::ResourceScope,
};
use rocket::http::Status;
use std::path::PathBuf;

use crate::error::ApiError;
use crate::extractors::{AgentParam, ResolvedScope};

pub fn build_manager_from_resolved(
	agent: &AgentParam,
	scope: &ResolvedScope,
) -> Result<ConfigManager, ApiError> {
	let adapter = create_adapter(agent.0);
	match scope {
		ResolvedScope::Global => Ok(ConfigManager::new(adapter, true, None)),
		ResolvedScope::Project { root } => {
			Ok(ConfigManager::new(adapter, false, Some(root)))
		}
		ResolvedScope::All {
			project_root: Some(root),
		} => Ok(ConfigManager::with_scope(
			adapter,
			false,
			Some(root),
			ResourceScope::Both,
		)),
		ResolvedScope::All { project_root: None } => {
			Ok(ConfigManager::new(adapter, true, None))
		}
	}
}

pub fn require_writable_scope(scope: &ResolvedScope) -> Result<(), ApiError> {
	if scope.is_all() {
		return Err(ApiError::new(
            Status::MethodNotAllowed,
            "scope 'all' is read-only; use 'global' or 'project' for write operations",
            "READ_ONLY_SCOPE",
        ));
	}
	Ok(())
}

/// Map a resolved scope to the (ResourceScope, project_root) pair used by load_all_agents.
pub fn resolved_to_resource_scope(
	scope: &ResolvedScope,
) -> (ResourceScope, Option<PathBuf>) {
	match scope {
		ResolvedScope::Global => (ResourceScope::GlobalOnly, None),
		ResolvedScope::Project { root } => {
			(ResourceScope::ProjectOnly, Some(root.clone()))
		}
		ResolvedScope::All { project_root } => {
			(ResourceScope::Both, project_root.clone())
		}
	}
}
