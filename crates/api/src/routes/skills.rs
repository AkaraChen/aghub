use aghub_core::{
	convert_skill, create_adapter,
	errors::ConfigError,
	load_all_agents,
	models::{AgentType, ResourceScope, Skill},
	registry, transfer,
};
use rocket::http::Status;
use rocket::response::status::NoContent;
use rocket::serde::json::Json;
use skill::sanitize::sanitize_name;
use std::collections::HashMap;

use crate::{
	dto::integrations::{
		CodeEditorType, EditSkillFolderRequest, OpenSkillFolderRequest,
	},
	dto::skill::{
		CreateSkillRequest, DeleteSkillByPathRequest,
		DeleteSkillByPathResponse, GitInstallRequest, GitInstallResponse,
		GitInstallResultEntry, GitScanRequest, GitScanResponse,
		GitScanSkillEntry, GitSyncRequest, GitSyncResponse,
		GlobalSkillLockResponse, InstallSkillRequest, InstallSkillResponse,
		LocalSkillLockEntryResponse, ProjectLockQuery,
		ProjectSkillLockResponse, SkillContentQuery, SkillLockEntryResponse,
		SkillResponse, SkillTreeNodeKind, SkillTreeNodeResponse,
		SkillTreeQuery, UpdateSkillRequest, ValidationError,
	},
	dto::transfer::{
		OperationBatchResponse, ReconcileRequest, TransferRequest,
	},
	error::{ApiCreated, ApiError, ApiNoContent, ApiResult},
	extractors::{AgentParam, ScopeParams},
	routes::{
		build_manager_from_resolved, require_writable_scope,
		resolved_to_resource_scope,
	},
	state::{GitCloneSession, GitCloneSessions},
};

fn expand_tilde_path(path: &str) -> std::path::PathBuf {
	if path.starts_with("~/") {
		dirs::home_dir()
			.map(|home| home.join(&path[2..]))
			.unwrap_or_else(|| path.into())
	} else {
		path.into()
	}
}

async fn list_branches_for_scan<F>(
	cached_branches: Option<Vec<String>>,
	fetcher: F,
) -> Result<Vec<String>, ApiError>
where
	F: FnOnce() -> aghub_git::Result<Vec<String>> + Send + 'static,
{
	if let Some(cached) = cached_branches {
		return Ok(cached);
	}

	tokio::task::spawn_blocking(fetcher)
		.await
		.map_err(|e| {
			ApiError::new(
				Status::InternalServerError,
				format!("Branch listing task panicked: {e}"),
				"BRANCHES_ERROR",
			)
		})?
		.map_err(|e| {
			ApiError::new(
				Status::BadRequest,
				format!("Failed to list remote branches: {e}"),
				"BRANCHES_ERROR",
			)
		})
}

#[post("/skills/transfer", data = "<body>")]
pub fn transfer_skill_route(
	body: Json<TransferRequest>,
) -> ApiResult<OperationBatchResponse> {
	let req = body.into_inner();
	let source = req.source.to_core()?;
	let destinations = req
		.destinations
		.iter()
		.map(|target| target.to_core())
		.collect::<Result<Vec<_>, _>>()?;
	let result = transfer::transfer_skill(source, destinations)
		.map_err(ApiError::from)?;
	Ok(Json(result.into()))
}

#[post("/skills/reconcile", data = "<body>")]
pub fn reconcile_skill_route(
	body: Json<ReconcileRequest>,
) -> ApiResult<OperationBatchResponse> {
	let req = body.into_inner();
	let source = req.source.to_core()?;

	let added: Vec<AgentType> = req
		.added
		.unwrap_or_default()
		.iter()
		.map(|agent_str| {
			agent_str.parse().map_err(|_| {
				ApiError::new(
					rocket::http::Status::BadRequest,
					format!("Unknown agent '{agent_str}'"),
					"INVALID_PARAM",
				)
			})
		})
		.collect::<Result<Vec<AgentType>, _>>()?;

	let removed: Vec<AgentType> = req
		.removed
		.unwrap_or_default()
		.iter()
		.map(|agent_str| {
			agent_str.parse().map_err(|_| {
				ApiError::new(
					rocket::http::Status::BadRequest,
					format!("Unknown agent '{agent_str}'"),
					"INVALID_PARAM",
				)
			})
		})
		.collect::<Result<Vec<AgentType>, _>>()?;

	let result = transfer::reconcile_skill(source, added, removed)
		.map_err(ApiError::from)?;

	Ok(Json(result.into()))
}

