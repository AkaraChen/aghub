use crate::dto::plugin::{
	CCPluginCheckUpdateRequest, CCPluginCheckUpdateResponse,
	CCPluginInstallRequest, CCPluginInstallResponse, CCPluginListResponse,
	CCPluginOpenSkillInEditorRequest, CCPluginReinstallRequest,
	CCPluginReinstallResponse, CCPluginResponse, CCPluginUninstallRequest,
	CCPluginUninstallResponse, CCPluginUpdateRequest, CCPluginUpdateResponse,
};
use crate::error::{ApiError, ApiNoContent, ApiResult};
use log::error;
use rocket::http::Status;
use rocket::response::status::NoContent;
use rocket::serde::json::Json;
use std::fmt::Display;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::shared::{
	build_plugin_response, get_plugin, load_manager_and_plugin,
	load_plugin_installer, load_plugin_manager, parse_install_scope,
	parse_plugin_id, resolve_plugin_scope, resolve_plugin_update,
	try_load_plugin_installer,
};

fn internal_plugin_error(
	action: &str,
	plugin_id: &str,
	error: &impl Display,
) -> ApiError {
	error!("Failed to {action} plugin {plugin_id}: {error}");
	ApiError::internal(format!("Failed to {action} plugin"))
}

fn bad_request_plugin_error(
	action: &str,
	plugin_id: &str,
	code: &'static str,
	error: &impl Display,
) -> ApiError {
	error!("Failed to {action} plugin {plugin_id}: {error}");
	ApiError::new(
		Status::BadRequest,
		format!("Failed to {action} plugin"),
		code,
	)
}

#[get("/plugins")]
pub fn list_plugins() -> ApiResult<CCPluginListResponse> {
	let manager = load_plugin_manager()?;
	let installer = try_load_plugin_installer();
	let mut plugins: Vec<CCPluginResponse> = manager
		.list_plugins()
		.iter()
		.map(|plugin| build_plugin_response(plugin, installer.as_ref()))
		.collect();

	plugins.sort_by(|a, b| a.name.cmp(&b.name));
	Ok(Json(CCPluginListResponse { plugins }))
}

fn enable_plugin_inner(plugin_id: &str) -> ApiResult<CCPluginResponse> {
	let id = parse_plugin_id(plugin_id)?;
	let mut manager = load_plugin_manager()?;
	let installer = try_load_plugin_installer();
	manager
		.enable(&id)
		.map_err(|error| internal_plugin_error("enable", plugin_id, &error))?;
	let plugin = get_plugin(&manager, &id)?;
	Ok(Json(build_plugin_response(&plugin, installer.as_ref())))
}

#[post("/plugins/enable?<plugin_id>")]
pub fn enable_plugin(plugin_id: &str) -> ApiResult<CCPluginResponse> {
	enable_plugin_inner(plugin_id)
}

#[post("/plugins/<plugin_id>/enable")]
pub fn enable_plugin_legacy(plugin_id: &str) -> ApiResult<CCPluginResponse> {
	enable_plugin_inner(plugin_id)
}

fn disable_plugin_inner(plugin_id: &str) -> ApiResult<CCPluginResponse> {
	let id = parse_plugin_id(plugin_id)?;
	let mut manager = load_plugin_manager()?;
	let installer = try_load_plugin_installer();
	manager
		.disable(&id)
		.map_err(|error| internal_plugin_error("disable", plugin_id, &error))?;
	let plugin = get_plugin(&manager, &id)?;
	Ok(Json(build_plugin_response(&plugin, installer.as_ref())))
}

#[post("/plugins/disable?<plugin_id>")]
pub fn disable_plugin(plugin_id: &str) -> ApiResult<CCPluginResponse> {
	disable_plugin_inner(plugin_id)
}

#[post("/plugins/<plugin_id>/disable")]
pub fn disable_plugin_legacy(plugin_id: &str) -> ApiResult<CCPluginResponse> {
	disable_plugin_inner(plugin_id)
}

