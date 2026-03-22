pub mod agents;
pub mod catchers;
pub mod mcps;
pub mod skills;

use aghub_core::{create_adapter, manager::ConfigManager, models::ResourceScope};
use rocket::http::Status;

use crate::error::ApiError;
use crate::extractors::{AgentParam, ResolvedScope};

pub fn build_manager_from_resolved(
    agent: &AgentParam,
    scope: &ResolvedScope,
) -> Result<ConfigManager, ApiError> {
    let adapter = create_adapter(agent.0);
    match scope {
        ResolvedScope::Global => Ok(ConfigManager::new(adapter, true, None)),
        ResolvedScope::Project { root } => Ok(ConfigManager::new(adapter, false, Some(root))),
        ResolvedScope::All {
            project_root: Some(root),
        } => Ok(ConfigManager::with_scope(
            adapter,
            false,
            Some(root),
            ResourceScope::Both,
        )),
        ResolvedScope::All { project_root: None } => Ok(ConfigManager::new(adapter, true, None)),
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
