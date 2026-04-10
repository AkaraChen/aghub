use crate::dto::plugin::{
	CCPluginAuthorResponse, CCPluginCheckUpdateResponse, CCPluginResponse,
	CCPluginScopeResponse,
};
use crate::error::ApiError;
use aghub_plugins::claude::settings::InstallScope;
use aghub_plugins::claude::{ClaudePluginInfo, ClaudePluginManager};
use aghub_plugins::installer::PluginInstaller;
use aghub_plugins::PluginId;
use log::warn;
use std::path::{Component, Path, PathBuf};

pub(super) fn parse_plugin_id(plugin_id: &str) -> Result<PluginId, ApiError> {
	PluginId::parse(plugin_id)
		.map_err(|e| ApiError::bad_request(format!("Invalid plugin ID: {e}")))
}

pub(super) fn parse_install_scope(
	scope: &str,
) -> Result<InstallScope, ApiError> {
	match scope {
		"user" | "project" | "local" => Ok(InstallScope::from(scope)),
		_ => Err(ApiError::bad_request(format!(
			"Invalid scope '{scope}'. Use 'user', 'project', or 'local'"
		))),
	}
}

pub(super) fn load_plugin_manager() -> Result<ClaudePluginManager, ApiError> {
	ClaudePluginManager::new().map_err(|e| {
		ApiError::internal(format!("Failed to load plugin manager: {e}"))
	})
}

pub(super) fn load_plugin_installer() -> Result<PluginInstaller, ApiError> {
	PluginInstaller::new().map_err(|e| {
		ApiError::internal(format!("Failed to create plugin installer: {e}"))
	})
}

fn plugin_not_found(id: &PluginId) -> ApiError {
	ApiError::not_found(format!("Plugin '{}' not found", id))
}

pub(super) fn get_plugin(
	manager: &ClaudePluginManager,
	id: &PluginId,
) -> Result<ClaudePluginInfo, ApiError> {
	manager
		.get_plugin(id)
		.cloned()
		.ok_or_else(|| plugin_not_found(id))
}

pub(super) fn load_manager_and_plugin(
	id: &PluginId,
) -> Result<(ClaudePluginManager, ClaudePluginInfo), ApiError> {
	let manager = load_plugin_manager()?;
	let plugin = get_plugin(&manager, id)?;
	Ok((manager, plugin))
}

pub(super) fn sanitize_path_home(path: &Path) -> String {
	if let Some(home) = dirs::home_dir() {
		if let Ok(relative) = path.strip_prefix(&home) {
			return PathBuf::from("~").join(relative).display().to_string();
		}
	}

	let tail: Vec<String> = path
		.components()
		.filter_map(|component| match component {
			Component::Normal(part) => {
				Some(part.to_string_lossy().into_owned())
			}
			_ => None,
		})
		.rev()
		.take(3)
		.collect::<Vec<_>>()
		.into_iter()
		.rev()
		.collect();

	if tail.is_empty() {
		return "…".to_string();
	}

	format!("…/{}", tail.join("/"))
}

fn should_check_updates(id: &PluginId) -> bool {
	id.source == "claude-plugins-official" || id.source.starts_with("http")
}

pub(super) fn resolve_plugin_scope<'a>(
	plugin: &'a ClaudePluginInfo,
	scope: Option<&str>,
) -> Result<Option<&'a aghub_plugins::claude::PluginScopeInfo>, ApiError> {
	match scope {
		Some(value) => {
			parse_install_scope(value)?;
			plugin
				.scopes
				.iter()
				.find(|item| item.scope == value)
				.map(Some)
				.ok_or_else(|| {
					ApiError::bad_request(format!(
						"Plugin '{}' is not installed for scope '{}'",
						plugin.id, value
					))
				})
		}
		None => Ok(plugin.scopes.first()),
	}
}

pub(super) fn resolve_plugin_folder(
	plugin: &ClaudePluginInfo,
	scope: Option<&str>,
) -> Result<PathBuf, ApiError> {
	Ok(resolve_plugin_scope(plugin, scope)?
		.map(|item| item.install_path.clone())
		.unwrap_or_else(|| plugin.install_path.clone()))
}

pub(super) async fn resolve_plugin_update(
	id: &PluginId,
	current_version: &str,
	current_commit: Option<&str>,
) -> (bool, Option<String>) {
	if !should_check_updates(id) {
		return (false, None);
	}

	let installer = match load_plugin_installer() {
		Ok(installer) => installer,
		Err(_) => {
			warn!("Failed to create plugin installer for {}", id);
			return (false, None);
		}
	};

	match installer
		.check_update_against(id, current_version, current_commit)
		.await
	{
		Ok(Some((latest_version, _))) => (true, Some(latest_version)),
		Ok(None) => (false, None),
		Err(error) => {
			warn!("Failed to check updates for {}: {}", id, error);
			(false, None)
		}
	}
}

pub(super) fn build_check_update_response(
	plugin_id: String,
	current_version: String,
	latest_version: Option<String>,
) -> CCPluginCheckUpdateResponse {
	CCPluginCheckUpdateResponse {
		plugin_id,
		update_available: latest_version.is_some(),
		current_version,
		latest_version,
		changelog: None,
	}
}

impl From<&aghub_plugins::claude::ClaudePluginInfo> for CCPluginResponse {
	fn from(p: &aghub_plugins::claude::ClaudePluginInfo) -> Self {
		Self {
			id: p.id.to_string(),
			name: p.display_name.clone(),
			version: p.version.clone(),
			description: p.description.clone(),
			enabled: p.enabled,
			source: p.source.to_string(),
			install_path: sanitize_path_home(&p.install_path),
			has_skills: p.has_skills(),
			has_hooks: p.has_hooks(),
			has_mcp: p.has_mcp(),
			author: p.author.as_ref().map(|a| CCPluginAuthorResponse {
				name: a.name.clone(),
				email: a.email.clone(),
				url: a.url.clone(),
			}),
			repository: p.effective_repository(),
			license: p.license.clone(),
			keywords: p.keywords.clone(),
			scopes: p
				.scopes
				.iter()
				.map(|s| CCPluginScopeResponse {
					scope: s.scope.clone(),
					folder_path: sanitize_path_home(&s.install_path),
					version: s.version.clone(),
					installed_at: s.installed_at.clone(),
					updated_at: s.last_updated.clone(),
				})
				.collect(),
		}
	}
}