#[post("/plugins/install", data = "<body>")]
pub async fn install_plugin(
	body: Json<CCPluginInstallRequest>,
) -> ApiResult<CCPluginInstallResponse> {
	let req = body.into_inner();
	let scope = parse_install_scope(&req.scope)?;
	let plugin_id = parse_plugin_id(&req.plugin_id)?;
	let installer = load_plugin_installer()?;

	match installer.install(&plugin_id, scope).await {
		Ok(info) => Ok(Json(CCPluginInstallResponse {
			success: true,
			message: format!(
				"Plugin '{}' installed successfully (version: {})",
				req.plugin_id, info.version
			),
		})),
		Err(e) => {
			if e.downcast_ref::<aghub_plugins::errors::PluginError>()
				.is_some_and(|pe| {
					matches!(
						pe,
						aghub_plugins::errors::PluginError::AlreadyInstalled { .. }
					)
				}) {
				return Ok(Json(CCPluginInstallResponse {
					success: true,
					message: "Plugin is already installed".to_string(),
				}));
			}
			Err(bad_request_plugin_error(
				"install",
				&req.plugin_id,
				"PLUGIN_INSTALL_FAILED",
				&e,
			))
		}
	}
}

#[post("/plugins/uninstall", data = "<body>")]
pub async fn uninstall_plugin(
	body: Json<CCPluginUninstallRequest>,
) -> ApiResult<CCPluginUninstallResponse> {
	let req = body.into_inner();
	let scope = parse_install_scope(&req.scope)?;
	let plugin_id = parse_plugin_id(&req.plugin_id)?;
	let installer = load_plugin_installer()?;

	match installer.uninstall(&plugin_id, scope, req.keep_data).await {
		Ok(()) => Ok(Json(CCPluginUninstallResponse {
			success: true,
			message: format!(
				"Plugin '{}' uninstalled successfully",
				req.plugin_id
			),
		})),
		Err(error) => Err(bad_request_plugin_error(
			"uninstall",
			&req.plugin_id,
			"PLUGIN_UNINSTALL_FAILED",
			&error,
		)),
	}
}

#[post("/plugins/update", data = "<body>")]
pub async fn update_plugin(
	body: Json<CCPluginUpdateRequest>,
) -> ApiResult<CCPluginUpdateResponse> {
	let req = body.into_inner();
	let scope = parse_install_scope(&req.scope)?;
	let plugin_id = parse_plugin_id(&req.plugin_id)?;
	let installer = load_plugin_installer()?;

	match installer.update(&plugin_id, scope).await {
		Ok(info) => Ok(Json(CCPluginUpdateResponse {
			success: true,
			message: format!(
				"Plugin '{}' updated successfully (version: {})",
				req.plugin_id, info.version
			),
		})),
		Err(e) => {
			if e.downcast_ref::<aghub_plugins::errors::PluginError>()
				.is_some_and(|pe| {
					matches!(
						pe,
						aghub_plugins::errors::PluginError::AlreadyUpToDate { .. }
					)
				}) {
				return Ok(Json(CCPluginUpdateResponse {
					success: true,
					message: "Plugin is already up to date".to_string(),
				}));
			}
			Err(bad_request_plugin_error(
				"update",
				&req.plugin_id,
				"PLUGIN_UPDATE_FAILED",
				&e,
			))
		}
	}
}

#[post("/plugins/reinstall", data = "<body>")]
pub async fn reinstall_plugin(
	body: Json<CCPluginReinstallRequest>,
) -> ApiResult<CCPluginReinstallResponse> {
	let req = body.into_inner();
	let scope = parse_install_scope(&req.scope)?;
	let plugin_id = parse_plugin_id(&req.plugin_id)?;
	let installer = load_plugin_installer()?;
	installer
		.uninstall(&plugin_id, scope, req.keep_data)
		.await
		.map_err(|error| {
			bad_request_plugin_error(
				"uninstall",
				&req.plugin_id,
				"PLUGIN_UNINSTALL_FAILED",
				&error,
			)
		})?;

	match installer.install(&plugin_id, scope).await {
		Ok(info) => Ok(Json(CCPluginReinstallResponse {
			success: true,
			message: format!(
				"Plugin '{}' reinstalled successfully (version: {})",
				req.plugin_id, info.version
			),
		})),
		Err(error) => Err(bad_request_plugin_error(
			"reinstall",
			&req.plugin_id,
			"PLUGIN_REINSTALL_FAILED",
			&error,
		)),
	}
}

