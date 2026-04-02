use crate::dto::plugin::{
	CheckUpdateRequest, CheckUpdateResponse, HookActionResponse,
	HookEventResponse, HookMatcherResponse, HooksManifestResponse,
	InstallPluginRequest, InstallPluginResponse, McpConfigResponse,
	McpServerResponse, PluginAuthorResponse, PluginConfigResponse,
	PluginDetailResponse, PluginListResponse, PluginManifestResponse,
	PluginResponse, ReinstallPluginRequest, ReinstallPluginResponse,
	UninstallPluginRequest, UninstallPluginResponse, UpdatePluginConfigRequest,
	UpdatePluginRequest, UpdatePluginResponse,
};
use crate::error::{ApiError, ApiResult};
use aghub_plugins::claude::ClaudePluginManager;
use rocket::http::Status;
use rocket::serde::json::Json;
use rocket::Route;
use std::process::Stdio;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

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
	]
}

#[get("/plugins")]
pub fn list_plugins() -> ApiResult<PluginListResponse> {
	let manager = ClaudePluginManager::new().map_err(|e| {
		crate::error::ApiError::internal(format!(
			"Failed to load plugin manager: {e}"
		))
	})?;

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

#[post("/plugins/install", data = "<body>")]
pub async fn install_plugin(
	body: Json<InstallPluginRequest>,
) -> ApiResult<InstallPluginResponse> {
	let req = body.into_inner();

	// Validate scope
	if !matches!(req.scope.as_str(), "user" | "project" | "local") {
		return Err(ApiError::bad_request(format!(
			"Invalid scope '{}'. Use 'user', 'project', or 'local'",
			req.scope
		)));
	}

	// Check if claude CLI is available
	let claude_path = which::which("claude").map_err(|_| {
		ApiError::new(
			Status::ServiceUnavailable,
			"Claude CLI not found. Please install Claude Code first.",
			"CLAUDE_CLI_NOT_FOUND",
		)
	})?;

	let mut cmd = Command::new(&claude_path);
	cmd.arg("plugin")
		.arg("install")
		.arg(&req.plugin_id)
		.arg("--scope")
		.arg(&req.scope)
		.stdout(Stdio::piped())
		.stderr(Stdio::piped());

	let output = match timeout(Duration::from_secs(120), cmd.output()).await {
		Ok(Ok(output)) => output,
		Ok(Err(e)) => {
			return Err(ApiError::internal(format!(
				"Failed to execute Claude CLI: {e}"
			)));
		}
		Err(_) => {
			return Err(ApiError::new(
				Status::RequestTimeout,
				"Plugin installation timed out after 2 minutes",
				"PLUGIN_INSTALL_TIMEOUT",
			));
		}
	};

	let stdout = String::from_utf8_lossy(&output.stdout);
	let stderr = String::from_utf8_lossy(&output.stderr);

	if output.status.success() {
		Ok(Json(InstallPluginResponse {
			success: true,
			message: stdout.trim().to_string(),
		}))
	} else {
		// Check if it's already installed
		if stderr.contains("already installed")
			|| stdout.contains("already installed")
		{
			return Ok(Json(InstallPluginResponse {
				success: true,
				message: "Plugin is already installed".to_string(),
			}));
		}

		Err(ApiError::new(
			Status::BadRequest,
			format!("Failed to install plugin: {}", stderr.trim()),
			"PLUGIN_INSTALL_FAILED",
		))
	}
}

#[post("/plugins/uninstall", data = "<body>")]
pub async fn uninstall_plugin(
	body: Json<UninstallPluginRequest>,
) -> ApiResult<UninstallPluginResponse> {
	let req = body.into_inner();

	// Validate scope
	if !matches!(req.scope.as_str(), "user" | "project" | "local") {
		return Err(ApiError::bad_request(format!(
			"Invalid scope '{}'. Use 'user', 'project', or 'local'",
			req.scope
		)));
	}

	// Check if claude CLI is available
	let claude_path = which::which("claude").map_err(|_| {
		ApiError::new(
			Status::ServiceUnavailable,
			"Claude CLI not found. Please install Claude Code first.",
			"CLAUDE_CLI_NOT_FOUND",
		)
	})?;

	let mut cmd = Command::new(&claude_path);
	cmd.arg("plugin")
		.arg("uninstall")
		.arg(&req.plugin_id)
		.arg("--scope")
		.arg(&req.scope);

	if req.keep_data {
		cmd.arg("--keep-data");
	}

	cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

	let output = match timeout(Duration::from_secs(60), cmd.output()).await {
		Ok(Ok(output)) => output,
		Ok(Err(e)) => {
			return Err(ApiError::internal(format!(
				"Failed to execute Claude CLI: {e}"
			)));
		}
		Err(_) => {
			return Err(ApiError::new(
				Status::RequestTimeout,
				"Plugin uninstallation timed out after 1 minute",
				"PLUGIN_UNINSTALL_TIMEOUT",
			));
		}
	};

	let stdout = String::from_utf8_lossy(&output.stdout);
	let stderr = String::from_utf8_lossy(&output.stderr);

	if output.status.success() {
		Ok(Json(UninstallPluginResponse {
			success: true,
			message: stdout.trim().to_string(),
		}))
	} else {
		Err(ApiError::new(
			Status::BadRequest,
			format!("Failed to uninstall plugin: {}", stderr.trim()),
			"PLUGIN_UNINSTALL_FAILED",
		))
	}
}

#[post("/plugins/update", data = "<body>")]
pub async fn update_plugin(
	body: Json<UpdatePluginRequest>,
) -> ApiResult<UpdatePluginResponse> {
	let req = body.into_inner();

	// Validate scope
	if !matches!(req.scope.as_str(), "user" | "project" | "local" | "managed") {
		return Err(ApiError::bad_request(format!(
			"Invalid scope '{}'. Use 'user', 'project', 'local', or 'managed'",
			req.scope
		)));
	}

	// Check if claude CLI is available
	let claude_path = which::which("claude").map_err(|_| {
		ApiError::new(
			Status::ServiceUnavailable,
			"Claude CLI not found. Please install Claude Code first.",
			"CLAUDE_CLI_NOT_FOUND",
		)
	})?;

	let mut cmd = Command::new(&claude_path);
	cmd.arg("plugin")
		.arg("update")
		.arg(&req.plugin_id)
		.arg("--scope")
		.arg(&req.scope)
		.stdout(Stdio::piped())
		.stderr(Stdio::piped());

	let output = match timeout(Duration::from_secs(120), cmd.output()).await {
		Ok(Ok(output)) => output,
		Ok(Err(e)) => {
			return Err(ApiError::internal(format!(
				"Failed to execute Claude CLI: {e}"
			)));
		}
		Err(_) => {
			return Err(ApiError::new(
				Status::RequestTimeout,
				"Plugin update timed out after 2 minutes",
				"PLUGIN_UPDATE_TIMEOUT",
			));
		}
	};

	let stdout = String::from_utf8_lossy(&output.stdout);
	let stderr = String::from_utf8_lossy(&output.stderr);

	if output.status.success() {
		Ok(Json(UpdatePluginResponse {
			success: true,
			message: stdout.trim().to_string(),
		}))
	} else {
		Err(ApiError::new(
			Status::BadRequest,
			format!("Failed to update plugin: {}", stderr.trim()),
			"PLUGIN_UPDATE_FAILED",
		))
	}
}

/// Get detailed plugin information including manifest, hooks, and MCP config
#[get("/plugins/<plugin_id>")]
pub fn get_plugin_detail(plugin_id: String) -> ApiResult<PluginDetailResponse> {
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

	// Read manifest
	let manifest = plugin.read_manifest().map_err(|e| {
		crate::error::ApiError::internal(format!(
			"Failed to read manifest: {e}"
		))
	})?;

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
	let hooks = plugin.read_hooks().map_err(|e| {
		crate::error::ApiError::internal(format!("Failed to read hooks: {e}"))
	})?;

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
	let mcp_config = plugin.read_mcp_config().map_err(|e| {
		crate::error::ApiError::internal(format!(
			"Failed to read MCP config: {e}"
		))
	})?;

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

	let base_response = PluginResponse {
		id: plugin.id.to_string(),
		name: plugin.display_name.clone(),
		version: plugin.version.clone(),
		description: plugin.description.clone(),
		enabled: plugin.enabled,
		source: plugin.source.to_string(),
		install_path: plugin.install_path.display().to_string(),
		has_skills: plugin.has_skills(),
		has_hooks: plugin.has_hooks(),
		has_mcp: plugin.has_mcp(),
	};

	Ok(Json(PluginDetailResponse {
		plugin: base_response,
		manifest: manifest_response,
		hooks: hooks_response,
		mcp_config: mcp_response,
		update_available: false, // TODO: implement update check
		latest_version: None,
	}))
}

/// Reinstall a plugin (uninstall then install)
#[post("/plugins/reinstall", data = "<body>")]
pub async fn reinstall_plugin(
	body: Json<ReinstallPluginRequest>,
) -> ApiResult<ReinstallPluginResponse> {
	let req = body.into_inner();

	// Validate scope
	if !matches!(req.scope.as_str(), "user" | "project" | "local") {
		return Err(ApiError::bad_request(format!(
			"Invalid scope '{}'. Use 'user', 'project', or 'local'",
			req.scope
		)));
	}

	// Check if claude CLI is available
	let claude_path = which::which("claude").map_err(|_| {
		ApiError::new(
			Status::ServiceUnavailable,
			"Claude CLI not found. Please install Claude Code first.",
			"CLAUDE_CLI_NOT_FOUND",
		)
	})?;

	// Step 1: Uninstall the plugin
	let mut uninstall_cmd = Command::new(&claude_path);
	uninstall_cmd
		.arg("plugin")
		.arg("uninstall")
		.arg(&req.plugin_id)
		.arg("--scope")
		.arg(&req.scope);

	if req.keep_data {
		uninstall_cmd.arg("--keep-data");
	}

	uninstall_cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

	let uninstall_output = match timeout(Duration::from_secs(60), uninstall_cmd.output()).await {
		Ok(Ok(output)) => output,
		Ok(Err(e)) => {
			return Err(ApiError::internal(format!(
				"Failed to execute Claude CLI uninstall: {e}"
			)));
		}
		Err(_) => {
			return Err(ApiError::new(
				Status::RequestTimeout,
				"Plugin uninstallation timed out after 1 minute",
				"PLUGIN_UNINSTALL_TIMEOUT",
			));
		}
	};

	// Step 2: Install the plugin
	let mut install_cmd = Command::new(&claude_path);
	install_cmd
		.arg("plugin")
		.arg("install")
		.arg(&req.plugin_id)
		.arg("--scope")
		.arg(&req.scope)
		.stdout(Stdio::piped())
		.stderr(Stdio::piped());

	let install_output = match timeout(Duration::from_secs(120), install_cmd.output()).await {
		Ok(Ok(output)) => output,
		Ok(Err(e)) => {
			return Err(ApiError::internal(format!(
				"Failed to execute Claude CLI install: {e}"
			)));
		}
		Err(_) => {
			return Err(ApiError::new(
				Status::RequestTimeout,
				"Plugin installation timed out after 2 minutes",
				"PLUGIN_INSTALL_TIMEOUT",
			));
		}
	};

	let install_stdout = String::from_utf8_lossy(&install_output.stdout);
	let install_stderr = String::from_utf8_lossy(&install_output.stderr);

	if install_output.status.success() {
		Ok(Json(ReinstallPluginResponse {
			success: true,
			message: format!(
				"Plugin reinstalled successfully. Uninstall: {}, Install: {}",
				String::from_utf8_lossy(&uninstall_output.stdout).trim(),
				install_stdout.trim()
			),
		}))
	} else {
		Err(ApiError::new(
			Status::BadRequest,
			format!("Failed to reinstall plugin: {}", install_stderr.trim()),
			"PLUGIN_REINSTALL_FAILED",
		))
	}
}

/// Check for plugin updates
#[post("/plugins/check-update", data = "<body>")]
pub async fn check_plugin_update(
	body: Json<CheckUpdateRequest>,
) -> ApiResult<CheckUpdateResponse> {
	let req = body.into_inner();

	use aghub_plugins::PluginId;

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

	// For now, we just return current info without checking remote
	// TODO: Implement actual update check by comparing with registry
	Ok(Json(CheckUpdateResponse {
		plugin_id: req.plugin_id,
		update_available: false,
		current_version: plugin.version.clone(),
		latest_version: None,
		changelog: None,
	}))
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
	let config: serde_json::Value = serde_json::from_str(&req.config).map_err(|e| {
		crate::error::ApiError::bad_request(format!("Invalid JSON config: {e}"))
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
pub fn delete_plugin_config(plugin_id: String) -> ApiResult<PluginConfigResponse> {
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
