use crate::dto::plugin::{
	CCMarketplaceAddRequest, CCMarketplaceEntryResponse,
	CCMarketplaceListResponse, CCMarketplaceMutationResponse,
	CCMarketplaceSourceResponse, CCPluginAuthorResponse,
	CCPluginCliStatusResponse, CCPluginConfigResponse, CCPluginDetailResponse,
	CCPluginHookActionResponse, CCPluginHookEventResponse,
	CCPluginHookMatcherResponse, CCPluginHooksManifestResponse,
	CCPluginInstallRequest, CCPluginInstallResponse, CCPluginListResponse,
	CCPluginManifestResponse, CCPluginMarketResponse,
	CCPluginMcpConfigResponse, CCPluginMcpServerResponse,
	CCPluginOpenSkillInEditorRequest, CCPluginPruneRequest,
	CCPluginPruneResponse, CCPluginResponse, CCPluginScopeResponse,
	CCPluginSkillInfo, CCPluginSourceInfoResponse, CCPluginUninstallRequest,
	CCPluginUninstallResponse, CCPluginUpdateConfigRequest,
	CCPluginUpdateRequest, CCPluginUpdateResponse, CCPluginValidateRequest,
	CCPluginValidateResponse,
};
use crate::error::{ApiError, ApiNoContent, ApiResult};
use aghub_cc_plugins::claude::settings::InstallScope;
use aghub_cc_plugins::claude::{ClaudePluginInfo, ClaudePluginManager};
use aghub_cc_plugins::cli::types::{CliMarketplace, CliMarketplaceSource};
use aghub_cc_plugins::cli::ClaudeCli;
use aghub_cc_plugins::installer::PluginInstaller;
use aghub_cc_plugins::PluginId;
use aghub_git::source::{resolve_remote_source, RemoteSourceType};
use log::{error, warn};
use reqwest::Url;
use rocket::http::Status;
use rocket::response::status::NoContent;
use rocket::serde::json::Json;
use std::collections::{BTreeMap, HashMap};
use std::fmt::Display;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::Duration;

// ── Helpers ──────────────────────────────────────────────────────────────────

const OFFICIAL_MARKETPLACE_URL: &str =
	"https://github.com/anthropics/claude-plugins-official";
const PLUGIN_MARKET_UPDATE_TIMEOUT: Duration = Duration::from_secs(300);

fn parse_plugin_id(plugin_id: &str) -> Result<PluginId, ApiError> {
	PluginId::parse(plugin_id)
		.map_err(|e| ApiError::bad_request(format!("Invalid plugin ID: {e}")))
}

fn parse_install_scope(scope: &str) -> Result<InstallScope, ApiError> {
	match scope {
		"global" | "user" | "project" | "local" | "managed" => {
			Ok(InstallScope::from(scope))
		}
		_ => Err(ApiError::bad_request(format!(
			"Invalid scope '{scope}'. Use 'global', 'project', 'local', or 'managed'"
		))),
	}
}

/// Normalize legacy scope values (e.g. "user" → "global").
fn normalize_scope_value(scope: &str) -> String {
	match scope {
		"user" => "global".to_string(),
		other => other.to_string(),
	}
}

async fn load_plugin_manager() -> Result<ClaudePluginManager, ApiError> {
	ClaudePluginManager::new().await.map_err(|e| {
		error!("Failed to initialize plugin manager: {e}");
		ApiError::internal("Failed to initialize plugin manager")
	})
}

fn load_plugin_installer() -> Result<PluginInstaller, ApiError> {
	PluginInstaller::new().map_err(|e| {
		error!("Failed to initialize plugin installer: {e}");
		ApiError::internal("Failed to initialize plugin installer")
	})
}

fn try_load_plugin_installer() -> Option<PluginInstaller> {
	PluginInstaller::new()
		.inspect_err(|e| warn!("Failed to create plugin installer: {e}"))
		.ok()
}

fn get_plugin(
	manager: &ClaudePluginManager,
	id: &PluginId,
) -> Result<ClaudePluginInfo, ApiError> {
	manager
		.get_plugin(id)
		.cloned()
		.ok_or_else(|| ApiError::not_found(format!("Plugin '{id}' not found")))
}

async fn load_manager_and_plugin(
	id: &PluginId,
) -> Result<(ClaudePluginManager, ClaudePluginInfo), ApiError> {
	let manager = load_plugin_manager().await?;
	let plugin = get_plugin(&manager, id)?;
	Ok((manager, plugin))
}