#[delete("/skills/by-path", data = "<body>")]
pub fn delete_skill_by_path(
	body: Json<DeleteSkillByPathRequest>,
) -> ApiResult<DeleteSkillByPathResponse> {
	let req = body.into_inner();

	let skill_path = expand_tilde_path(&req.source_path);
	let skill_dir = if skill_path.is_dir() {
		skill_path
	} else {
		skill_path
			.parent()
			.map(|p| p.to_path_buf())
			.unwrap_or(skill_path)
	};

	let resource_scope = match req.scope.as_str() {
		"global" => aghub_core::models::ResourceScope::GlobalOnly,
		"project" => aghub_core::models::ResourceScope::ProjectOnly,
		_ => {
			return Ok(Json(DeleteSkillByPathResponse {
				success: false,
				deleted_path: None,
				error: Some(format!("Invalid scope: {}", req.scope)),
				validation_errors: None,
			}));
		}
	};

	if resource_scope == aghub_core::models::ResourceScope::ProjectOnly
		&& req.project_root.is_none()
	{
		return Ok(Json(DeleteSkillByPathResponse {
			success: false,
			deleted_path: None,
			error: Some(
				"project_root is required when scope is 'project'".to_string(),
			),
			validation_errors: None,
		}));
	}

	let project_root = req.project_root.as_ref().map(std::path::PathBuf::from);

	let mut validation_errors = Vec::new();

	for agent_str in &req.agents {
		let agent: AgentType = match agent_str.parse() {
			Ok(a) => a,
			Err(_) => {
				validation_errors.push(ValidationError {
					agent: agent_str.clone(),
					reason: format!("Unknown agent: {agent_str}"),
				});
				continue;
			}
		};

		let adapter = aghub_core::create_adapter(agent);
		let skills_paths =
			adapter.get_skills_paths(project_root.as_deref(), resource_scope);

		let is_valid = skills_paths
			.iter()
			.any(|sp| skill_dir.starts_with(sp) || skill_dir == *sp);

		if !is_valid {
			let valid_paths: Vec<String> = skills_paths
				.iter()
				.map(|p| p.display().to_string())
				.collect();
			validation_errors.push(ValidationError {
				agent: agent_str.clone(),
				reason: format!(
					"Path '{}' is not in agent's skills directories: {}",
					skill_dir.display(),
					valid_paths.join(", ")
				),
			});
		}
	}

	if !validation_errors.is_empty() {
		return Ok(Json(DeleteSkillByPathResponse {
			success: false,
			deleted_path: None,
			error: Some("Validation failed for one or more agents".to_string()),
			validation_errors: Some(validation_errors),
		}));
	}

	if !skill_dir.exists() {
		return Ok(Json(DeleteSkillByPathResponse {
			success: true,
			deleted_path: Some(skill_dir.display().to_string()),
			error: None,
			validation_errors: None,
		}));
	}

	match std::fs::remove_dir_all(&skill_dir) {
		Ok(_) => Ok(Json(DeleteSkillByPathResponse {
			success: true,
			deleted_path: Some(skill_dir.display().to_string()),
			error: None,
			validation_errors: None,
		})),
		Err(e) => Ok(Json(DeleteSkillByPathResponse {
			success: false,
			deleted_path: None,
			error: Some(format!("Failed to delete: {e}")),
			validation_errors: None,
		})),
	}
}

fn get_parent_folder(path: std::path::PathBuf) -> std::path::PathBuf {
	path.parent().map(|p| p.to_path_buf()).unwrap_or(path)
}

fn get_skill_root(path: std::path::PathBuf) -> std::path::PathBuf {
	if path.is_dir() {
		path
	} else {
		get_parent_folder(path)
	}
}

fn copy_dir_recursive(
	from: &std::path::Path,
	to: &std::path::Path,
) -> Result<(), ApiError> {
	std::fs::create_dir_all(to)
		.map_err(|e| ApiError::from(ConfigError::Io(e)))?;
	for entry in std::fs::read_dir(from)
		.map_err(|e| ApiError::from(ConfigError::Io(e)))?
	{
		let entry = entry.map_err(|e| ApiError::from(ConfigError::Io(e)))?;
		let from_path = entry.path();
		let to_path = to.join(entry.file_name());
		let file_type = entry
			.file_type()
			.map_err(|e| ApiError::from(ConfigError::Io(e)))?;
		if file_type.is_dir() {
			copy_dir_recursive(&from_path, &to_path)?;
		} else {
			std::fs::copy(&from_path, &to_path)
				.map_err(|e| ApiError::from(ConfigError::Io(e)))?;
		}
	}
	Ok(())
}

fn resolve_git_install_target_dir(
	agent_type: AgentType,
	resource_scope: ResourceScope,
	project_root: Option<&std::path::PathBuf>,
) -> Option<std::path::PathBuf> {
	create_adapter(agent_type)
		.target_skills_dir(project_root.map(|p| p.as_path()), resource_scope)
}

fn install_git_skill_to_dir(
	full_path: &std::path::Path,
	target_dir: &std::path::Path,
) -> Result<String, ApiError> {
	let parsed = skill::parser::parse(full_path).map_err(|e| {
		ApiError::new(
			Status::BadRequest,
			format!("Failed to parse skill: {e}"),
			"SKILL_PARSE_FAILED",
		)
	})?;
	let skill = convert_skill(parsed);
	let safe_name = sanitize_name(&skill.name);
	let dest_root = target_dir.join(&safe_name);

	if !dest_root.exists() {
		let source_root = get_skill_root(full_path.to_path_buf());
		copy_dir_recursive(&source_root, &dest_root)?;
	}

	Ok(skill.name)
}

type GitInstallAgentGroup = Vec<(String, AgentType)>;
type GitInstallGroups = HashMap<std::path::PathBuf, GitInstallAgentGroup>;
type GitInstallInvalidAgent = (String, Option<AgentType>, String);

