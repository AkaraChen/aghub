use crate::dto::plugin::{CCPluginConfigResponse, CCPluginUpdateConfigRequest};
use crate::error::ApiResult;
use rocket::serde::json::Json;

use super::shared::{load_manager_and_plugin, parse_plugin_id};

#[get("/plugins/<plugin_id>/config")]
pub fn get_plugin_config(
	plugin_id: String,
) -> ApiResult<CCPluginConfigResponse> {
	let id = parse_plugin_id(&plugin_id)?;
	let (manager, plugin) = load_manager_and_plugin(&id)?;
	let config = manager
		.get_plugin_config(&id)
		.and_then(|v| serde_json::to_string(v).ok());
	let schema = plugin
		.read_manifest()
		.ok()
		.flatten()
		.and_then(|m| m.user_config)
		.and_then(|s| serde_json::to_string(&s).ok());

	Ok(Json(CCPluginConfigResponse {
		plugin_id,
		config,
		schema,
	}))
}

#[post("/plugins/<plugin_id>/config", data = "<body>")]
pub fn update_plugin_config(
	plugin_id: String,
	body: Json<CCPluginUpdateConfigRequest>,
) -> ApiResult<CCPluginConfigResponse> {
	let id = parse_plugin_id(&plugin_id)?;
	let (mut manager, plugin) = load_manager_and_plugin(&id)?;
	let schema = plugin
		.read_manifest()
		.ok()
		.flatten()
		.and_then(|m| m.user_config)
		.and_then(|s| serde_json::to_string(&s).ok());
	let req = body.into_inner();
	let config: serde_json::Value =
		serde_json::from_str(&req.config).map_err(|e| {
			crate::error::ApiError::bad_request(format!(
				"Invalid JSON config: {e}"
			))
		})?;

	if !config.is_object() {
		return Err(crate::error::ApiError::bad_request(
			"Config must be a JSON object".to_string(),
		));
	}

	manager.set_plugin_config(&id, config).map_err(|e| {
		crate::error::ApiError::internal(format!(
			"Failed to save plugin config: {e}"
		))
	})?;

	let config = manager
		.get_plugin_config(&id)
		.and_then(|v| serde_json::to_string(v).ok());

	Ok(Json(CCPluginConfigResponse {
		plugin_id,
		config,
		schema,
	}))
}

#[delete("/plugins/<plugin_id>/config")]
pub fn delete_plugin_config(
	plugin_id: String,
) -> ApiResult<CCPluginConfigResponse> {
	let id = parse_plugin_id(&plugin_id)?;
	let (mut manager, plugin) = load_manager_and_plugin(&id)?;
	let schema = plugin
		.read_manifest()
		.ok()
		.flatten()
		.and_then(|m| m.user_config)
		.and_then(|s| serde_json::to_string(&s).ok());

	manager.remove_plugin_config(&id).map_err(|e| {
		crate::error::ApiError::internal(format!(
			"Failed to remove plugin config: {e}"
		))
	})?;

	Ok(Json(CCPluginConfigResponse {
		plugin_id,
		config: None,
		schema,
	}))
}