fn plugin_error(
	status: Status,
	action: &str,
	plugin_id: &str,
	code: &'static str,
	error: &impl Display,
) -> ApiError {
	error!("Failed to {action} plugin {plugin_id}: {error}");
	ApiError::new(status, format!("Failed to {action} plugin"), code)
}

fn sanitize_path_home(path: &Path) -> String {
	if let Some(home) = dirs::home_dir() {
		if let Ok(relative) = path.strip_prefix(&home) {
			return PathBuf::from("~").join(relative).display().to_string();
		}
	}
	let parts: Vec<String> = path
		.components()
		.filter_map(|c| match c {
			Component::Normal(p) => Some(p.to_string_lossy().into_owned()),
			_ => None,
		})
		.collect();
	let start = parts.len().saturating_sub(3);
	let tail = &parts[start..];
	if tail.is_empty() {
		"…".to_string()
	} else {
		format!("…/{}", tail.join("/"))
	}
}

fn resolve_plugin_scope<'a>(
	plugin: &'a ClaudePluginInfo,
	scope: Option<&str>,
) -> Result<Option<&'a aghub_cc_plugins::claude::PluginScopeInfo>, ApiError> {
	match scope {
		Some(value) => {
			let scope = parse_install_scope(value)?;
			let normalized = scope.to_string();
			plugin
				.scopes
				.iter()
				.find(|item| normalize_scope_value(&item.scope) == normalized)
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

fn build_source_info(
	plugin: &ClaudePluginInfo,
	installer: Option<&PluginInstaller>,
) -> CCPluginSourceInfoResponse {
	let resolved = plugin
		.effective_repository()
		.and_then(|r| resolve_remote_source(r.trim()).ok());
	let repository_url = resolved.as_ref().map(|r| {
		r.source_url
			.trim_end_matches('/')
			.trim_end_matches(".git")
			.to_string()
	});
	let marketplace_url =
		installer.and_then(|i| i.marketplace_repository_url(&plugin.id));
	let keep_source_label =
		repository_url.is_none() && marketplace_url.is_some();
	let url = repository_url
		.clone()
		.or_else(|| marketplace_url.clone())
		.or_else(|| match plugin.id.source.as_str() {
			"claude-plugins-official" => {
				Some(OFFICIAL_MARKETPLACE_URL.to_string())
			}
			s if s.starts_with("http://") || s.starts_with("https://") => {
				Some(s.to_string())
			}
			_ => None,
		});

	let is_github = resolved
		.as_ref()
		.map(|r| r.source_type == RemoteSourceType::Github)
		.or_else(|| {
			url.as_deref()
				.and_then(|v| Url::parse(v).ok())
				.map(|u| u.host_str() == Some("github.com"))
		})
		.unwrap_or(false);

	let label = if keep_source_label {
		plugin.source.to_string()
	} else if let Some(r) = &resolved {
		r.source.clone()
	} else {
		url.as_deref()
			.and_then(|v| Url::parse(v).ok())
			.and_then(|u| {
				u.host_str()
					.map(|h| h.trim_start_matches("www.").to_string())
			})
			.unwrap_or_else(|| plugin.source.to_string())
	};

	CCPluginSourceInfoResponse {
		label,
		url,
		is_github,
		can_reinstall: installer
			.map(|i| i.can_reinstall(&plugin.id))
			.unwrap_or(false),
	}
}

fn build_plugin_response(
	plugin: &ClaudePluginInfo,
	installer: Option<&PluginInstaller>,
) -> CCPluginResponse {
	let display_scope = plugin.scopes.first();
	let version = display_scope
		.map(|s| s.version.clone())
		.unwrap_or_else(|| plugin.version.clone());
	CCPluginResponse {
		id: plugin.id.to_string(),
		name: plugin.display_name.clone(),
		version,
		display_scope: display_scope.map(|s| normalize_scope_value(&s.scope)),
		description: plugin.description.clone(),
		enabled: plugin.enabled,
		source: plugin.source.to_string(),
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
			.map(|s| CCPluginScopeResponse {
				scope: normalize_scope_value(&s.scope),
				folder_path: sanitize_path_home(&s.install_path),
				version: s.version.clone(),
				installed_at: s.installed_at.clone(),
				updated_at: s.last_updated.clone(),
			})
			.collect(),
	}
}

fn sorted_entries(
	values: Option<HashMap<String, String>>,
) -> Option<BTreeMap<String, String>> {
	values.map(|e| e.into_iter().collect())
}

// ── List / Enable / Disable ──────────────────────────────────────────────────

#[get("/plugins")]
pub async fn list_plugins() -> ApiResult<CCPluginListResponse> {
	let manager = load_plugin_manager().await?;
	let installer = try_load_plugin_installer();
	let mut plugins: Vec<CCPluginResponse> = manager
		.list_plugins()
		.iter()
		.map(|p| build_plugin_response(p, installer.as_ref()))
		.collect();
	plugins.sort_by(|a, b| a.name.cmp(&b.name));
	Ok(Json(CCPluginListResponse { plugins }))
}

#[post("/plugins/enable?<plugin_id>&<scope>")]
pub async fn enable_plugin(
	plugin_id: &str,
	scope: Option<&str>,
) -> ApiResult<CCPluginResponse> {
	let id = parse_plugin_id(plugin_id)?;
	let scope = scope.map(parse_install_scope).transpose()?;
	let mut manager = load_plugin_manager().await?;
	let installer = try_load_plugin_installer();
	manager.enable(&id, scope).await.map_err(|e| {
		plugin_error(
			Status::InternalServerError,
			"enable",
			plugin_id,
			"PLUGIN_ENABLE_FAILED",
			&e,
		)
	})?;
	let plugin = get_plugin(&manager, &id)?;
	Ok(Json(build_plugin_response(&plugin, installer.as_ref())))
}

#[post("/plugins/disable?<plugin_id>&<scope>")]
pub async fn disable_plugin(
	plugin_id: &str,
	scope: Option<&str>,
) -> ApiResult<CCPluginResponse> {
	let id = parse_plugin_id(plugin_id)?;
	let scope = scope.map(parse_install_scope).transpose()?;
	let mut manager = load_plugin_manager().await?;
	let installer = try_load_plugin_installer();
	manager.disable(&id, scope).await.map_err(|e| {
		plugin_error(
			Status::InternalServerError,
			"disable",
			plugin_id,
			"PLUGIN_DISABLE_FAILED",
			&e,
		)
	})?;
	let plugin = get_plugin(&manager, &id)?;
	Ok(Json(build_plugin_response(&plugin, installer.as_ref())))
}

// ── Install / Uninstall / Update ─────────────────────────────────────────────

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
			if e.downcast_ref::<aghub_cc_plugins::errors::PluginError>()
				.is_some_and(|pe| {
					matches!(pe, aghub_cc_plugins::errors::PluginError::AlreadyInstalled { .. })
				}) {
				return Ok(Json(CCPluginInstallResponse {
					success: true,
					message: "Plugin is already installed".to_string(),
				}));
			}
			Err(plugin_error(
				Status::BadRequest,
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

	installer
		.uninstall(&plugin_id, scope, req.keep_data, req.prune)
		.await
		.map_err(|e| {
			plugin_error(
				Status::BadRequest,
				"uninstall",
				&req.plugin_id,
				"PLUGIN_UNINSTALL_FAILED",
				&e,
			)
		})?;
	Ok(Json(CCPluginUninstallResponse {
		success: true,
		message: format!("Plugin '{}' uninstalled successfully", req.plugin_id),
	}))
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
			restart_required: true,
		})),
		Err(e) => {
			if e.downcast_ref::<aghub_cc_plugins::errors::PluginError>()
				.is_some_and(|pe| {
					matches!(pe, aghub_cc_plugins::errors::PluginError::AlreadyUpToDate { .. })
				}) {
				return Ok(Json(CCPluginUpdateResponse {
					success: true,
					message: "Plugin is already up to date".to_string(),
					restart_required: false,
				}));
			}
			Err(plugin_error(
				Status::BadRequest,
				"update",
				&req.plugin_id,
				"PLUGIN_UPDATE_FAILED",
				&e,
			))
		}
	}
}

