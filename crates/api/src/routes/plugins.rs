use crate::dto::plugin::{
	CheckUpdateRequest, CheckUpdateResponse, HookActionResponse,
	HookEventResponse, HookMatcherResponse, HooksManifestResponse,
	InstallPluginRequest, InstallPluginResponse, MarketPluginResponse,
	McpConfigResponse, McpServerResponse, PluginAuthorResponse,
	PluginConfigResponse, PluginDetailResponse, PluginListResponse,
	PluginManifestResponse, PluginResponse, PluginScopeResponse,
	ReinstallPluginRequest, ReinstallPluginResponse, UninstallPluginRequest,
	UninstallPluginResponse, UpdatePluginConfigRequest, UpdatePluginRequest,
	UpdatePluginResponse,
};
use crate::error::{ApiError, ApiResult};
use aghub_plugins::claude::ClaudePluginManager;
use rocket::http::Status;
use rocket::serde::json::Json;
use rocket::Route;

impl From<&aghub_plugins::claude::ClaudePluginInfo> for PluginResponse {
	fn from(p: &aghub_plugins::claude::ClaudePluginInfo) -> Self {
		Self {
			id: p.id.to_string(),
			name: p.display_name.clone(),
			version: p.version.clone(),
			description: p.description.clone(),
			enabled: p.enabled,
			source: p.source.to_string(),
			install_path: p.install_path.display().to_string(),
			has_skills: p.has_skills(),
			has_hooks: p.has_hooks(),
			has_mcp: p.has_mcp(),
			author: p.author.as_ref().map(|a| PluginAuthorResponse {
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
				.map(|s| PluginScopeResponse {
					scope: s.scope.clone(),
					install_path: s.install_path.display().to_string(),
					version: s.version.clone(),
					installed_at: s.installed_at.clone(),
					last_updated: s.last_updated.clone(),
				})
				.collect(),
		}
	}
}

pub fn routes() -> Vec<Route> {
	routes![
		list_plugins,
		get_plugin_detail,
		enable_plugin,
		disable_plugin,
		install_plugin,
		uninstall_plugin,
		reinstall_plugin,
		update_plugin,
		check_plugin_update,
		get_plugin_config,
		update_plugin_config,
		delete_plugin_config,
		list_plugin_market,
	]
}

#[get("/plugins")]
pub fn list_plugins() -> ApiResult<PluginListResponse> {
	let manager = ClaudePluginManager::new().map_err(|e| {
		crate::error::ApiError::internal(format!(
			"Failed to load plugin manager: {e}"
		))
	})?;

	let mut plugins: Vec<PluginResponse> = manager
		.list_plugins()
		.iter()
		.map(PluginResponse::from)
		.collect();

	// Sort by name for stable ordering
	plugins.sort_by(|a, b| a.name.cmp(&b.name));

	Ok(Json(PluginListResponse { plugins }))
}

#[post("/plugins/<plugin_id>/enable")]
pub fn enable_plugin(plugin_id: String) -> ApiResult<PluginResponse> {
	use aghub_plugins::PluginId;

	let id = PluginId::parse(&plugin_id).map_err(|e| {
		crate::error::ApiError::bad_request(format!("Invalid plugin ID: {e}"))
	})?;

	let mut manager = ClaudePluginManager::new().map_err(|e| {
		crate::error::ApiError::internal(format!(
			"Failed to load plugin manager: {e}"
		))
	})?;

	manager.enable(&id).map_err(|e| {
		crate::error::ApiError::internal(format!(
			"Failed to enable plugin: {e}"
		))
	})?;

	// Find the plugin to return its updated state
	let plugin = manager
		.list_plugins()
		.iter()
		.find(|p| p.id.to_string() == plugin_id)
		.cloned()
		.ok_or_else(|| {
			crate::error::ApiError::not_found(format!(
				"Plugin '{}' not found",
				plugin_id
			))
		})?;

	Ok(Json(PluginResponse::from(&plugin)))
}

#[post("/plugins/<plugin_id>/disable")]
pub fn disable_plugin(plugin_id: String) -> ApiResult<PluginResponse> {
	use aghub_plugins::PluginId;

	let id = PluginId::parse(&plugin_id).map_err(|e| {
		crate::error::ApiError::bad_request(format!("Invalid plugin ID: {e}"))
	})?;

	let mut manager = ClaudePluginManager::new().map_err(|e| {
		crate::error::ApiError::internal(format!(
			"Failed to load plugin manager: {e}"
		))
	})?;

	manager.disable(&id).map_err(|e| {
		crate::error::ApiError::internal(format!(
			"Failed to disable plugin: {e}"
		))
	})?;

	// Find the plugin to return its updated state
	let plugin = manager
		.list_plugins()
		.iter()
		.find(|p| p.id.to_string() == plugin_id)
		.cloned()
		.ok_or_else(|| {
			crate::error::ApiError::not_found(format!(
				"Plugin '{}' not found",
				plugin_id
			))
		})?;

	Ok(Json(PluginResponse::from(&plugin)))
}

#[post("/plugins/install", data = "<body>")]
pub async fn install_plugin(
	body: Json<InstallPluginRequest>,
) -> ApiResult<InstallPluginResponse> {
	use aghub_plugins::claude::settings::InstallScope;
	use aghub_plugins::installer::PluginInstaller;
	use aghub_plugins::PluginId;

	let req = body.into_inner();

	// Validate scope
	if !matches!(req.scope.as_str(), "user" | "project" | "local") {
		return Err(ApiError::bad_request(format!(
			"Invalid scope '{}'. Use 'user', 'project', or 'local'",
			req.scope
		)));
	}

	// Parse plugin ID
	let plugin_id = PluginId::parse(&req.plugin_id).map_err(|e| {
		ApiError::bad_request(format!("Invalid plugin ID: {e}"))
	})?;

	let scope = InstallScope::from(req.scope.as_str());

	// Install using standalone installer
	let installer = PluginInstaller::new().map_err(|e| {
		ApiError::internal(format!("Failed to create plugin installer: {e}"))
	})?;

	match installer.install(&plugin_id, scope).await {
		Ok(info) => Ok(Json(InstallPluginResponse {
			success: true,
			message: format!(
				"Plugin '{}' installed successfully (version: {})",
				req.plugin_id, info.version
			),
		})),
		Err(e) => {
			// Check if already installed
			let error_str = e.to_string();
			if error_str.contains("already installed") {
				return Ok(Json(InstallPluginResponse {
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
	body: Json<UninstallPluginRequest>,
) -> ApiResult<UninstallPluginResponse> {
	use aghub_plugins::claude::settings::InstallScope;
	use aghub_plugins::installer::PluginInstaller;
	use aghub_plugins::PluginId;

	let req = body.into_inner();

	// Validate scope
	if !matches!(req.scope.as_str(), "user" | "project" | "local") {
		return Err(ApiError::bad_request(format!(
			"Invalid scope '{}'. Use 'user', 'project', or 'local'",
			req.scope
		)));
	}

	// Parse plugin ID
	let plugin_id = PluginId::parse(&req.plugin_id).map_err(|e| {
		ApiError::bad_request(format!("Invalid plugin ID: {e}"))
	})?;

	let scope = InstallScope::from(req.scope.as_str());

	// Uninstall using standalone installer
	let installer = PluginInstaller::new().map_err(|e| {
		ApiError::internal(format!("Failed to create plugin installer: {e}"))
	})?;

	match installer.uninstall(&plugin_id, scope, req.keep_data).await {
		Ok(()) => Ok(Json(UninstallPluginResponse {
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
	body: Json<UpdatePluginRequest>,
) -> ApiResult<UpdatePluginResponse> {
	use aghub_plugins::claude::settings::InstallScope;
	use aghub_plugins::installer::PluginInstaller;
	use aghub_plugins::PluginId;

	let req = body.into_inner();

	// Validate scope (note: "managed" scope is not supported by our installer)
	if !matches!(req.scope.as_str(), "user" | "project" | "local") {
		return Err(ApiError::bad_request(format!(
			"Invalid scope '{}'. Use 'user', 'project', or 'local'",
			req.scope
		)));
	}

	// Parse plugin ID
	let plugin_id = PluginId::parse(&req.plugin_id).map_err(|e| {
		ApiError::bad_request(format!("Invalid plugin ID: {e}"))
	})?;

	let scope = InstallScope::from(req.scope.as_str());

	// Update using standalone installer
	let installer = PluginInstaller::new().map_err(|e| {
		ApiError::internal(format!("Failed to create plugin installer: {e}"))
	})?;

	match installer.update(&plugin_id, scope).await {
		Ok(info) => Ok(Json(UpdatePluginResponse {
			success: true,
			message: format!(
				"Plugin '{}' updated successfully (version: {})",
				req.plugin_id, info.version
			),
		})),
		Err(e) => {
			let error_str = e.to_string();
			if error_str.contains("already up to date") {
				return Ok(Json(UpdatePluginResponse {
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

/// Get detailed plugin information including manifest, hooks, and MCP config
#[get("/plugins/<plugin_id>")]
pub fn get_plugin_detail(plugin_id: &str) -> ApiResult<PluginDetailResponse> {
	use aghub_plugins::PluginId;

	let id = PluginId::parse(plugin_id).map_err(|e| {
		crate::error::ApiError::bad_request(format!("Invalid plugin ID: {e}"))
	})?;

	let manager = ClaudePluginManager::new().map_err(|e| {
		crate::error::ApiError::internal(format!(
			"Failed to load plugin manager: {e}"
		))
	})?;

	let plugin = manager.get_plugin(&id).ok_or_else(|| {
		crate::error::ApiError::not_found(format!(
			"Plugin '{}' not found",
			plugin_id
		))
	})?;

	// Read manifest
	let manifest = plugin.read_manifest().unwrap_or_else(|e| {
		log::warn!("Failed to read manifest for {}: {}", plugin.id, e);
		None
	});

	let manifest_response = manifest.map(|m| PluginManifestResponse {
		name: m.name,
		version: m.version,
		description: m.description,
		author: PluginAuthorResponse {
			name: m.author.name,
			email: m.author.email,
			url: m.author.url,
		},
		homepage: m.homepage,
		repository: m.repository,
		license: m.license,
		keywords: m.keywords,
		logo: m.logo,
		skills: m.skills,
		agents: m.agents,
		commands: m.commands,
	});

	// Read hooks
	let hooks = plugin.read_hooks().unwrap_or_else(|e| {
		eprintln!("Failed to read hooks for {}: {}", plugin.id, e);
		None
	});

	let hooks_response = hooks.map(|h| {
		let events: Vec<HookEventResponse> = h
			.hooks
			.into_iter()
			.map(|(event, matchers)| HookEventResponse {
				event,
				matchers: matchers
					.into_iter()
					.map(|m| HookMatcherResponse {
						matcher: m.matcher,
						hooks: m
							.hooks
							.into_iter()
							.map(|h| HookActionResponse {
								action_type: h.action_type,
								command: h.command,
								timeout: h.timeout,
							})
							.collect(),
					})
					.collect(),
			})
			.collect();
		HooksManifestResponse { hooks: events }
	});

	// Read MCP config
	let mcp_config = plugin.read_mcp_config().unwrap_or_else(|e| {
		eprintln!("Failed to read MCP config for {}: {}", plugin.id, e);
		None
	});

	let mcp_response = mcp_config.map(|c| {
		let servers: Vec<McpServerResponse> = c
			.mcp_servers
			.into_iter()
			.map(|(name, s)| McpServerResponse {
				name,
				transport_type: s.transport_type,
				command: s.command,
				args: s.args,
				url: s.url,
				env: s.env,
				headers: s.headers,
				note: s.note,
			})
			.collect();
		McpConfigResponse { servers }
	});

	let base_response = PluginResponse::from(plugin);

	let mut provided_skills = Vec::new();
	// Check skills/ directories from ALL scopes (all versions), not just primary
	for scope in &plugin.scopes {
		let install_path = std::path::PathBuf::from(&scope.install_path);
		let skill_dirs = [
			install_path.join("skills"),
			install_path.join(".claude/skills"),
		];
		for skills_dir in &skill_dirs {
			if skills_dir.exists() && skills_dir.is_dir() {
				if let Ok(entries) = std::fs::read_dir(skills_dir) {
					for entry in entries.flatten() {
						if entry.path().is_dir() {
							if let Ok(name) = entry.file_name().into_string() {
								if !provided_skills.contains(&name) {
									provided_skills.push(name);
								}
							}
						}
					}
				}
			}
		}
	}
	provided_skills.sort();

	Ok(Json(PluginDetailResponse {
		plugin: base_response,
		manifest: manifest_response,
		hooks: hooks_response,
		mcp_config: mcp_response,
		update_available: false, // TODO: implement update check
		latest_version: None,
		provided_skills,
	}))
}

/// Reinstall a plugin (uninstall then install)
#[post("/plugins/reinstall", data = "<body>")]
pub async fn reinstall_plugin(
	body: Json<ReinstallPluginRequest>,
) -> ApiResult<ReinstallPluginResponse> {
	use aghub_plugins::claude::settings::InstallScope;
	use aghub_plugins::installer::PluginInstaller;
	use aghub_plugins::PluginId;

	let req = body.into_inner();

	// Validate scope
	if !matches!(req.scope.as_str(), "user" | "project" | "local") {
		return Err(ApiError::bad_request(format!(
			"Invalid scope '{}'. Use 'user', 'project', or 'local'",
			req.scope
		)));
	}

	// Parse plugin ID
	let plugin_id = PluginId::parse(&req.plugin_id).map_err(|e| {
		ApiError::bad_request(format!("Invalid plugin ID: {e}"))
	})?;

	let scope = InstallScope::from(req.scope.as_str());

	// Create installer
	let installer = PluginInstaller::new().map_err(|e| {
		ApiError::internal(format!("Failed to create plugin installer: {e}"))
	})?;

	// Step 1: Uninstall the plugin (ignore "not found" errors)
	let uninstall_result =
		installer.uninstall(&plugin_id, scope, req.keep_data).await;
	if let Err(ref e) = uninstall_result {
		let error_str = e.to_string();
		if !error_str.contains("not found") && !error_str.contains("Plugin") {
			return Err(ApiError::new(
				Status::BadRequest,
				format!("Failed to uninstall plugin: {error_str}"),
				"PLUGIN_UNINSTALL_FAILED",
			));
		}
	}

	// Step 2: Install the plugin
	match installer.install(&plugin_id, scope).await {
		Ok(info) => Ok(Json(ReinstallPluginResponse {
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

/// Check for plugin updates
#[post("/plugins/check-update", data = "<body>")]
pub async fn check_plugin_update(
	body: Json<CheckUpdateRequest>,
) -> ApiResult<CheckUpdateResponse> {
	use aghub_plugins::installer::PluginInstaller;
	use aghub_plugins::PluginId;

	let req = body.into_inner();

	let id = PluginId::parse(&req.plugin_id).map_err(|e| {
		crate::error::ApiError::bad_request(format!("Invalid plugin ID: {e}"))
	})?;

	let manager = ClaudePluginManager::new().map_err(|e| {
		crate::error::ApiError::internal(format!(
			"Failed to load plugin manager: {e}"
		))
	})?;

	let plugin = manager.get_plugin(&id).ok_or_else(|| {
		crate::error::ApiError::not_found(format!(
			"Plugin '{}' not found",
			req.plugin_id
		))
	})?;

	// Check for updates using the installer
	let installer = PluginInstaller::new().map_err(|e| {
		crate::error::ApiError::internal(format!(
			"Failed to create plugin installer: {e}"
		))
	})?;

	match installer.check_update(&id).await {
		Ok(Some((latest_version, _))) => Ok(Json(CheckUpdateResponse {
			plugin_id: req.plugin_id,
			update_available: true,
			current_version: plugin.version.clone(),
			latest_version: Some(latest_version),
			changelog: None,
		})),
		Ok(None) => Ok(Json(CheckUpdateResponse {
			plugin_id: req.plugin_id,
			update_available: false,
			current_version: plugin.version.clone(),
			latest_version: None,
			changelog: None,
		})),
		Err(e) => {
			// If we can't check, return current state without error
			eprintln!("Failed to check for updates: {}", e);
			Ok(Json(CheckUpdateResponse {
				plugin_id: req.plugin_id,
				update_available: false,
				current_version: plugin.version.clone(),
				latest_version: None,
				changelog: None,
			}))
		}
	}
}

/// Get plugin user configuration
#[get("/plugins/<plugin_id>/config")]
pub fn get_plugin_config(plugin_id: String) -> ApiResult<PluginConfigResponse> {
	use aghub_plugins::PluginId;

	let id = PluginId::parse(&plugin_id).map_err(|e| {
		crate::error::ApiError::bad_request(format!("Invalid plugin ID: {e}"))
	})?;

	let manager = ClaudePluginManager::new().map_err(|e| {
		crate::error::ApiError::internal(format!(
			"Failed to load plugin manager: {e}"
		))
	})?;

	let plugin = manager.get_plugin(&id).ok_or_else(|| {
		crate::error::ApiError::not_found(format!(
			"Plugin '{}' not found",
			plugin_id
		))
	})?;

	// Get user config from settings and serialize to string
	let config = manager
		.get_plugin_config(&id)
		.and_then(|v| serde_json::to_string(v).ok());

	// Get config schema from manifest
	let schema = plugin
		.read_manifest()
		.ok()
		.flatten()
		.and_then(|m| m.user_config)
		.and_then(|s| serde_json::to_string(&s).ok());

	Ok(Json(PluginConfigResponse {
		plugin_id,
		config,
		schema,
	}))
}

/// Update plugin user configuration
#[post("/plugins/<plugin_id>/config", data = "<body>")]
pub fn update_plugin_config(
	plugin_id: String,
	body: Json<UpdatePluginConfigRequest>,
) -> ApiResult<PluginConfigResponse> {
	use aghub_plugins::PluginId;

	let id = PluginId::parse(&plugin_id).map_err(|e| {
		crate::error::ApiError::bad_request(format!("Invalid plugin ID: {e}"))
	})?;

	let mut manager = ClaudePluginManager::new().map_err(|e| {
		crate::error::ApiError::internal(format!(
			"Failed to load plugin manager: {e}"
		))
	})?;

	let plugin = manager.get_plugin(&id).ok_or_else(|| {
		crate::error::ApiError::not_found(format!(
			"Plugin '{}' not found",
			plugin_id
		))
	})?;

	// Get schema before mutable borrow
	let schema = plugin
		.read_manifest()
		.ok()
		.flatten()
		.and_then(|m| m.user_config)
		.and_then(|s| serde_json::to_string(&s).ok());

	let req = body.into_inner();

	// Parse config from string
	let config: serde_json::Value =
		serde_json::from_str(&req.config).map_err(|e| {
			crate::error::ApiError::bad_request(format!(
				"Invalid JSON config: {e}"
			))
		})?;

	// Validate that config is a valid JSON object
	if !config.is_object() {
		return Err(crate::error::ApiError::bad_request(
			"Config must be a JSON object".to_string(),
		));
	}

	// Save config
	manager.set_plugin_config(&id, config).map_err(|e| {
		crate::error::ApiError::internal(format!(
			"Failed to save plugin config: {e}"
		))
	})?;

	// Get updated config as string
	let config = manager
		.get_plugin_config(&id)
		.and_then(|v| serde_json::to_string(v).ok());

	Ok(Json(PluginConfigResponse {
		plugin_id,
		config,
		schema,
	}))
}

/// Delete plugin user configuration
#[delete("/plugins/<plugin_id>/config")]
pub fn delete_plugin_config(
	plugin_id: String,
) -> ApiResult<PluginConfigResponse> {
	use aghub_plugins::PluginId;

	let id = PluginId::parse(&plugin_id).map_err(|e| {
		crate::error::ApiError::bad_request(format!("Invalid plugin ID: {e}"))
	})?;

	let mut manager = ClaudePluginManager::new().map_err(|e| {
		crate::error::ApiError::internal(format!(
			"Failed to load plugin manager: {e}"
		))
	})?;

	let plugin = manager.get_plugin(&id).ok_or_else(|| {
		crate::error::ApiError::not_found(format!(
			"Plugin '{}' not found",
			plugin_id
		))
	})?;

	// Get schema before mutable borrow
	let schema = plugin
		.read_manifest()
		.ok()
		.flatten()
		.and_then(|m| m.user_config)
		.and_then(|s| serde_json::to_string(&s).ok());

	// Remove config
	manager.remove_plugin_config(&id).map_err(|e| {
		crate::error::ApiError::internal(format!(
			"Failed to remove plugin config: {e}"
		))
	})?;

	Ok(Json(PluginConfigResponse {
		plugin_id,
		config: None,
		schema,
	}))
}

/// List available plugins from all marketplaces
#[get("/plugins-market")]
pub async fn list_plugin_market() -> ApiResult<Vec<MarketPluginResponse>> {
	use aghub_plugins::discovery::{DiscoveryConfig, UnifiedPluginRegistry};

	// Create registry directly using async method (avoids runtime nesting)
	let config = DiscoveryConfig::default();
	let registry =
		UnifiedPluginRegistry::new_async(&config)
			.await
			.map_err(|e| {
				ApiError::internal(format!(
					"Failed to create plugin registry: {e}"
				))
			})?;

	// Get all plugins from all sources
	let plugins = registry.all_plugins();

	log::info!("Plugin market: discovered {} plugins", plugins.len());

	// Convert to response format
	let response: Vec<MarketPluginResponse> = plugins
		.into_iter()
		.map(|p| MarketPluginResponse {
			id: p.id.clone(),
			name: p.name.clone(),
			description: p.description.clone(),
			version: p.display_version(),
			author: p
				.author
				.as_ref()
				.map(|a| a.name.clone())
				.unwrap_or_default(),
			github_url: p.github_url().unwrap_or_default(),
			installs: p.install_count.unwrap_or(0) as i64,
			installed: p.installed,
			enabled: p.enabled,
			category: p.category.clone(),
		})
		.collect();

	Ok(Json(response))
}