fn build_git_install_groups(
	agents: &[String],
	resource_scope: ResourceScope,
	project_root: Option<&std::path::PathBuf>,
) -> (GitInstallGroups, Vec<GitInstallInvalidAgent>) {
	let mut groups = HashMap::new();
	let mut invalid = Vec::new();

	for agent_str in agents {
		let agent_type: AgentType = match agent_str.parse() {
			Ok(agent) => agent,
			Err(_) => {
				invalid.push((
					agent_str.clone(),
					None,
					format!("Unknown agent '{agent_str}'"),
				));
				continue;
			}
		};

		let Some(target_dir) = resolve_git_install_target_dir(
			agent_type,
			resource_scope,
			project_root,
		) else {
			invalid.push((
				agent_str.clone(),
				Some(agent_type),
				format!(
					"Agent '{}' does not support persistent skill creation \
					 in this scope",
					agent_str
				),
			));
			continue;
		};

		groups
			.entry(target_dir)
			.or_insert_with(Vec::new)
			.push((agent_str.clone(), agent_type));
	}

	(groups, invalid)
}

fn detect_available_editor() -> Option<CodeEditorType> {
	crate::editor_detection::detect_any_installed_editor()
}

fn build_skill_tree_node(
	path: &std::path::Path,
) -> Result<SkillTreeNodeResponse, ApiError> {
	let metadata = std::fs::metadata(path).map_err(|e| {
		ApiError::new(
			Status::NotFound,
			format!("Failed to read skill path metadata: {e}"),
			"SKILL_PATH_NOT_FOUND",
		)
	})?;

	let name = path
		.file_name()
		.map(|name| name.to_string_lossy().to_string())
		.unwrap_or_else(|| path.display().to_string());

	if metadata.is_dir() {
		let mut entries: Vec<_> = std::fs::read_dir(path)
			.map_err(|e| {
				ApiError::new(
					Status::NotFound,
					format!("Failed to read skill directory: {e}"),
					"SKILL_DIRECTORY_NOT_FOUND",
				)
			})?
			.filter_map(|entry| entry.ok())
			.collect();

		entries.sort_by(|a, b| {
			let a_is_dir =
				a.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
			let b_is_dir =
				b.file_type().map(|kind| kind.is_dir()).unwrap_or(false);

			b_is_dir.cmp(&a_is_dir).then_with(|| {
				a.file_name()
					.to_string_lossy()
					.to_lowercase()
					.cmp(&b.file_name().to_string_lossy().to_lowercase())
			})
		});

		let children = entries
			.into_iter()
			.map(|entry| build_skill_tree_node(&entry.path()))
			.collect::<Result<Vec<_>, _>>()?;

		return Ok(SkillTreeNodeResponse {
			name,
			path: path.display().to_string(),
			kind: SkillTreeNodeKind::Directory,
			children,
		});
	}

	Ok(SkillTreeNodeResponse {
		name,
		path: path.display().to_string(),
		kind: SkillTreeNodeKind::File,
		children: Vec::new(),
	})
}
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

fn check_skills_supported(
	agent: &AgentParam,
	scope: ResourceScope,
) -> Result<(), ApiError> {
	let descriptor = registry::get(agent.0);
	if !descriptor.supports_skill_scope(scope) {
		return Err(ApiError::new(
			Status::UnprocessableEntity,
			format!(
				"Agent '{}' does not support skills in {:?} scope",
				descriptor.id, scope
			),
			"UNSUPPORTED_OPERATION",
		));
	}
	Ok(())
}

fn check_skills_mutable(
	agent: &AgentParam,
	scope: ResourceScope,
) -> Result<(), ApiError> {
	check_skills_supported(agent, scope)?;
	Ok(())
}

#[get("/agents/<agent>/skills?<scope..>")]
pub fn list_skills(
	agent: AgentParam,
	scope: ScopeParams,
) -> ApiResult<Vec<SkillResponse>> {
	let resolved = scope.resolve()?;
	let (resource_scope, _) = resolved_to_resource_scope(&resolved);
	check_skills_supported(&agent, resource_scope)?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;

	if resolved.is_all() {
		let (skills, _, _) =
			manager.load_both_annotated().map_err(ApiError::from)?;
		let items = skills.iter().map(SkillResponse::from).collect();
		return Ok(Json(items));
	}

	let config = manager.load().map_err(ApiError::from)?;
	let skills = config.skills.iter().map(SkillResponse::from).collect();
	Ok(Json(skills))
}

#[post("/agents/<agent>/skills?<scope..>", data = "<body>")]
pub fn create_skill(
	agent: AgentParam,
	scope: ScopeParams,
	body: Json<CreateSkillRequest>,
) -> ApiCreated<SkillResponse> {
	let resolved = scope.resolve()?;
	let (resource_scope, _) = resolved_to_resource_scope(&resolved);
	check_skills_mutable(&agent, resource_scope)?;
	require_writable_scope(&resolved)?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;
	match manager.load() {
		Ok(_) => {}
		Err(ConfigError::NotFound { .. }) => manager.init_empty_config(),
		Err(e) => return Err(ApiError::from(e)),
	}
	let skill = Skill::from(body.into_inner());
	let response = SkillResponse::from(&skill);
	manager.add_skill(skill).map_err(ApiError::from)?;
	Ok((Status::Created, Json(response)))
}

