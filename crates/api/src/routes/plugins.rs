use crate::dto::plugin::{PluginListResponse, PluginResponse};
use crate::error::ApiResult;
use aghub_plugins::claude::ClaudePluginManager;
use rocket::serde::json::Json;
use rocket::Route;

pub fn routes() -> Vec<Route> {
    routes![
        list_plugins,
        enable_plugin,
        disable_plugin,
    ]
}

#[get("/plugins")]
pub fn list_plugins() -> ApiResult<PluginListResponse> {
    let manager = ClaudePluginManager::new()
        .map_err(|e| crate::error::ApiError::internal(format!("Failed to load plugin manager: {e}")))?;

    let plugins: Vec<PluginResponse> = manager
        .list_plugins()
        .iter()
        .map(|p| PluginResponse {
            id: p.id.to_string(),
            name: p.display_name.clone(),
            version: p.version.clone(),
            description: p.description.clone(),
            enabled: p.enabled,
            source: p.source.to_string(),
            install_path: p.install_path.display().to_string(),
            has_skills: p.has_skills(),
            has_hooks: p.install_path.join("hooks").exists(),
            has_mcp: p.install_path.join(".mcp.json").exists(),
        })
        .collect();

    Ok(Json(PluginListResponse { plugins }))
}

#[post("/plugins/<plugin_id>/enable")]
pub fn enable_plugin(
    plugin_id: String,
) -> ApiResult<PluginResponse> {
    use aghub_plugins::PluginId;

    let id = PluginId::parse(&plugin_id)
        .map_err(|e| crate::error::ApiError::bad_request(format!("Invalid plugin ID: {e}")))?;

    let mut manager = ClaudePluginManager::new()
        .map_err(|e| crate::error::ApiError::internal(format!("Failed to load plugin manager: {e}")))?;

    manager.enable(&id)
        .map_err(|e| crate::error::ApiError::internal(format!("Failed to enable plugin: {e}")))?;

    // Find the plugin to return its updated state
    let plugin = manager.list_plugins()
        .iter()
        .find(|p| p.id.to_string() == plugin_id)
        .cloned()
        .ok_or_else(|| crate::error::ApiError::not_found(format!("Plugin '{}' not found", plugin_id)))?;

    // Pre-compute values that need borrow before moving fields
    let has_skills = plugin.has_skills();
    let has_hooks = plugin.install_path.join("hooks").exists();
    let has_mcp = plugin.install_path.join(".mcp.json").exists();
    let install_path = plugin.install_path.display().to_string();
    let source = plugin.source.to_string();

    Ok(Json(PluginResponse {
        id: plugin.id.to_string(),
        name: plugin.display_name,
        version: plugin.version,
        description: plugin.description,
        enabled: plugin.enabled,
        source,
        install_path,
        has_skills,
        has_hooks,
        has_mcp,
    }))
}

#[post("/plugins/<plugin_id>/disable")]
pub fn disable_plugin(
    plugin_id: String,
) -> ApiResult<PluginResponse> {
    use aghub_plugins::PluginId;

    let id = PluginId::parse(&plugin_id)
        .map_err(|e| crate::error::ApiError::bad_request(format!("Invalid plugin ID: {e}")))?;

    let mut manager = ClaudePluginManager::new()
        .map_err(|e| crate::error::ApiError::internal(format!("Failed to load plugin manager: {e}")))?;

    manager.disable(&id)
        .map_err(|e| crate::error::ApiError::internal(format!("Failed to disable plugin: {e}")))?;

    // Find the plugin to return its updated state
    let plugin = manager.list_plugins()
        .iter()
        .find(|p| p.id.to_string() == plugin_id)
        .cloned()
        .ok_or_else(|| crate::error::ApiError::not_found(format!("Plugin '{}' not found", plugin_id)))?;

    // Pre-compute values that need borrow before moving fields
    let has_skills = plugin.has_skills();
    let has_hooks = plugin.install_path.join("hooks").exists();
    let has_mcp = plugin.install_path.join(".mcp.json").exists();
    let install_path = plugin.install_path.display().to_string();
    let source = plugin.source.to_string();

    Ok(Json(PluginResponse {
        id: plugin.id.to_string(),
        name: plugin.display_name,
        version: plugin.version,
        description: plugin.description,
        enabled: plugin.enabled,
        source,
        install_path,
        has_skills,
        has_hooks,
        has_mcp,
    }))
}
