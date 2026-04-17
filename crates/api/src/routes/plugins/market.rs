use crate::dto::plugin::CCPluginMarketResponse;
use crate::error::{ApiError, ApiResult};
use log::error;
use rocket::http::Status;
use rocket::serde::json::Json;

use super::shared::{load_plugin_installer, load_plugin_manager};

#[post("/plugins-market/update")]
pub async fn update_marketplace() -> ApiResult<serde_json::Value> {
	let installer = load_plugin_installer()?;
	let updated = installer.update_marketplaces().await.map_err(|error| {
		error!("Failed to update plugin marketplaces: {}", error);
		ApiError::new(
			Status::BadGateway,
			error.to_string(),
			"PLUGIN_MARKET_UPDATE_FAILED",
		)
	})?;

	Ok(Json(serde_json::json!({
		"success": true,
		"message": format!("Updated {} marketplace(s)", updated.len())
	})))
}

#[get("/plugins-market")]
pub async fn list_plugin_market() -> ApiResult<Vec<CCPluginMarketResponse>> {
	use aghub_plugins::discovery::{DiscoveryConfig, UnifiedPluginRegistry};

	let config = DiscoveryConfig::default();
	let registry =
		UnifiedPluginRegistry::new_async(&config)
			.await
			.map_err(|e| {
				error!("Failed to create plugin registry: {}", e);
				ApiError::internal("Failed to create plugin registry")
			})?;
	let plugins = registry.all_plugins();
	log::info!("Plugin market: discovered {} plugins", plugins.len());
	let installed_manager = load_plugin_manager().ok();

	let response: Vec<CCPluginMarketResponse> = plugins
		.into_iter()
		.map(|p| {
			let installed_scopes = if p.installed {
				let plugin_id = aghub_plugins::PluginId::parse(&p.id).ok();
				if let (Some(manager), Some(id)) =
					(&installed_manager, &plugin_id)
				{
					manager
						.get_plugin(id)
						.map(|cp| {
							cp.scopes
								.iter()
								.map(|s| s.scope.to_string())
								.collect()
						})
						.unwrap_or_default()
				} else {
					vec![]
				}
			} else {
				vec![]
			};

			CCPluginMarketResponse {
				id: p.id.clone(),
				name: p.name.clone(),
				description: p.description.clone(),
				version: p.display_version().into_owned(),
				author: p.display_author().unwrap_or_default(),
				github_url: p.github_url().unwrap_or_default(),
				installs: p.install_count.unwrap_or(0) as i64,
				installed: p.installed,
				installed_scopes,
				enabled: p.enabled,
				category: p.category.clone(),
				has_mcp: p.has_mcp,
				has_skills: p.has_skills,
				has_hooks: p.has_hooks,
			}
		})
		.collect();

	Ok(Json(response))
}