#[post("/agents/<agent>/skills/import?<scope..>", data = "<body>")]
pub fn import_skill(
	agent: AgentParam,
	scope: ScopeParams,
	body: Json<crate::dto::skill::ImportSkillRequest>,
) -> ApiResult<SkillResponse> {
	let resolved = scope.resolve()?;
	let (resource_scope, _) = resolved_to_resource_scope(&resolved);
	check_skills_mutable(&agent, resource_scope)?;
	require_writable_scope(&resolved)?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;

	// Load configuration before adding skill
	manager.load().map_err(ApiError::from)?;

	let imported = manager
		.add_skill_from_path(std::path::Path::new(&body.path))
		.map_err(ApiError::from)?;

	Ok(Json(SkillResponse::from(&imported)))
}

#[get("/agents/<agent>/skills/<name>?<scope..>")]
pub fn get_skill(
	agent: AgentParam,
	name: &str,
	scope: ScopeParams,
) -> ApiResult<SkillResponse> {
	let resolved = scope.resolve()?;
	let (resource_scope, _) = resolved_to_resource_scope(&resolved);
	check_skills_supported(&agent, resource_scope)?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;

	if resolved.is_all() {
		let (skills, _, _) =
			manager.load_both_annotated().map_err(ApiError::from)?;
		let skill =
			skills.iter().find(|s| s.name == name).ok_or_else(|| {
				ApiError::from(ConfigError::resource_not_found("skill", name))
			})?;
		return Ok(Json(SkillResponse::from(skill)));
	}

	manager.load().map_err(ApiError::from)?;
	let skill = manager.get_skill(name).ok_or_else(|| {
		ApiError::from(ConfigError::resource_not_found("skill", name))
	})?;
	Ok(Json(SkillResponse::from(skill)))
}

#[put("/agents/<agent>/skills/<name>?<scope..>", data = "<body>")]
pub fn update_skill(
	agent: AgentParam,
	name: &str,
	scope: ScopeParams,
	body: Json<UpdateSkillRequest>,
) -> ApiResult<SkillResponse> {
	let resolved = scope.resolve()?;
	let (resource_scope, _) = resolved_to_resource_scope(&resolved);
	check_skills_mutable(&agent, resource_scope)?;
	require_writable_scope(&resolved)?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;
	manager.load().map_err(ApiError::from)?;
	let existing = manager
		.get_skill(name)
		.ok_or_else(|| {
			ApiError::from(ConfigError::resource_not_found("skill", name))
		})?
		.clone();
	let updated = body.into_inner().apply_to(existing);
	let response = SkillResponse::from(&updated);
	manager
		.update_skill(name, updated)
		.map_err(ApiError::from)?;
	Ok(Json(response))
}

#[delete("/agents/<agent>/skills/<name>?<scope..>")]
pub fn delete_skill(
	agent: AgentParam,
	name: &str,
	scope: ScopeParams,
) -> ApiNoContent {
	let resolved = scope.resolve()?;
	let (resource_scope, _) = resolved_to_resource_scope(&resolved);
	check_skills_mutable(&agent, resource_scope)?;
	require_writable_scope(&resolved)?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;
	manager.load().map_err(ApiError::from)?;
	manager.remove_skill(name).map_err(ApiError::from)?;
	Ok(NoContent)
}

#[post("/agents/<agent>/skills/<name>/enable?<scope..>")]
pub fn enable_skill(
	agent: AgentParam,
	name: &str,
	scope: ScopeParams,
) -> ApiResult<SkillResponse> {
	let resolved = scope.resolve()?;
	let (resource_scope, _) = resolved_to_resource_scope(&resolved);
	check_skills_supported(&agent, resource_scope)?;
	require_writable_scope(&resolved)?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;
	manager.load().map_err(ApiError::from)?;
	manager.enable_skill(name).map_err(ApiError::from)?;
	let skill = manager.get_skill(name).expect("skill present after enable");
	Ok(Json(SkillResponse::from(skill)))
}

#[post("/agents/<agent>/skills/<name>/disable?<scope..>")]
pub fn disable_skill(
	agent: AgentParam,
	name: &str,
	scope: ScopeParams,
) -> ApiResult<SkillResponse> {
	let resolved = scope.resolve()?;
	let (resource_scope, _) = resolved_to_resource_scope(&resolved);
	check_skills_supported(&agent, resource_scope)?;
	require_writable_scope(&resolved)?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;
	manager.load().map_err(ApiError::from)?;
	manager.disable_skill(name).map_err(ApiError::from)?;
	let skill = manager
		.get_skill(name)
		.expect("skill present after disable");
	Ok(Json(SkillResponse::from(skill)))
}

#[get("/agents/all/skills?<scope..>")]
pub fn list_all_agents_skills(
	scope: ScopeParams,
) -> ApiResult<Vec<SkillResponse>> {
	let resolved = scope.resolve()?;
	let (resource_scope, project_root) = resolved_to_resource_scope(&resolved);
	let items = load_all_agents(resource_scope, project_root.as_deref())
		.into_iter()
		.flat_map(|ar| {
			let id = ar.agent_id;
			ar.skills
				.into_iter()
				.map(move |s| SkillResponse::from((s, id)))
		})
		.collect();
	Ok(Json(items))
}

