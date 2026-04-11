use crate::dto::plugin::{
	CCPluginCheckUpdateRequest, CCPluginCheckUpdateResponse,
	CCPluginInstallRequest, CCPluginInstallResponse, CCPluginListResponse,
	CCPluginReinstallRequest, CCPluginReinstallResponse, CCPluginResponse,
	CCPluginUninstallRequest, CCPluginUninstallResponse, CCPluginUpdateRequest,
	CCPluginUpdateResponse,
};
use crate::error::{ApiError, ApiNoContent, ApiResult};
use rocket::http::Status;
use rocket::response::status::NoContent;
use rocket::serde::json::Json;

use super::shared::{
	build_check_update_response, build_plugin_response, get_plugin,
	load_manager_and_plugin, load_plugin_installer, load_plugin_manager,
	parse_install_scope, parse_plugin_id, resolve_plugin_folder,
	resolve_plugin_scope, resolve_plugin_update, try_load_plugin_installer,
};

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

#[post("/plugins/<plugin_id>/enable")]
pub fn enable_plugin(plugin_id: &str) -> ApiResult<CCPluginResponse> {
	let id = parse_plugin_id(plugin_id)?;
	let mut manager = load_plugin_manager()?;
	let installer = try_load_plugin_installer();
	manager.enable(&id).map_err(|e| {
		ApiError::internal(format!("Failed to enable plugin: {e}"))
	})?;
	let plugin = get_plugin(&manager, &id)?;
	Ok(Json(build_plugin_response(&plugin, installer.as_ref())))
}

#[post("/plugins/<plugin_id>/disable")]
pub fn disable_plugin(plugin_id: &str) -> ApiResult<CCPluginResponse> {
	let id = parse_plugin_id(plugin_id)?;
	let mut manager = load_plugin_manager()?;
	let installer = try_load_plugin_installer();
	manager.disable(&id).map_err(|e| {
		ApiError::internal(format!("Failed to disable plugin: {e}"))
	})?;
	let plugin = get_plugin(&manager, &id)?;
	Ok(Json(build_plugin_response(&plugin, installer.as_ref())))
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
			let error_str = e.to_string();
			if error_str.contains("already installed") {
				return Ok(Json(CCPluginInstallResponse {
					success: true,
					message: "Plugin is already installed".to_string(),
				}));
			}
			Err(ApiError::new(
				Status::BadRequest,
				format!("Failed to install plugin: {error_str}"),
				"PLUGIN_INSTALL_FAILED",
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
		Err(e) => Err(ApiError::new(
			Status::BadRequest,
			format!("Failed to uninstall plugin: {e}"),
			"PLUGIN_UNINSTALL_FAILED",
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
			let error_str = e.to_string();
			if error_str.contains("already up to date") {
				return Ok(Json(CCPluginUpdateResponse {
					success: true,
					message: "Plugin is already up to date".to_string(),
				}));
			}
			Err(ApiError::new(
				Status::BadRequest,
				format!("Failed to update plugin: {error_str}"),
				"PLUGIN_UPDATE_FAILED",
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
			ApiError::new(
				Status::BadRequest,
				format!("Failed to uninstall plugin: {error}"),
				"PLUGIN_UNINSTALL_FAILED",
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
		Err(e) => Err(ApiError::new(
			Status::BadRequest,
			format!("Failed to reinstall plugin: {e}"),
			"PLUGIN_REINSTALL_FAILED",
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
	let (_, latest_version) =
		resolve_plugin_update(&id, current_version, current_commit).await;

	Ok(Json(build_check_update_response(
		req.plugin_id,
		current_version.to_string(),
		latest_version,
	)))
}

#[post("/plugins/<plugin_id>/open-folder?<scope>")]
pub fn open_plugin_folder(
	plugin_id: &str,
	scope: Option<&str>,
) -> ApiNoContent {
	let id = parse_plugin_id(plugin_id)?;
	let (_, plugin) = load_manager_and_plugin(&id)?;
	let install_path = resolve_plugin_folder(&plugin, scope)?;

	open::that(install_path).map_err(|error| {
		ApiError::internal(format!("Failed to open plugin folder: {error}"))
	})?;

	Ok(NoContent)
}
