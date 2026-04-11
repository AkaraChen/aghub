use crate::dto::plugin::{
	CCPluginAuthorResponse, CCPluginCheckUpdateResponse, CCPluginResponse,
	CCPluginScopeResponse, CCPluginSourceInfoResponse,
};
use crate::error::ApiError;
use aghub_plugins::claude::settings::InstallScope;
use aghub_plugins::claude::{ClaudePluginInfo, ClaudePluginManager};
use aghub_plugins::installer::PluginInstaller;
use aghub_plugins::PluginId;
use log::warn;
use reqwest::Url;
use std::path::{Component, Path, PathBuf};

const OFFICIAL_MARKETPLACE_URL: &str =
	"https://github.com/anthropics/claude-plugins-official";

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

pub(super) fn try_load_plugin_installer() -> Option<PluginInstaller> {
	match PluginInstaller::new() {
		Ok(installer) => Some(installer),
		Err(error) => {
			warn!("Failed to create plugin installer: {}", error);
			None
		}
	}
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

fn normalize_source_url(plugin: &ClaudePluginInfo) -> Option<String> {
	let reference = plugin.effective_repository()?.trim().to_string();
	if reference.is_empty() {
		return None;
	}

	let normalized = reference
		.trim_end_matches('/')
		.trim_end_matches(".git")
		.to_string();

	if normalized.starts_with("https://") || normalized.starts_with("http://") {
		return Some(normalized);
	}

	if normalized.starts_with("git@github.com:") {
		return Some(
			normalized.replace("git@github.com:", "https://github.com/"),
		);
	}

	if normalized.contains('/') && !normalized.contains("://") {
		return Some(format!("https://github.com/{normalized}"));
	}

	None
}

fn build_source_info(
	plugin: &ClaudePluginInfo,
	installer: Option<&PluginInstaller>,
) -> CCPluginSourceInfoResponse {
	let url = normalize_source_url(plugin).or_else(|| {
		match plugin.id.source.as_str() {
			"claude-plugins-official" => {
				Some(OFFICIAL_MARKETPLACE_URL.to_string())
			}
			source
				if source.starts_with("http://")
					|| source.starts_with("https://") =>
			{
				Some(source.to_string())
			}
			_ => None,
		}
	});

	let (label, is_github) = url
		.as_deref()
		.and_then(|value| Url::parse(value).ok())
		.map(|url| {
			let is_github = url.host_str() == Some("github.com");
			let label = if is_github {
				let mut segments = url.path_segments().into_iter().flatten();
				match (segments.next(), segments.next()) {
					(Some(owner), Some(repo))
						if !owner.is_empty() && !repo.is_empty() =>
					{
						format!("{owner}/{repo}")
					}
					_ => plugin.source.to_string(),
				}
			} else {
				url.host_str()
					.map(|host| host.trim_start_matches("www.").to_string())
					.unwrap_or_else(|| plugin.source.to_string())
			};
			(label, is_github)
		})
		.unwrap_or_else(|| (plugin.source.to_string(), false));

	CCPluginSourceInfoResponse {
		label,
		url,
		is_github,
		can_reinstall: installer
			.map(|value| value.can_reinstall(&plugin.id))
			.unwrap_or(false),
		can_check_updates: installer
			.map(|value| value.can_check_updates(&plugin.id))
			.unwrap_or(false),
	}
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
	let installer = match load_plugin_installer() {
		Ok(installer) => installer,
		Err(_) => {
			warn!("Failed to create plugin installer for {}", id);
			return (false, None);
		}
	};

	if !installer.can_check_updates(id) {
		return (false, None);
	}

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

pub(super) fn build_plugin_response(
	plugin: &ClaudePluginInfo,
	installer: Option<&PluginInstaller>,
) -> CCPluginResponse {
	CCPluginResponse {
		id: plugin.id.to_string(),
		name: plugin.display_name.clone(),
		version: plugin.version.clone(),
		description: plugin.description.clone(),
		enabled: plugin.enabled,
		source: plugin.source.to_string(),
		install_path: sanitize_path_home(&plugin.install_path),
		has_skills: plugin.has_skills(),
		has_hooks: plugin.has_hooks(),
		has_mcp: plugin.has_mcp(),
		author: plugin.author.as_ref().map(|a| CCPluginAuthorResponse {
			name: a.name.clone(),
			email: a.email.clone(),
			url: a.url.clone(),
		}),
		repository: plugin.effective_repository(),
		license: plugin.license.clone(),
		keywords: plugin.keywords.clone(),
		source_info: build_source_info(plugin, installer),
		scopes: plugin
			.scopes
			.iter()
			.map(|scope| CCPluginScopeResponse {
				scope: scope.scope.clone(),
				folder_path: sanitize_path_home(&scope.install_path),
				version: scope.version.clone(),
				installed_at: scope.installed_at.clone(),
				updated_at: scope.last_updated.clone(),
			})
			.collect(),
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