#[post("/skills/install", data = "<body>")]
pub async fn install_skill(
	body: Json<InstallSkillRequest>,
) -> ApiResult<InstallSkillResponse> {
	let req = body.into_inner();

	#[cfg(target_os = "windows")]
	let npx_cmd = "npx.cmd";
	#[cfg(not(target_os = "windows"))]
	let npx_cmd = "npx";

	let mut cmd = Command::new(npx_cmd);
	cmd.arg("skills").arg("add").arg(&req.source);

	// When install_all is true, omit -s flag to install all skills from source
	if !req.install_all.unwrap_or(false) {
		for skill in &req.skills {
			cmd.arg("-s").arg(skill);
		}
	}

	for agent_id in &req.agents {
		if let Ok(agent_type) = agent_id.parse::<AgentType>() {
			let descriptor = registry::get(agent_type);
			if let Some(cli_name) = descriptor.skills_cli_name {
				cmd.arg("-a").arg(cli_name);
			}
		}
	}

	if req.scope == "global" {
		cmd.arg("-g");
	}

	cmd.arg("-y");

	if let Some(ref path) = req.project_path {
		cmd.current_dir(path);
	}

	cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

	let output = match timeout(Duration::from_secs(300), cmd.output()).await {
		Ok(Ok(output)) => output,
		Ok(Err(e)) => {
			return Err(ApiError::new(
				Status::InternalServerError,
				format!("Failed to execute skills CLI: {e}"),
				"SKILLS_CLI_ERROR",
			));
		}
		Err(_) => {
			return Err(ApiError::new(
				Status::RequestTimeout,
				"Skills installation timed out after 5 minutes".to_string(),
				"SKILLS_INSTALL_TIMEOUT",
			));
		}
	};

	let stdout = String::from_utf8_lossy(&output.stdout).to_string();
	let stderr = String::from_utf8_lossy(&output.stderr).to_string();
	let exit_code = output.status.code().unwrap_or(-1);

	Ok(Json(InstallSkillResponse {
		success: output.status.success(),
		stdout,
		stderr,
		exit_code,
	}))
}

#[post("/skills/open", format = "json", data = "<request>")]
pub async fn open_skill_folder(
	request: Json<OpenSkillFolderRequest>,
) -> Result<(), String> {
	let req = request.into_inner();
	let path = expand_tilde_path(&req.skill_path);
	let folder = get_parent_folder(path);

	match open::that(&folder) {
		Ok(_) => Ok(()),
		Err(e) => Err(format!("Failed to open folder: {e}")),
	}
}

#[post("/skills/edit", format = "json", data = "<request>")]
pub async fn edit_skill_folder(
	request: Json<EditSkillFolderRequest>,
) -> Result<(), String> {
	let req = request.into_inner();
	let path = expand_tilde_path(&req.skill_path);
	let folder = get_parent_folder(path);

	match detect_available_editor() {
		Some(editor) => {
			match std::process::Command::new(editor.cli_command())
				.arg(&folder)
				.spawn()
			{
				Ok(_) => Ok(()),
				Err(e) => Err(format!("Failed to open editor: {e}")),
			}
		}
		None => {
			let editor_names: Vec<&str> = CodeEditorType::all()
				.iter()
				.map(|e| e.display_name())
				.collect();
			Err(format!(
				"No supported code editor found. Please install {}.",
				editor_names.join(", ")
			))
		}
	}
}

#[get("/skills/content?<query..>")]
pub fn get_skill_content(query: SkillContentQuery) -> ApiResult<String> {
	let path = expand_tilde_path(&query.path);
	let content = std::fs::read_to_string(&path).map_err(|e| {
		ApiError::new(
			Status::NotFound,
			format!("Failed to read skill file: {e}"),
			"SKILL_FILE_NOT_FOUND",
		)
	})?;

	// Use the proper skill parser to extract the body content
	let skill = skill::parser::parse_skill_md(&content).map_err(|e| {
		ApiError::new(
			Status::BadRequest,
			format!("Invalid skill format: {e}"),
			"INVALID_SKILL_FORMAT",
		)
	})?;

	Ok(Json(skill.content))
}

#[get("/skills/tree?<query..>")]
pub fn get_skill_tree(
	query: SkillTreeQuery,
) -> ApiResult<SkillTreeNodeResponse> {
	let path = expand_tilde_path(&query.path);
	let root = get_skill_root(path);
	let tree = build_skill_tree_node(&root)?;
	Ok(Json(tree))
}

#[get("/skills/lock/global")]
pub fn get_global_skill_lock() -> ApiResult<GlobalSkillLockResponse> {
	let lock = skill::lock::global::read_skill_lock();
	let skills: Vec<SkillLockEntryResponse> = lock
		.skills
		.into_iter()
		.map(|(name, entry)| SkillLockEntryResponse {
			name,
			source: entry.source,
			source_type: entry.source_type,
			source_url: entry.source_url,
			skill_path: entry.skill_path,
			skill_folder_hash: entry.skill_folder_hash,
			installed_at: entry.installed_at,
			updated_at: entry.updated_at,
			plugin_name: entry.plugin_name,
		})
		.collect();

	Ok(Json(GlobalSkillLockResponse {
		version: lock.version,
		skills,
		last_selected_agents: lock.last_selected_agents,
	}))
}