// ── Detail ───────────────────────────────────────────────────────────────────

#[get("/plugins/detail?<plugin_id>")]
pub async fn get_plugin_detail(
	plugin_id: &str,
) -> ApiResult<CCPluginDetailResponse> {
	let id = parse_plugin_id(plugin_id)?;
	let (_, plugin) = load_manager_and_plugin(&id).await?;

	let manifest = plugin.read_manifest().unwrap_or_else(|e| {
		warn!("Failed to read manifest for {}: {}", plugin.id, e);
		None
	});
	let manifest_response =
		manifest.as_ref().map(|m| CCPluginManifestResponse {
			name: m.name.clone(),
			version: m.version.clone(),
			description: m.description.clone(),
			author: (!m.author.is_empty()).then_some(CCPluginAuthorResponse {
				name: m.author.name.clone(),
				email: m.author.email.clone(),
				url: m.author.url.clone(),
			}),
			homepage: m.homepage.clone(),
			repository: m.repository.clone(),
			license: m.license.clone(),
			keywords: m.keywords.clone(),
			logo: m.logo.clone(),
			skills: m.skills.clone().map(|p| p.into_vec()),
			agents: m.agents.clone().map(|p| p.into_vec()),
			commands: m.commands.clone().map(|p| p.into_vec()),
		});

	let hooks_response = plugin
		.read_hooks()
		.unwrap_or_else(|e| {
			warn!("Failed to read hooks for {}: {}", plugin.id, e);
			None
		})
		.map(|h| CCPluginHooksManifestResponse {
			hooks: h
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
								.map(|a| CCPluginHookActionResponse {
									action_type: a.action_type,
									command: a.command,
									timeout: a.timeout,
								})
								.collect(),
						})
						.collect(),
				})
				.collect(),
		});

	let mcp_response = plugin
		.read_mcp_config()
		.unwrap_or_else(|e| {
			warn!("Failed to read MCP config for {}: {}", plugin.id, e);
			None
		})
		.map(|c| CCPluginMcpConfigResponse {
			servers: c
				.mcp_servers
				.into_iter()
				.map(|(name, s)| CCPluginMcpServerResponse {
					name,
					transport_type: s.transport_type,
					command: s.command,
					args: s.args,
					url: s.url,
					env: sorted_entries(s.env),
					headers: sorted_entries(s.headers),
					note: s.note,
				})
				.collect(),
		});

	let installer = try_load_plugin_installer();
	let base = build_plugin_response(&plugin, installer.as_ref());

	let mut provided_skills: Vec<CCPluginSkillInfo> = plugin
		.all_skills_dirs()
		.iter()
		.filter(|d| d.is_dir())
		.flat_map(|d| std::fs::read_dir(d).into_iter().flatten().flatten())
		.filter(|e| e.path().is_dir())
		.filter_map(|e| {
			let name = e.file_name().into_string().ok()?;
			let description =
				skill::parser::parse(&e.path()).ok().map(|s| s.description);
			Some(CCPluginSkillInfo { name, description })
		})
		.collect();
	// Deduplicate by name, keeping first occurrence
	let mut seen = std::collections::HashSet::new();
	provided_skills.retain(|s| seen.insert(s.name.clone()));
	provided_skills.sort_by(|a, b| a.name.cmp(&b.name));

	Ok(Json(CCPluginDetailResponse {
		plugin: base,
		manifest: manifest_response,
		hooks: hooks_response,
		mcp_config: mcp_response,
		provided_skills,
	}))
}

