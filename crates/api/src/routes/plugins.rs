use crate::dto::plugin::{
	CCPluginAuthorResponse, CCPluginCheckUpdateRequest,
	CCPluginCheckUpdateResponse, CCPluginConfigResponse,
	CCPluginDetailResponse, CCPluginHookActionResponse,
	CCPluginHookEventResponse, CCPluginHookMatcherResponse,
	CCPluginHooksManifestResponse, CCPluginInstallRequest,
	CCPluginInstallResponse, CCPluginListResponse, CCPluginManifestResponse,
	CCPluginMarketResponse, CCPluginMcpConfigResponse,
	CCPluginMcpServerResponse, CCPluginReinstallRequest,
	CCPluginReinstallResponse, CCPluginResponse, CCPluginScopeResponse,
	CCPluginSkillInfo, CCPluginUninstallRequest, CCPluginUninstallResponse,
	CCPluginUpdateConfigRequest, CCPluginUpdateRequest, CCPluginUpdateResponse,
};
use crate::error::{ApiError, ApiResult};
use aghub_plugins::claude::ClaudePluginManager;
use rocket::http::Status;
use rocket::serde::json::Json;
use rocket::Route;

impl From<&aghub_plugins::claude::ClaudePluginInfo> for CCPluginResponse {
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
pub fn list_plugins() -> ApiResult<CCPluginListResponse> {
	let manager = ClaudePluginManager::new().map_err(|e| {
		crate::error::ApiError::internal(format!(
			"Failed to load plugin manager: {e}"
		))
	})?;

	let mut plugins: Vec<CCPluginResponse> = manager
		.list_plugins()
		.iter()
		.map(CCPluginResponse::from)
		.collect();

	// Sort by name for stable ordering
	plugins.sort_by(|a, b| a.name.cmp(&b.name));

	Ok(Json(CCPluginListResponse { plugins }))
}

#[post("/plugins/<plugin_id>/enable")]
pub fn enable_plugin(plugin_id: &str) -> ApiResult<CCPluginResponse> {
	use aghub_plugins::PluginId;

	let id = PluginId::parse(plugin_id).map_err(|e| {
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

	Ok(Json(CCPluginResponse::from(&plugin)))
}

#[post("/plugins/<plugin_id>/disable")]
pub fn disable_plugin(plugin_id: &str) -> ApiResult<CCPluginResponse> {
	use aghub_plugins::PluginId;

	let id = PluginId::parse(plugin_id).map_err(|e| {
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

	Ok(Json(CCPluginResponse::from(&plugin)))
}

#[post("/plugins/install", data = "<body>")]
pub async fn install_plugin(
	body: Json<CCPluginInstallRequest>,
) -> ApiResult<CCPluginInstallResponse> {
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
		Ok(info) => Ok(Json(CCPluginInstallResponse {
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

/// Get detailed plugin information including manifest, hooks, and MCP config
#[get("/plugins/<plugin_id>")]
pub async fn get_plugin_detail(
	plugin_id: &str,
) -> ApiResult<CCPluginDetailResponse> {
	use aghub_plugins::installer::PluginInstaller;
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

	let manifest_response = manifest.map(|m| CCPluginManifestResponse {
		name: m.name,
		version: m.version,
		description: m.description,
		author: (!m.author.is_empty()).then_some(CCPluginAuthorResponse {
			name: m.author.name,
			email: m.author.email,
			url: m.author.url,
		}),
		homepage: m.homepage,
		repository: m.repository,
		license: m.license,
		keywords: m.keywords,
		logo: m.logo,
		skills: m.skills.map(|paths| paths.into_vec()),
		agents: m.agents.map(|paths| paths.into_vec()),
		commands: m.commands.map(|paths| paths.into_vec()),
	});

	// Read hooks
	let hooks = plugin.read_hooks().unwrap_or_else(|e| {
		eprintln!("Failed to read hooks for {}: {}", plugin.id, e);
		None
	});

	let hooks_response = hooks.map(|h| {
		let events: Vec<CCPluginHookEventResponse> = h
			.hooks
			.into_iter()
			.map(|(event, matchers)| CCPluginHookEventResponse {
				event,
				matchers: matchers
					.into_iter()
					.map(|m| CCPluginHookMatcherResponse {
						matcher: m.matcher,
						hooks: m
							.hooks
							.into_iter()
							.map(|h| CCPluginHookActionResponse {
								action_type: h.action_type,
								command: h.command,
								timeout: h.timeout,
							})
							.collect(),
					})
					.collect(),
			})
			.collect();
		CCPluginHooksManifestResponse { hooks: events }
	});

	// Read MCP config
	let mcp_config = plugin.read_mcp_config().unwrap_or_else(|e| {
		eprintln!("Failed to read MCP config for {}: {}", plugin.id, e);
		None
	});

	let mcp_response = mcp_config.map(|c| {
		let servers: Vec<CCPluginMcpServerResponse> = c
			.mcp_servers
			.into_iter()
			.map(|(name, s)| CCPluginMcpServerResponse {
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
		CCPluginMcpConfigResponse { servers }
	});

	let base_response = CCPluginResponse::from(plugin);

	let mut provided_skills: Vec<CCPluginSkillInfo> = Vec::new();
	// Collect skill dirs from all install paths (includes sibling directories)
	let mut all_skill_dirs = Vec::new();

	// Use all_install_paths to find skills in sibling version directories
	for install_path in plugin.all_install_paths() {
		all_skill_dirs.push(install_path.join("skills"));
		all_skill_dirs.push(install_path.join(".claude/skills"));
	}

	// If plugin specifies custom skills dir, add it for all install paths
	if let Ok(Some(manifest)) = plugin.read_manifest() {
		if let Some(ref skills_paths) = manifest.skills {
			for skills_path in skills_paths.iter() {
				for install_path in plugin.all_install_paths() {
					all_skill_dirs.push(install_path.join(skills_path));
				}
			}
		}
	}

	// Collect skills from all directories, keeping the first non-empty description
	let mut skill_descriptions: std::collections::HashMap<
		String,
		Option<String>,
	> = std::collections::HashMap::new();

	for skills_dir in &all_skill_dirs {
		if !skills_dir.is_dir() {
			continue;
		}
		if let Ok(entries) = std::fs::read_dir(skills_dir) {
			for entry in entries.flatten() {
				if !entry.path().is_dir() {
					continue;
				}
				if let Ok(name) = entry.file_name().into_string() {
					let description = extract_skill_description(&entry.path());
					// Only update if we don't have this skill yet, or if current description is None and new one is Some
					skill_descriptions
						.entry(name)
						.and_modify(|existing| {
							if existing.is_none() && description.is_some() {
								*existing = description.clone();
							}
						})
						.or_insert(description);
				}
			}
		}
	}

	// Convert to response format
	for (name, description) in skill_descriptions {
		provided_skills.push(CCPluginSkillInfo { name, description });
	}

	provided_skills.sort_by(|a, b| a.name.cmp(&b.name));

	let (update_available, latest_version) = if id.source
		== "claude-plugins-official"
		|| id.source.starts_with("http")
	{
		match PluginInstaller::new() {
			Ok(installer) => match installer.check_update(&id).await {
				Ok(Some((latest_version, _))) => (true, Some(latest_version)),
				Ok(None) => (false, None),
				Err(error) => {
					log::warn!("Failed to check updates for {}: {}", id, error);
					(false, None)
				}
			},
			Err(error) => {
				log::warn!(
					"Failed to create plugin installer for {}: {}",
					id,
					error
				);
				(false, None)
			}
		}
	} else {
		(false, None)
	};

	Ok(Json(CCPluginDetailResponse {
		plugin: base_response,
		manifest: manifest_response,
		hooks: hooks_response,
		mcp_config: mcp_response,
		update_available,
		latest_version,
		provided_skills,
	}))
}

/// Reinstall a plugin (uninstall then install)
#[post("/plugins/reinstall", data = "<body>")]
pub async fn reinstall_plugin(
	body: Json<CCPluginReinstallRequest>,
) -> ApiResult<CCPluginReinstallResponse> {
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

/// Check for plugin updates
#[post("/plugins/check-update", data = "<body>")]
pub async fn check_plugin_update(
	body: Json<CCPluginCheckUpdateRequest>,
) -> ApiResult<CCPluginCheckUpdateResponse> {
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
		Ok(Some((latest_version, _))) => {
			Ok(Json(CCPluginCheckUpdateResponse {
				plugin_id: req.plugin_id,
				update_available: true,
				current_version: plugin.version.clone(),
				latest_version: Some(latest_version),
				changelog: None,
			}))
		}
		Ok(None) => Ok(Json(CCPluginCheckUpdateResponse {
			plugin_id: req.plugin_id,
			update_available: false,
			current_version: plugin.version.clone(),
			latest_version: None,
			changelog: None,
		})),
		Err(e) => {
			// If we can't check, return current state without error
			eprintln!("Failed to check for updates: {}", e);
			Ok(Json(CCPluginCheckUpdateResponse {
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
pub fn get_plugin_config(
	plugin_id: String,
) -> ApiResult<CCPluginConfigResponse> {
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

	Ok(Json(CCPluginConfigResponse {
		plugin_id,
		config,
		schema,
	}))
}

/// Update plugin user configuration
#[post("/plugins/<plugin_id>/config", data = "<body>")]
pub fn update_plugin_config(
	plugin_id: String,
	body: Json<CCPluginUpdateConfigRequest>,
) -> ApiResult<CCPluginConfigResponse> {
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

	Ok(Json(CCPluginConfigResponse {
		plugin_id,
		config,
		schema,
	}))
}

/// Delete plugin user configuration
#[delete("/plugins/<plugin_id>/config")]
pub fn delete_plugin_config(
	plugin_id: String,
) -> ApiResult<CCPluginConfigResponse> {
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

	Ok(Json(CCPluginConfigResponse {
		plugin_id,
		config: None,
		schema,
	}))
}

/// Update marketplace (pull latest from git)
#[post("/plugins-market/update")]
pub async fn update_marketplace() -> ApiResult<serde_json::Value> {
	use aghub_plugins::installer::registry::MarketplaceRegistry;

	let registry = MarketplaceRegistry::new_official().map_err(|e| {
		ApiError::internal(format!(
			"Failed to create marketplace registry: {e}"
		))
	})?;

	registry.update().await.map_err(|e| {
		ApiError::internal(format!("Failed to update marketplace: {e}"))
	})?;

	Ok(Json(serde_json::json!({
		"success": true,
		"message": "Marketplace updated successfully"
	})))
}

/// List available plugins from all marketplaces
#[get("/plugins-market")]
pub async fn list_plugin_market() -> ApiResult<Vec<CCPluginMarketResponse>> {
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

	// Get installed plugins for scopes checking
	let installed_manager =
		aghub_plugins::claude::ClaudePluginManager::new().ok();

	// Convert to response format
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
				version: p.display_version(),
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

/// Extract skill description from SKILL.md frontmatter
fn extract_skill_description(skill_dir: &std::path::Path) -> Option<String> {
	skill::parser::parse(skill_dir).ok().map(|s| s.description)
}