#[post("/plugins/check-update", data = "<body>")]
pub async fn check_plugin_update(
	body: Json<CCPluginCheckUpdateRequest>,
) -> ApiResult<CCPluginCheckUpdateResponse> {
	let req = body.into_inner();
	let id = parse_plugin_id(&req.plugin_id)?;
	let (_, plugin) = load_manager_and_plugin(&id)?;
	let scope_info = resolve_plugin_scope(&plugin, req.scope.as_deref())?;
	let current_version = scope_info
		.map(|scope| scope.version.as_str())
		.unwrap_or(plugin.version.as_str());
	let current_commit = scope_info
		.and_then(|scope| scope.git_commit_sha.as_deref())
		.or_else(|| {
			(!plugin.commit_hash.is_empty())
				.then_some(plugin.commit_hash.as_str())
		});
	let latest_version =
		resolve_plugin_update(&id, current_version, current_commit).await?;

	Ok(Json(CCPluginCheckUpdateResponse {
		plugin_id: req.plugin_id,
		update_available: latest_version.is_some(),
		current_version: current_version.to_string(),
		latest_version,
		changelog: None,
	}))
}

fn open_plugin_folder_inner(
	plugin_id: &str,
	scope: Option<&str>,
) -> ApiNoContent {
	let id = parse_plugin_id(plugin_id)?;
	let (_, plugin) = load_manager_and_plugin(&id)?;
	let install_path = resolve_plugin_scope(&plugin, scope)?
		.map(|item| item.install_path.clone())
		.unwrap_or_else(|| plugin.install_path.clone());

	open::that(install_path).map_err(|error| {
		error!("Failed to open plugin folder {plugin_id}: {error}");
		ApiError::internal("Failed to open plugin folder")
	})?;

	Ok(NoContent)
}

fn plugin_skill_dirs_for_scope(
	plugin: &aghub_plugins::claude::ClaudePluginInfo,
	install_path: &Path,
) -> Vec<PathBuf> {
	let mut paths = vec![
		install_path.join("skills"),
		install_path.join(".claude/skills"),
	];

	if let Ok(Some(manifest)) = plugin.read_manifest() {
		if let Some(skills_paths) = manifest.skills {
			for skills_path in skills_paths.iter() {
				paths.push(install_path.join(skills_path));
			}
		}
	}

	paths
}

fn resolve_plugin_skill_path(
	plugin: &aghub_plugins::claude::ClaudePluginInfo,
	scope: &str,
	skill_name: &str,
) -> Result<PathBuf, ApiError> {
	let install_path = resolve_plugin_scope(plugin, Some(scope))?
		.map(|item| item.install_path.clone())
		.unwrap_or_else(|| plugin.install_path.clone());

	for skills_dir in plugin_skill_dirs_for_scope(plugin, &install_path) {
		if !skills_dir.is_dir() {
			continue;
		}

		if let Ok(entries) = std::fs::read_dir(&skills_dir) {
			for entry in entries.flatten() {
				let path = entry.path();
				if !path.is_dir() {
					continue;
				}

				let matches_name = entry
					.file_name()
					.to_str()
					.is_some_and(|value| value == skill_name);
				if !matches_name {
					continue;
				}

				let skill_file = path.join("SKILL.md");
				return Ok(if skill_file.is_file() {
					skill_file
				} else {
					path
				});
			}
		}
	}

	Err(ApiError::not_found(format!(
		"Skill '{}' not found in plugin '{}' for scope '{}'",
		skill_name, plugin.id, scope
	)))
}

fn open_plugin_skill_in_editor_inner(
	req: CCPluginOpenSkillInEditorRequest,
) -> ApiNoContent {
	let id = parse_plugin_id(&req.plugin_id)?;
	let (_, plugin) = load_manager_and_plugin(&id)?;
	let path = resolve_plugin_skill_path(&plugin, &req.scope, &req.skill_name)?;

	Command::new(req.editor.cli_command())
		.arg(&path)
		.spawn()
		.map_err(|error| {
			error!(
				"Failed to open plugin skill in editor {} {}: {}",
				req.plugin_id, req.skill_name, error
			);
			ApiError::internal("Failed to open plugin skill in editor")
		})?;

	Ok(NoContent)
}

#[post("/plugins/open-folder?<plugin_id>&<scope>")]
pub fn open_plugin_folder(
	plugin_id: &str,
	scope: Option<&str>,
) -> ApiNoContent {
	open_plugin_folder_inner(plugin_id, scope)
}

#[post("/plugins/<plugin_id>/open-folder?<scope>")]
pub fn open_plugin_folder_legacy(
	plugin_id: &str,
	scope: Option<&str>,
) -> ApiNoContent {
	open_plugin_folder_inner(plugin_id, scope)
}

#[post("/plugins/open-skill-in-editor", data = "<body>")]
pub fn open_plugin_skill_in_editor(
	body: Json<CCPluginOpenSkillInEditorRequest>,
) -> ApiNoContent {
	open_plugin_skill_in_editor_inner(body.into_inner())
}