// ── Config ───────────────────────────────────────────────────────────────────

#[get("/plugins/config?<plugin_id>")]
pub async fn get_plugin_config(
	plugin_id: String,
) -> ApiResult<CCPluginConfigResponse> {
	let id = parse_plugin_id(&plugin_id)?;
	let (manager, plugin) = load_manager_and_plugin(&id).await?;
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

#[post("/plugins/config", data = "<body>")]
pub async fn update_plugin_config(
	body: Json<CCPluginUpdateConfigRequest>,
) -> ApiResult<CCPluginConfigResponse> {
	let req = body.into_inner();
	let plugin_id = req.plugin_id.clone();
	let id = parse_plugin_id(&plugin_id)?;
	let (mut manager, plugin) = load_manager_and_plugin(&id).await?;
	let schema = plugin
		.read_manifest()
		.ok()
		.flatten()
		.and_then(|m| m.user_config)
		.and_then(|s| serde_json::to_string(&s).ok());

	let config: serde_json::Value =
		serde_json::from_str(&req.config).map_err(|e| {
			ApiError::bad_request(format!("Invalid JSON config: {e}"))
		})?;
	if !config.is_object() {
		return Err(ApiError::bad_request("Config must be a JSON object"));
	}

	manager.set_plugin_config(&id, config).map_err(|e| {
		error!("Failed to save plugin config for {plugin_id}: {e}");
		ApiError::internal("Failed to save plugin config")
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

#[delete("/plugins/config?<plugin_id>")]
pub async fn delete_plugin_config(
	plugin_id: String,
) -> ApiResult<CCPluginConfigResponse> {
	let id = parse_plugin_id(&plugin_id)?;
	let (mut manager, plugin) = load_manager_and_plugin(&id).await?;
	let schema = plugin
		.read_manifest()
		.ok()
		.flatten()
		.and_then(|m| m.user_config)
		.and_then(|s| serde_json::to_string(&s).ok());

	manager.remove_plugin_config(&id).map_err(|e| {
		error!("Failed to remove plugin config for {plugin_id}: {e}");
		ApiError::internal("Failed to remove plugin config")
	})?;
	Ok(Json(CCPluginConfigResponse {
		plugin_id,
		config: None,
		schema,
	}))
}

// ── Open Folder / Editor ─────────────────────────────────────────────────────

#[post("/plugins/open-folder?<plugin_id>&<scope>")]
pub async fn open_plugin_folder(
	plugin_id: &str,
	scope: Option<&str>,
) -> ApiNoContent {
	let id = parse_plugin_id(plugin_id)?;
	let (_, plugin) = load_manager_and_plugin(&id).await?;
	let install_path = resolve_plugin_scope(&plugin, scope)?
		.map(|s| s.install_path.clone())
		.unwrap_or_else(|| plugin.install_path.clone());
	open::that(install_path).map_err(|e| {
		error!("Failed to open plugin folder {plugin_id}: {e}");
		ApiError::internal("Failed to open plugin folder")
	})?;
	Ok(NoContent)
}

#[post("/plugins/open-skill-in-editor", data = "<body>")]
pub async fn open_plugin_skill_in_editor(
	body: Json<CCPluginOpenSkillInEditorRequest>,
) -> ApiNoContent {
	let req = body.into_inner();
	let id = parse_plugin_id(&req.plugin_id)?;
	let (_, plugin) = load_manager_and_plugin(&id).await?;
	let path = resolve_plugin_skill_path(&plugin, &req.scope, &req.skill_name)?;
	let mut cmd = Command::new(req.editor.cli_command());
	cmd.arg(&path);
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		cmd.creation_flags(crate::CREATE_NO_WINDOW);
	}
	cmd.spawn().map_err(|e| {
		error!("Failed to open plugin skill in editor: {e}");
		ApiError::internal("Failed to open plugin skill in editor")
	})?;
	Ok(NoContent)
}

fn resolve_plugin_skill_path(
	plugin: &ClaudePluginInfo,
	scope: &str,
	skill_name: &str,
) -> Result<PathBuf, ApiError> {
	let install_path = resolve_plugin_scope(plugin, Some(scope))?
		.map(|s| s.install_path.clone())
		.unwrap_or_else(|| plugin.install_path.clone());

	let skill_dirs = [
		install_path.join("skills"),
		install_path.join(".claude/skills"),
	];
	let manifest_dirs = plugin
		.read_manifest()
		.ok()
		.flatten()
		.and_then(|m| m.skills)
		.map(|paths| {
			paths
				.iter()
				.map(|p| install_path.join(p))
				.collect::<Vec<_>>()
		})
		.unwrap_or_default();

	for dir in skill_dirs.iter().chain(manifest_dirs.iter()) {
		if !dir.is_dir() {
			continue;
		}
		if let Ok(entries) = std::fs::read_dir(dir) {
			for entry in entries.flatten() {
				if !entry.path().is_dir() {
					continue;
				}
				if entry.file_name().to_str().is_some_and(|n| n == skill_name) {
					let skill_file = entry.path().join("SKILL.md");
					return Ok(if skill_file.is_file() {
						skill_file
					} else {
						entry.path()
					});
				}
			}
		}
	}

	Err(ApiError::not_found(format!(
		"Skill '{skill_name}' not found in plugin '{}' for scope '{scope}'",
		plugin.id
	)))
}

// ── Marketplace ──────────────────────────────────────────────────────────────

#[get("/plugins-market")]
pub async fn list_plugin_market() -> ApiResult<Vec<CCPluginMarketResponse>> {
	use aghub_cc_plugins::discovery::{DiscoveryConfig, UnifiedPluginRegistry};

	let registry =
		UnifiedPluginRegistry::new_async(&DiscoveryConfig::default())
			.await
			.map_err(|e| {
				error!("Failed to create plugin registry: {e}");
				ApiError::internal("Failed to create plugin registry")
			})?;
	let installed_manager = load_plugin_manager().await.ok();

	let response: Vec<CCPluginMarketResponse> = registry
		.all_plugins()
		.into_iter()
		.map(|p| {
			let installed_scopes = if p.installed {
				PluginId::parse(&p.id)
					.ok()
					.and_then(|id| {
						installed_manager.as_ref()?.get_plugin(&id).map(|cp| {
							cp.scopes
								.iter()
								.map(|s| normalize_scope_value(&s.scope))
								.collect()
						})
					})
					.unwrap_or_default()
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

fn marketplace_source_to_dto(
	source: CliMarketplaceSource,
) -> CCMarketplaceSourceResponse {
	match source {
		CliMarketplaceSource::Github { repo } => {
			CCMarketplaceSourceResponse::Github { repo }
		}
		CliMarketplaceSource::Git { url } => {
			CCMarketplaceSourceResponse::Git { url }
		}
		CliMarketplaceSource::Url { url } => {
			CCMarketplaceSourceResponse::Url { url }
		}
		CliMarketplaceSource::Local { path } => {
			CCMarketplaceSourceResponse::Local { path }
		}
	}
}

fn marketplace_entry_to_dto(
	entry: CliMarketplace,
) -> CCMarketplaceEntryResponse {
	CCMarketplaceEntryResponse {
		name: entry.name,
		source: marketplace_source_to_dto(entry.source),
		install_location: entry.install_location,
	}
}

fn load_claude_cli() -> Result<ClaudeCli, ApiError> {
	ClaudeCli::new().map_err(|e| {
		error!("Failed to locate claude CLI: {e}");
		ApiError::internal("claude CLI is not installed or not on PATH")
	})
}

#[get("/plugins/marketplaces")]
pub async fn list_marketplaces() -> ApiResult<CCMarketplaceListResponse> {
	let cli = load_claude_cli()?;
	let entries = cli.marketplace_list().await.map_err(|e| {
		error!("Failed to list marketplaces: {e}");
		ApiError::new(
			Status::BadGateway,
			"Failed to list marketplaces",
			"PLUGIN_MARKETPLACE_LIST_FAILED",
		)
	})?;
	Ok(Json(CCMarketplaceListResponse {
		marketplaces: entries
			.into_iter()
			.map(marketplace_entry_to_dto)
			.collect(),
	}))
}

#[post("/plugins/marketplaces", data = "<body>")]
pub async fn add_marketplace(
	body: Json<CCMarketplaceAddRequest>,
) -> ApiResult<CCMarketplaceMutationResponse> {
	let req = body.into_inner();
	let scope = parse_install_scope(&req.scope)?;
	let cli = load_claude_cli()?;
	let entry = cli
		.marketplace_add(&req.source, scope, &req.sparse)
		.await
		.map_err(|e| {
			error!("Failed to add marketplace {}: {e}", req.source);
			ApiError::new(
				Status::BadRequest,
				format!("Failed to add marketplace '{}'", req.source),
				"PLUGIN_MARKETPLACE_ADD_FAILED",
			)
		})?;
	let entry = marketplace_entry_to_dto(entry);
	Ok(Json(CCMarketplaceMutationResponse {
		success: true,
		message: format!("Added marketplace '{}'", entry.name),
		marketplace: Some(entry),
	}))
}

#[delete("/plugins/marketplaces/<name>")]
pub async fn remove_marketplace(
	name: &str,
) -> ApiResult<CCMarketplaceMutationResponse> {
	let cli = load_claude_cli()?;
	cli.marketplace_remove(name).await.map_err(|e| {
		error!("Failed to remove marketplace {name}: {e}");
		ApiError::new(
			Status::BadRequest,
			format!("Failed to remove marketplace '{name}'"),
			"PLUGIN_MARKETPLACE_REMOVE_FAILED",
		)
	})?;
	Ok(Json(CCMarketplaceMutationResponse {
		success: true,
		message: format!("Removed marketplace '{name}'"),
		marketplace: None,
	}))
}

#[post("/plugins/marketplaces/<name>/update")]
pub async fn update_marketplace_one(
	name: &str,
) -> ApiResult<CCMarketplaceMutationResponse> {
	let cli = load_claude_cli()?;
	let entries = cli.marketplace_list().await.map_err(|e| {
		error!("Failed to validate marketplace existence: {e}");
		ApiError::new(
			Status::BadGateway,
			"Failed to validate marketplace existence",
			"PLUGIN_MARKETPLACE_UPDATE_FAILED",
		)
	})?;
	if !entries.iter().any(|e| e.name == name) {
		return Err(ApiError::new(
			Status::NotFound,
			format!("Marketplace '{name}' not found"),
			"PLUGIN_MARKETPLACE_NOT_FOUND",
		));
	}
	// claude plugin marketplace update does not accept a name argument;
	// run the all-update so the named marketplace's index is refreshed
	cli.marketplace_update(None).await.map_err(|e| {
		error!("Failed to update marketplace {name}: {e}");
		ApiError::new(
			Status::BadGateway,
			format!("Failed to update marketplace '{name}'"),
			"PLUGIN_MARKETPLACE_UPDATE_FAILED",
		)
	})?;
	Ok(Json(CCMarketplaceMutationResponse {
		success: true,
		message: format!("Updated marketplace '{name}'"),
		marketplace: None,
	}))
}

#[post("/plugins-market/update")]
pub async fn update_marketplace() -> ApiResult<serde_json::Value> {
	let installer = load_plugin_installer()?;
	let updated = tokio::time::timeout(
		PLUGIN_MARKET_UPDATE_TIMEOUT,
		installer.update_marketplaces(),
	)
	.await
	.map_err(|_| {
		error!("Timed out while updating plugin marketplaces");
		ApiError::new(
			Status::GatewayTimeout,
			"Timed out while updating plugin marketplaces",
			"PLUGIN_MARKET_UPDATE_TIMEOUT",
		)
	})?
	.map_err(|e| {
		error!("Failed to update plugin marketplaces: {e}");
		ApiError::new(
			Status::BadGateway,
			"Failed to update plugin marketplaces",
			"PLUGIN_MARKET_UPDATE_FAILED",
		)
	})?;
	Ok(Json(serde_json::json!({
		"success": true,
		"updated_count": updated.len()
	})))
}

// ── Prune / Validate ─────────────────────────────────────────────────────────

#[post("/plugins/prune", data = "<body>")]
pub async fn prune_plugins(
	body: Json<CCPluginPruneRequest>,
) -> ApiResult<CCPluginPruneResponse> {
	let req = body.into_inner();
	let scope = parse_install_scope(&req.scope)?;
	let cli = load_claude_cli()?;
	let summary = cli.plugin_prune(scope, req.dry_run).await.map_err(|e| {
		error!("Failed to prune plugins: {e}");
		ApiError::new(
			Status::BadGateway,
			"Failed to prune plugins",
			"PLUGIN_PRUNE_FAILED",
		)
	})?;
	Ok(Json(CCPluginPruneResponse {
		success: true,
		summary,
	}))
}

#[post("/plugins/validate", data = "<body>")]
pub async fn validate_plugin(
	body: Json<CCPluginValidateRequest>,
) -> ApiResult<CCPluginValidateResponse> {
	let req = body.into_inner();
	let cli = load_claude_cli()?;
	let path = std::path::PathBuf::from(&req.path);
	cli.plugin_validate(&path).await.map_err(|e| {
		error!("Plugin validation failed for {}: {e}", req.path);
		ApiError::new(
			Status::BadRequest,
			"Plugin validation failed for manifest".to_string(),
			"PLUGIN_VALIDATE_FAILED",
		)
	})?;
	Ok(Json(CCPluginValidateResponse {
		success: true,
		message: "Manifest is valid".to_string(),
	}))
}

// ── CLI status ───────────────────────────────────────────────────────────────

#[get("/plugins/cli/status")]
pub async fn cli_status() -> Json<CCPluginCliStatusResponse> {
	let cli = match ClaudeCli::new() {
		Ok(cli) => cli,
		Err(e) => {
			return Json(CCPluginCliStatusResponse {
				installed: false,
				version: None,
				path: None,
				error: Some(e.to_string()),
			});
		}
	};
	let path = Some("REDACTED".to_string());
	match cli.version().await {
		Ok(version) => Json(CCPluginCliStatusResponse {
			installed: true,
			version: Some(version),
			path,
			error: None,
		}),
		Err(e) => Json(CCPluginCliStatusResponse {
			installed: true,
			version: None,
			path,
			error: Some(e.to_string()),
		}),
	}
}