#[get("/skills/lock/project?<query..>")]
pub fn get_project_skill_lock(
	query: ProjectLockQuery,
) -> ApiResult<ProjectSkillLockResponse> {
	let cwd = query.project_path.as_deref().map(std::path::Path::new);
	let lock = skill::lock::local::read_local_lock(cwd);
	let skills: Vec<LocalSkillLockEntryResponse> = lock
		.skills
		.into_iter()
		.map(|(name, entry)| LocalSkillLockEntryResponse {
			name,
			source: entry.source,
			source_type: entry.source_type,
			computed_hash: entry.computed_hash,
		})
		.collect();

	Ok(Json(ProjectSkillLockResponse {
		version: lock.version,
		skills,
	}))
}

#[post("/skills/git/scan", data = "<body>")]
pub async fn git_scan_skills(
	body: Json<GitScanRequest>,
	sessions: &rocket::State<GitCloneSessions>,
) -> ApiResult<GitScanResponse> {
	let req = body.into_inner();

	// Resolve credential token — either from session or from request
	let credential_token: Option<String> =
		if let Some(ref cred_id) = req.credential_id {
			let creds = crate::routes::credentials::load_credentials()
				.map_err(|e| {
					ApiError::new(
						Status::InternalServerError,
						format!("Failed to read credentials: {e}"),
						"KEYCHAIN_ERROR",
					)
				})?;
			let cred =
				creds.iter().find(|c| c.id == *cred_id).ok_or_else(|| {
					ApiError::new(
						Status::NotFound,
						"Credential not found",
						"CREDENTIAL_NOT_FOUND",
					)
				})?;
			Some(cred.token.clone())
		} else if let Some(ref sid) = req.session_id {
			// Reuse credential from existing session
			let map = sessions.sessions.lock().unwrap();
			map.get(sid).and_then(|s| s.credential_token.clone())
		} else {
			None
		};

	// Retrieve cached branches from existing session if re-scanning
	let cached_branches: Option<Vec<String>> =
		if let Some(ref sid) = req.session_id {
			let map = sessions.sessions.lock().unwrap();
			map.get(sid).map(|s| s.branches.clone())
		} else {
			None
		};

	let url = req.url.clone();
	let branch = req.branch.clone();
	let token_for_clone = credential_token.clone();

	// Clone repo in a blocking thread (gix is synchronous)
	let temp_dir = tokio::task::spawn_blocking(move || {
		let mut options = aghub_git::CloneOptions::new(&url);
		if let Some(token) = token_for_clone {
			options = options.with_credentials("x-access-token", token);
		}
		if let Some(ref branch) = branch {
			options = options.with_branch(branch);
		}
		aghub_git::clone_to_temp(options)
	})
	.await
	.map_err(|e| {
		ApiError::new(
			Status::InternalServerError,
			format!("Clone task panicked: {e}"),
			"CLONE_ERROR",
		)
	})?
	.map_err(|e| {
		ApiError::new(
			Status::BadRequest,
			format!("Failed to clone repository: {e}"),
			"CLONE_FAILED",
		)
	})?;

	// List remote branches (use cache from previous session if
	// available to avoid an extra network call on branch switch)
	let branch_url = req.url.clone();
	let credential_token_for_branches = credential_token.clone();
	let branches = list_branches_for_scan(cached_branches, move || {
		let options = match credential_token_for_branches {
			Some(token) => aghub_git::RemoteOptions::new(&branch_url)
				.with_credentials("x-access-token", token),
			None => aghub_git::RemoteOptions::new(&branch_url),
		};
		aghub_git::list_remote_branches(options)
	})
	.await?;

	// Determine current branch name from the checked-out HEAD
	let current_branch =
		detect_current_branch(temp_dir.path()).unwrap_or_else(|| {
			req.branch.clone().unwrap_or_else(|| {
				// Guess from the branches list — first one
				// alphabetically that looks like a default
				["main", "master"]
					.iter()
					.find(|b| branches.contains(&b.to_string()))
					.map(|b| b.to_string())
					.unwrap_or_default()
			})
		});

	// Scan the cloned repo for skills
	let scan_options = skill::scan::ScanOptions {
		max_depth: 10,
		full_depth: true,
		respect_gitignore: true,
	};
	let temp_path = temp_dir.path().to_path_buf();
	let skill_paths =
		skill::scan::scan_skills(&temp_path, scan_options, vec![]).map_err(
			|e| {
				ApiError::new(
					Status::InternalServerError,
					format!("Failed to scan repository for skills: {e:?}"),
					"SCAN_ERROR",
				)
			},
		)?;

	// Parse each skill to extract metadata
	let mut skills = Vec::new();
	for path in &skill_paths {
		match skill::parser::parse(path) {
			Ok(parsed) => {
				let relative = path
					.strip_prefix(&temp_path)
					.unwrap_or(path)
					.to_string_lossy()
					.to_string();
				skills.push(GitScanSkillEntry {
					name: parsed.name,
					description: parsed.description,
					author: parsed.author,
					version: parsed.version,
					path: relative,
				});
			}
			Err(_) => {
				// Skip unparseable skill directories
			}
		}
	}

	// Remove old session if re-scanning
	if let Some(ref old_sid) = req.session_id {
		let mut map = sessions.sessions.lock().unwrap();
		map.remove(old_sid);
	}

	// Store the temp dir in session map so it persists until install
	let session_id = uuid::Uuid::new_v4().to_string();
	{
		let mut map = sessions.sessions.lock().unwrap();
		// Purge sessions older than 30 minutes
		let cutoff = std::time::Duration::from_secs(30 * 60);
		map.retain(|_, s| s.created_at.elapsed() < cutoff);
		map.insert(
			session_id.clone(),
			GitCloneSession {
				temp_dir,
				created_at: std::time::Instant::now(),
				url: req.url,
				credential_token,
				branches: branches.clone(),
				current_branch: current_branch.clone(),
			},
		);
	}

	Ok(Json(GitScanResponse {
		session_id,
		skills,
		branches,
		current_branch,
	}))
}

