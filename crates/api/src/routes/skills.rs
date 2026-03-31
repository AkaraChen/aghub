use aghub_core::{
	errors::ConfigError,
	load_all_agents,
	models::{AgentType, Skill},
	registry, transfer,
};
use rocket::http::Status;
use rocket::response::status::NoContent;
use rocket::serde::json::Json;

use crate::{
	dto::integrations::{
		CodeEditorType, EditSkillFolderRequest, OpenSkillFolderRequest,
	},
	dto::skill::{
		CreateSkillRequest, DeleteSkillByPathRequest,
		DeleteSkillByPathResponse, GlobalSkillLockResponse,
		InstallSkillRequest, InstallSkillResponse, LocalSkillLockEntryResponse,
		ProjectSkillLockResponse, SkillLockEntryResponse, SkillResponse,
		SkillTreeNodeKind, SkillTreeNodeResponse, UpdateSkillRequest,
		ValidationError,
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
					format!("Unknown agent '{}'", agent_str),
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
					format!("Unknown agent '{}'", agent_str),
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
					reason: format!("Unknown agent: {}", agent_str),
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
			error: Some(format!("Failed to delete: {}", e)),
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

fn check_skills_supported(agent: &AgentParam) -> Result<(), ApiError> {
	let descriptor = registry::get(agent.0);
	if !descriptor.capabilities.skills {
		return Err(ApiError::new(
			Status::UnprocessableEntity,
			format!("Agent '{}' does not support skills", descriptor.id),
			"UNSUPPORTED_OPERATION",
		));
	}
	Ok(())
}

fn check_skills_mutable(agent: &AgentParam) -> Result<(), ApiError> {
	check_skills_supported(agent)?;
	Ok(())
}

#[get("/agents/<agent>/skills?<scope..>")]
pub fn list_skills(
	agent: AgentParam,
	scope: ScopeParams,
) -> ApiResult<Vec<SkillResponse>> {
	check_skills_supported(&agent)?;
	let resolved = scope.resolve()?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;

	if resolved.is_all() {
		let (skills, _) =
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
	check_skills_mutable(&agent)?;
	let resolved = scope.resolve()?;
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
	check_skills_mutable(&agent)?;
	let resolved = scope.resolve()?;
	require_writable_scope(&resolved)?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;

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
	check_skills_supported(&agent)?;
	let resolved = scope.resolve()?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;

	if resolved.is_all() {
		let (skills, _) =
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
	check_skills_mutable(&agent)?;
	let resolved = scope.resolve()?;
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
	check_skills_mutable(&agent)?;
	let resolved = scope.resolve()?;
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
	check_skills_supported(&agent)?;
	let resolved = scope.resolve()?;
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
	check_skills_supported(&agent)?;
	let resolved = scope.resolve()?;
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
		Err(e) => Err(format!("Failed to open folder: {}", e)),
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
				Err(e) => Err(format!("Failed to open editor: {}", e)),
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

#[derive(Debug, rocket::FromForm)]
pub struct SkillContentQuery {
	pub path: String,
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

#[derive(Debug, rocket::FromForm)]
pub struct SkillTreeQuery {
	pub path: String,
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

#[derive(Debug, rocket::FromForm)]
pub struct ProjectLockQuery {
	pub project_path: Option<String>,
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