/// Try to detect the checked-out branch from the cloned repo.
fn detect_current_branch(repo_path: &std::path::Path) -> Option<String> {
	let output = std::process::Command::new("git")
		.args(["rev-parse", "--abbrev-ref", "HEAD"])
		.current_dir(repo_path)
		.output()
		.ok()?;

	if !output.status.success() {
		return None;
	}

	let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
	if name.is_empty() || name == "HEAD" {
		None
	} else {
		Some(name)
	}
}

#[post("/skills/git/install", data = "<body>")]
pub async fn git_install_skills(
	body: Json<GitInstallRequest>,
	sessions: &rocket::State<GitCloneSessions>,
) -> ApiResult<GitInstallResponse> {
	let req = body.into_inner();

	// Extract temp dir path from session
	let temp_path = {
		let map = sessions.sessions.lock().unwrap();
		let session = map.get(&req.session_id).ok_or_else(|| {
			ApiError::new(
				Status::NotFound,
				"Session not found or expired",
				"SESSION_NOT_FOUND",
			)
		})?;
		session.temp_dir.path().to_path_buf()
	};

	let resource_scope = match req.scope.as_str() {
		"global" => ResourceScope::GlobalOnly,
		"project" => ResourceScope::ProjectOnly,
		other => {
			return Err(ApiError::new(
				Status::BadRequest,
				format!("Invalid scope '{other}'. Use 'global' or 'project'"),
				"INVALID_PARAM",
			));
		}
	};

	let project_root: Option<std::path::PathBuf> =
		req.project_root.as_ref().map(std::path::PathBuf::from);

	let mut results = Vec::new();

	let (dir_groups, invalid_agents) = build_git_install_groups(
		&req.agents,
		resource_scope,
		project_root.as_ref(),
	);

	for (agent_str, _, error) in invalid_agents {
		for skill_path in &req.skill_paths {
			results.push(GitInstallResultEntry {
				name: skill_path.clone(),
				agent: agent_str.clone(),
				success: false,
				error: Some(error.clone()),
			});
		}
	}

	for skill_path in &req.skill_paths {
		let full_path = temp_path.join(skill_path);

		for (target_dir, agents) in &dir_groups {
			match install_git_skill_to_dir(&full_path, target_dir) {
				Ok(skill_name) => {
					for (agent_str, _) in agents {
						results.push(GitInstallResultEntry {
							name: skill_name.clone(),
							agent: agent_str.clone(),
							success: true,
							error: None,
						});
					}
				}
				Err(e) => {
					for (agent_str, _) in agents {
						results.push(GitInstallResultEntry {
							name: skill_path.clone(),
							agent: agent_str.clone(),
							success: false,
							error: Some(e.body.error.clone()),
						});
					}
				}
			}
		}
	}

	// Remove session (drops TempDir, cleans up disk)
	{
		let mut map = sessions.sessions.lock().unwrap();
		map.remove(&req.session_id);
	}

	Ok(Json(GitInstallResponse { results }))
}

/// Replace existing skill installations in-place from a previously-scanned
/// git session.  Unlike `git_install_skills`, this endpoint accepts a list
/// of absolute (tilde-prefixed) `source_path` values and replaces the
/// directory at each one rather than deriving target directories from
/// agent identifiers.
#[post("/skills/git/sync", data = "<body>")]
pub async fn git_sync_skill(
	body: Json<GitSyncRequest>,
	sessions: &rocket::State<GitCloneSessions>,
) -> ApiResult<GitSyncResponse> {
	let req = body.into_inner();

	// Retrieve temp dir from session (keep session alive until end)
	let temp_path = {
		let map = sessions.sessions.lock().unwrap();
		let session = map.get(&req.session_id).ok_or_else(|| {
			ApiError::new(
				Status::NotFound,
				"Session not found or expired",
				"SESSION_NOT_FOUND",
			)
		})?;
		session.temp_dir.path().to_path_buf()
	};

	// Full path of the SKILL.md (or skill dir) inside the clone
	let cloned_skill_path = temp_path.join(&req.skill_path);
	let cloned_skill_dir = get_skill_root(cloned_skill_path.clone());

	if !cloned_skill_dir.exists() {
		return Err(ApiError::new(
			Status::NotFound,
			format!(
				"Skill path '{}' not found in cloned repository",
				req.skill_path
			),
			"SKILL_PATH_NOT_FOUND",
		));
	}

	// Parse skill name from the cloned copy
	let skill_name: Option<String> = skill::parser::parse(&cloned_skill_path)
		.ok()
		.map(|p| p.name);

	// Replace each installation path
	for source_path in &req.source_paths {
		let target_skill_md = expand_tilde_path(source_path);
		let target_dir = get_skill_root(target_skill_md);

		// Remove old content
		if target_dir.exists() {
			std::fs::remove_dir_all(&target_dir)
				.map_err(|e| ApiError::from(ConfigError::Io(e)))?;
		}

		// Copy new content
		copy_dir_recursive(&cloned_skill_dir, &target_dir)?;
	}

	// Remove session (drops TempDir, cleans up disk)
	{
		let mut map = sessions.sessions.lock().unwrap();
		map.remove(&req.session_id);
	}

	Ok(Json(GitSyncResponse {
		success: true,
		name: skill_name,
		error: None,
	}))
}

#[cfg(test)]
mod tests {
	use super::*;
	use aghub_core::transfer::{
		reconcile_skill, InstallScope, ResourceLocator,
	};
	use std::sync::{Mutex, OnceLock};
	use tempfile::tempdir;

	fn env_lock() -> &'static Mutex<()> {
		static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
		LOCK.get_or_init(|| Mutex::new(()))
	}

	#[test]
	fn git_install_groups_agents_by_primary_target_dir() {
		let project_root = std::path::PathBuf::from("/tmp/demo");
		let (groups, invalid) = build_git_install_groups(
			&["claude".into(), "opencode".into(), "codex".into()],
			ResourceScope::ProjectOnly,
			Some(&project_root),
		);

		assert!(invalid.is_empty());
		assert_eq!(groups.len(), 3);
		assert!(groups.contains_key(&project_root.join(".claude/skills")));
		assert!(groups.contains_key(&project_root.join(".opencode/skills")));
		assert!(groups.contains_key(&project_root.join(".agents/skills")));
	}

	#[test]
	fn git_install_marks_same_primary_dir_agents_success() {
		let _guard = env_lock().lock().unwrap();
		let temp = tempdir().unwrap();
		let target_dir = temp.path().join("shared");
		let source_dir = temp.path().join("source/hello-skill");
		std::fs::create_dir_all(&source_dir).unwrap();
		std::fs::write(
			source_dir.join("SKILL.md"),
			"---\nname: hello-skill\ndescription: hi\n---\n\n# Hello\n",
		)
		.unwrap();

		let result =
			install_git_skill_to_dir(&source_dir.join("SKILL.md"), &target_dir)
				.unwrap_or_else(|e| panic!("{}", e.body.error));
		assert_eq!(result, "hello-skill");
		assert!(target_dir.join("hello-skill/SKILL.md").exists());

		let second =
			install_git_skill_to_dir(&source_dir.join("SKILL.md"), &target_dir)
				.unwrap_or_else(|e| panic!("{}", e.body.error));
		assert_eq!(second, "hello-skill");
		assert!(target_dir.join("hello-skill/SKILL.md").exists());
	}

	#[test]
	fn reconcile_skill_prefers_primary_path_for_opencode() {
		let _guard = env_lock().lock().unwrap();
		let temp = tempdir().unwrap();
		let project_root = temp.path().join("project");
		std::fs::create_dir_all(&project_root).unwrap();

		let mut source_manager = aghub_core::ConfigManager::new(
			create_adapter(AgentType::Claude),
			false,
			Some(&project_root),
		);
		source_manager.load().unwrap();
		let mut skill = Skill::new("repo-helper");
		skill.description = Some("Copies files".to_string());
		source_manager.add_skill(skill).unwrap();
		let asset_dir = project_root.join(".claude/skills/repo-helper/assets");
		std::fs::create_dir_all(&asset_dir).unwrap();
		std::fs::write(asset_dir.join("notes.txt"), "hello").unwrap();

		let result = reconcile_skill(
			ResourceLocator {
				agent: AgentType::Claude,
				scope: InstallScope::Project,
				project_root: Some(project_root.clone()),
				name: "repo-helper".to_string(),
			},
			vec![AgentType::OpenCode],
			vec![],
		)
		.unwrap();

		assert_eq!(result.success_count(), 1);
		assert!(project_root
			.join(".opencode/skills/repo-helper/assets/notes.txt")
			.exists());
		assert!(!project_root.join(".agents/skills/repo-helper").exists());
	}

	#[test]
	fn list_branches_for_scan_returns_cached_without_fetching() {
		let runtime = tokio::runtime::Runtime::new().unwrap();
		let branches = runtime
			.block_on(list_branches_for_scan(
				Some(vec!["main".to_string()]),
				|| panic!("fetcher should not be called"),
			))
			.unwrap_or_else(|e| panic!("{}", e.body.error));
		assert_eq!(branches, vec!["main".to_string()]);
	}

	#[test]
	fn list_branches_for_scan_propagates_fetch_errors() {
		let runtime = tokio::runtime::Runtime::new().unwrap();
		let error = runtime
			.block_on(list_branches_for_scan(None, || {
				Err(aghub_git::GitError::clone_failed("boom"))
			}))
			.unwrap_err();
		assert_eq!(error.status, Status::BadRequest);
		assert_eq!(error.body.code, "BRANCHES_ERROR");
		assert!(error.body.error.contains("Failed to list remote branches"));
	}
}
