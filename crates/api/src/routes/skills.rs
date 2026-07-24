use aghub_cc_plugins::claude::ClaudePluginManager;
use aghub_core::{
	convert_skill, create_adapter,
	errors::ConfigError,
	load_all_agent_skill_locations,
	models::{AgentType, ResourceScope, Skill},
	registry, transfer,
};
use rocket::http::Status;
use rocket::response::status::NoContent;
use rocket::serde::json::Json;
use skill::sanitize::sanitize_name;
use std::{
	collections::{HashMap, HashSet},
	path::{Component, Path, PathBuf},
	time::Duration,
};
use tokio::time::timeout;

use crate::{
	auth::ApiAuth,
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
		ProjectSkillLockResponse, SkillContentQuery, SkillLinkResponse,
		SkillLinkStatusResponse, SkillLocationResponse, SkillLockEntryResponse,
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

#[cfg(test)]
use crate::dto::skill::{
	SkillDirectoryDiffResponse, SkillFileDiffKindResponse,
	SkillFileDiffResponse,
};

const SKILL_PATH_OUTSIDE_ROOT: &str = "SKILL_PATH_OUTSIDE_ROOT";
const SKILL_PATH_NOT_FOUND: &str = "SKILL_PATH_NOT_FOUND";
const INVALID_SKILL_PATH: &str = "INVALID_SKILL_PATH";
const SESSION_REMOTE_MISMATCH: &str = "SESSION_REMOTE_MISMATCH";
pub(crate) const MAX_SKILL_DIFF_TARGETS: usize = 32;
const MAX_SKILL_COPY_LOCATIONS: usize = MAX_SKILL_DIFF_TARGETS + 1;
pub(crate) const MAX_SKILL_COPY_RESOLUTION_TARGETS: usize =
	MAX_SKILL_COPY_LOCATIONS;
const MAX_SKILL_COPY_STATUS_GROUPS: usize = 256;
const MAX_SKILL_COPY_STATUS_PATHS: usize = 1024;
// A request may compare many small installations, but all hashing work shares
// one input budget so a batch cannot multiply the per-directory limit.
const MAX_SKILL_DIFF_BATCH_BYTES: u64 = 256 * 1024 * 1024;
// Resolution hashes the live and frozen reference plus every target before
// and after its backup move, fitting within twice the comparison budget.
const MAX_SKILL_COPY_RESOLUTION_BATCH_BYTES: u64 =
	MAX_SKILL_DIFF_BATCH_BYTES * 2;
// Freezing and staging share one write budget so a multi-target resolution
// cannot multiply a large reference into unbounded temporary disk usage.
pub(crate) const MAX_SKILL_COPY_RESOLUTION_BATCH_WRITE_BYTES: u64 =
	MAX_SKILL_COPY_RESOLUTION_BATCH_BYTES;
// Keep copied trees aligned with the entry, buffer, and VCS exclusions used by
// crates/skill/src/snapshot.rs when it defines a comparable skill version.
const MAX_SKILL_COPY_ENTRIES: usize = 10_000;
// A batch can compare every supported agent location while keeping response
// text small enough for an interactive desktop view.
const MAX_SKILL_DIFF_RESPONSE_PREVIEW_BYTES: usize = 4 * 1024 * 1024;
// Each batch reads two or more directory trees. Two workers avoid saturating
// local storage when multiple panels refresh together.
static SKILL_DIFF_PERMITS: tokio::sync::Semaphore =
	tokio::sync::Semaphore::const_new(2);
static SKILL_COPY_RESOLUTION_PERMITS: tokio::sync::Semaphore =
	tokio::sync::Semaphore::const_new(1);

#[derive(rocket::FromForm)]
pub(crate) struct SkillListParams {
	scope: Option<String>,
	project_root: Option<String>,
	include_managed: Option<bool>,
}

impl SkillListParams {
	fn resolve_scope(
		&self,
	) -> Result<crate::extractors::ResolvedScope, ApiError> {
		ScopeParams {
			scope: self.scope.clone(),
			project_root: self.project_root.clone(),
		}
		.resolve()
	}

	fn include_managed(&self) -> bool {
		self.include_managed.unwrap_or(false)
	}
}

mod locations;

use locations::*;

async fn detect_plugin_for_path(path: &std::path::Path) -> Option<String> {
	let plugins = ClaudePluginManager::new().await.ok()?;
	plugins
		.plugin_owning_path(path)
		.map(|plugin| plugin.display_name.clone())
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
	_auth: ApiAuth,
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
	_auth: ApiAuth,
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
pub async fn delete_skill_by_path(
	_auth: ApiAuth,
	body: Json<DeleteSkillByPathRequest>,
) -> ApiResult<DeleteSkillByPathResponse> {
	let req = body.into_inner();

	let skill_path = expand_tilde_path(&req.source_path);
	let skill_dir = requested_skill_dir(&skill_path);
	let canonical_skill_dir = match canonical_intended(&skill_dir) {
		Ok(path) => path,
		Err(e) => {
			return Ok(Json(DeleteSkillByPathResponse {
				success: false,
				deleted_path: None,
				error: Some(e.body.error),
				validation_errors: None,
			}));
		}
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

		let skills_paths = match canonical_skill_roots_for_agent(
			agent,
			resource_scope,
			project_root.as_deref(),
		) {
			Ok(paths) => paths,
			Err(e) => {
				validation_errors.push(ValidationError {
					agent: agent_str.clone(),
					reason: e.body.error,
				});
				continue;
			}
		};

		let is_valid = skills_paths
			.iter()
			.any(|sp| is_within(&canonical_skill_dir, sp));

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

	if let Some(plugin_name) = detect_plugin_for_path(&skill_dir).await {
		return Ok(Json(DeleteSkillByPathResponse {
			success: false,
			deleted_path: None,
			error: Some(format!(
				"Cannot delete plugin-managed skill from plugin '{plugin_name}'"
			)),
			validation_errors: None,
		}));
	}

	match remove_skill_dir_or_symlink(&skill_dir) {
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

mod copy;

use copy::*;

fn resolve_git_install_target_dir(
	agent_type: AgentType,
	resource_scope: ResourceScope,
	project_root: Option<&std::path::PathBuf>,
) -> Option<std::path::PathBuf> {
	create_adapter(agent_type)
		.target_skills_dir(project_root.map(|p| p.as_path()), resource_scope)
}

fn install_git_skill_to_dir(
	repository_root: &std::path::Path,
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

	match std::fs::symlink_metadata(&dest_root) {
		Ok(_) => {}
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			let source_root = get_skill_root(full_path.to_path_buf());
			replace_git_skill_dir_staged(
				repository_root,
				&source_root,
				&dest_root,
			)?;
		}
		Err(error) => return Err(ApiError::from(ConfigError::Io(error))),
	}

	Ok(skill.name)
}

type GitInstallAgentGroup = Vec<(String, AgentType)>;
type GitInstallGroups = HashMap<std::path::PathBuf, GitInstallAgentGroup>;
type GitInstallInvalidAgent = (String, Option<AgentType>, String);
const EMPTY_SKILLS_LOCK_DIGEST: &str =
	"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

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

fn parse_install_scope(scope: &str) -> Result<ResourceScope, ApiError> {
	match scope {
		"global" => Ok(ResourceScope::GlobalOnly),
		"project" => Ok(ResourceScope::ProjectOnly),
		other => Err(ApiError::new(
			Status::BadRequest,
			format!("Invalid scope '{other}'. Use 'global' or 'project'"),
			"INVALID_PARAM",
		)),
	}
}

fn map_remote_source_error(error: aghub_git::SourceError) -> ApiError {
	ApiError::new(
		Status::BadRequest,
		error.to_string(),
		"INVALID_SKILL_SOURCE",
	)
}

#[derive(Debug, PartialEq, Eq)]
struct RemoteIdentity {
	source_type: String,
	source: String,
}

fn remote_identity(url: &str) -> Result<RemoteIdentity, ApiError> {
	let resolved = aghub_git::resolve_remote_source(url)
		.map_err(map_remote_source_error)?;
	Ok(RemoteIdentity {
		source_type: resolved.source_type.as_str().to_string(),
		source: resolved.source,
	})
}

fn ensure_session_remote_matches(
	request_url: &str,
	session_url: &str,
) -> Result<(), ApiError> {
	let request = remote_identity(request_url)?;
	let session = remote_identity(session_url)?;
	if request == session {
		return Ok(());
	}

	Err(ApiError::new(
		Status::BadRequest,
		"Git scan session belongs to a different remote",
		SESSION_REMOTE_MISMATCH,
	))
}

fn normalize_scanned_skill_path(path: &str) -> Result<String, ApiError> {
	let normalized_separators = path.replace('\\', "/");
	let relative = Path::new(normalized_separators.trim());
	if relative.is_absolute() {
		return Err(skill_path_error(
			Status::BadRequest,
			format!("Invalid scanned skill path '{path}'"),
			INVALID_SKILL_PATH,
		));
	}

	let mut normalized = PathBuf::new();
	for component in relative.components() {
		match component {
			Component::Normal(part) => normalized.push(part),
			Component::CurDir => {}
			_ => {
				return Err(skill_path_error(
					Status::BadRequest,
					format!("Invalid scanned skill path '{path}'"),
					INVALID_SKILL_PATH,
				));
			}
		}
	}

	if normalized.as_os_str().is_empty() {
		return Ok(String::new());
	}

	Ok(normalized.to_string_lossy().replace('\\', "/"))
}

fn normalize_scanned_skill_path_from_file(
	path: &Path,
	root: &Path,
) -> Result<String, ApiError> {
	let relative = path.strip_prefix(root).map_err(|_| {
		skill_path_error(
			Status::InternalServerError,
			format!(
				"Scanned path '{}' is outside clone root '{}'",
				path.display(),
				root.display()
			),
			INVALID_SKILL_PATH,
		)
	})?;
	normalize_scanned_skill_path(&relative.to_string_lossy())
}

fn validate_scanned_skill_path(
	temp_path: &Path,
	scanned_paths: &HashSet<String>,
	requested_path: &str,
) -> Result<(String, PathBuf), ApiError> {
	let normalized = normalize_scanned_skill_path(requested_path)?;
	if !scanned_paths.contains(&normalized) {
		return Err(skill_path_error(
			Status::BadRequest,
			format!("Skill path '{requested_path}' was not returned by scan"),
			SKILL_PATH_OUTSIDE_ROOT,
		));
	}

	let clone_root = canonical_existing(temp_path)?;
	let full_path = temp_path.join(Path::new(&normalized));
	let canonical_full_path = canonical_existing(&full_path)?;
	ensure_path_under_roots(&canonical_full_path, &[clone_root])?;
	Ok((normalized, canonical_full_path))
}

fn validate_existing_skill_target_dir(
	source_path: &str,
	roots: &[PathBuf],
	known: &[KnownSkillPath],
) -> Result<PathBuf, ApiError> {
	let target_skill_md = expand_tilde_path(source_path);
	let target_dir = requested_skill_dir(&target_skill_md);
	let canonical_dir = canonical_existing(&target_dir)?;
	ensure_skill_tree_allowed(&canonical_dir, roots, known)?;
	Ok(target_dir)
}

fn existing_skill_entry_path(path: &Path) -> Result<PathBuf, ApiError> {
	let name = path.file_name().ok_or_else(|| {
		skill_path_error(
			Status::BadRequest,
			format!("Skill path '{}' has no file name", path.display()),
			INVALID_SKILL_PATH,
		)
	})?;
	let parent = canonical_existing_parent(path)?;
	let entry = parent.join(name);
	std::fs::symlink_metadata(&entry).map_err(|error| {
		let (status, code) = if error.kind() == std::io::ErrorKind::NotFound {
			(Status::NotFound, SKILL_PATH_NOT_FOUND)
		} else {
			(Status::BadRequest, INVALID_SKILL_PATH)
		};
		skill_path_error(
			status,
			format!(
				"Failed to inspect skill path '{}': {error}",
				entry.display()
			),
			code,
		)
	})?;
	Ok(entry)
}

fn map_repo_discovery_error(error: skill::RepoDiscoveryError) -> ApiError {
	match error {
		skill::RepoDiscoveryError::NoSkillsFound
		| skill::RepoDiscoveryError::SkillsNotFound { .. } => ApiError::new(
			Status::NotFound,
			error.to_string(),
			"SKILLS_NOT_FOUND",
		),
		skill::RepoDiscoveryError::Scan(_) => ApiError::new(
			Status::InternalServerError,
			error.to_string(),
			"SCAN_ERROR",
		),
		skill::RepoDiscoveryError::RelativePath { .. } => ApiError::new(
			Status::InternalServerError,
			error.to_string(),
			"SKILL_PATH_ERROR",
		),
	}
}

fn install_lock_source_from_resolved(
	source: &aghub_git::ResolvedRemoteSource,
	ref_name: Option<String>,
) -> skill::InstallLockSource {
	skill::InstallLockSource {
		source: source.lock_source(),
		source_type: source.source_type.as_str().to_string(),
		source_url: source.source_url.clone(),
		ref_name,
	}
}

fn write_skill_install_lock(
	skill_name: &str,
	resource_scope: ResourceScope,
	project_root: Option<&std::path::Path>,
	source: &skill::InstallLockSource,
	lock_skill_path: Option<String>,
) -> Result<(), ApiError> {
	match resource_scope {
		ResourceScope::GlobalOnly => {
			skill::write_global_install_lock(
				skill_name,
				source,
				lock_skill_path,
				Some(EMPTY_SKILLS_LOCK_DIGEST.to_string()),
			)
			.map_err(|e| {
				ApiError::new(
					Status::InternalServerError,
					format!("Failed to update global skill lock: {e}"),
					"SKILL_LOCK_ERROR",
				)
			})?;
		}
		ResourceScope::ProjectOnly => {
			let cwd = project_root.ok_or_else(|| {
				ApiError::new(
					Status::BadRequest,
					"project_path is required for project skill installs",
					"INVALID_PARAM",
				)
			})?;
			skill::write_project_install_lock(skill_name, source, cwd)
				.map_err(|e| {
					ApiError::new(
						Status::InternalServerError,
						format!("Failed to update project skill lock: {e}"),
						"SKILL_LOCK_ERROR",
					)
				})?;
		}
		ResourceScope::Both => {
			return Err(ApiError::new(
				Status::BadRequest,
				"Combined skill scope is not supported for installs",
				"INVALID_PARAM",
			));
		}
	}

	Ok(())
}

fn detect_available_editor() -> Option<CodeEditorType> {
	crate::editor_detection::detect_any_installed_editor()
}

fn build_skill_tree_node(
	root: &std::path::Path,
	path: &std::path::Path,
) -> Result<SkillTreeNodeResponse, ApiError> {
	let metadata = std::fs::symlink_metadata(path).map_err(|e| {
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
	if metadata.file_type().is_symlink() {
		let link = skill::link::inspect_skill_link(root, path)
			.map(skill_link_response)
			.map_err(|error| {
				ApiError::new(
					Status::BadRequest,
					format!("Failed to inspect skill link: {error}"),
					INVALID_SKILL_PATH,
				)
			})?;
		return Ok(SkillTreeNodeResponse {
			name,
			path: skill_tree_relative_path(root, path)?,
			kind: SkillTreeNodeKind::Symlink,
			children: Vec::new(),
			link: Some(link),
		});
	}

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
			.map(|entry| build_skill_tree_node(root, &entry.path()))
			.collect::<Result<Vec<_>, _>>()?;

		return Ok(SkillTreeNodeResponse {
			name,
			path: skill_tree_relative_path(root, path)?,
			kind: SkillTreeNodeKind::Directory,
			children,
			link: None,
		});
	}

	Ok(SkillTreeNodeResponse {
		name,
		path: skill_tree_relative_path(root, path)?,
		kind: SkillTreeNodeKind::File,
		children: Vec::new(),
		link: None,
	})
}

fn skill_tree_relative_path(
	root: &Path,
	path: &Path,
) -> Result<String, ApiError> {
	let relative = path.strip_prefix(root).map_err(|error| {
		ApiError::new(
			Status::InternalServerError,
			format!("Failed to build skill tree path: {error}"),
			"SKILL_TREE_PATH_FAILED",
		)
	})?;
	if relative.as_os_str().is_empty() {
		return Ok(".".to_string());
	}
	Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn skill_link_response(link: skill::link::SkillLink) -> SkillLinkResponse {
	SkillLinkResponse {
		target: link.display_target,
		status: match link.status {
			skill::link::SkillLinkStatus::Valid => {
				SkillLinkStatusResponse::Valid
			}
			skill::link::SkillLinkStatus::Broken => {
				SkillLinkStatusResponse::Broken
			}
			skill::link::SkillLinkStatus::OutsideRoot => {
				SkillLinkStatusResponse::OutsideRoot
			}
			skill::link::SkillLinkStatus::Unreadable => {
				SkillLinkStatusResponse::Unreadable
			}
		},
	}
}

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
	_auth: ApiAuth,
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
pub async fn create_skill(
	_auth: ApiAuth,
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
	_auth: ApiAuth,
	agent: AgentParam,
	scope: ScopeParams,
	body: Json<crate::dto::skill::ImportSkillRequest>,
) -> ApiResult<SkillResponse> {
	let resolved = scope.resolve()?;
	let (resource_scope, project_root) = resolved_to_resource_scope(&resolved);
	check_skills_mutable(&agent, resource_scope)?;
	require_writable_scope(&resolved)?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;
	let request = body.into_inner();

	// Load configuration before adding skill
	manager.load().map_err(ApiError::from)?;

	let imported = manager
		.add_skill_from_path(std::path::Path::new(&request.path))
		.map_err(ApiError::from)?;
	write_skill_install_lock(
		&imported.name,
		resource_scope,
		project_root.as_deref(),
		&skill::InstallLockSource {
			source: request.path.clone(),
			source_type: "local".to_string(),
			source_url: request.path,
			ref_name: None,
		},
		None,
	)?;

	Ok(Json(SkillResponse::from(&imported)))
}

#[get("/agents/<agent>/skills/<name>?<scope..>")]
pub fn get_skill(
	_auth: ApiAuth,
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
pub async fn update_skill(
	_auth: ApiAuth,
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
	ensure_skill_not_plugin_managed(&existing, "update").await?;
	let updated = body.into_inner().apply_to(existing);
	let response = SkillResponse::from(&updated);
	manager
		.update_skill(name, updated)
		.map_err(ApiError::from)?;
	Ok(Json(response))
}

#[delete("/agents/<agent>/skills/<name>?<scope..>")]
pub async fn delete_skill(
	_auth: ApiAuth,
	agent: AgentParam,
	name: &str,
	scope: ScopeParams,
) -> ApiNoContent {
	let resolved = scope.resolve()?;
	let (resource_scope, _) = resolved_to_resource_scope(&resolved);
	check_skills_mutable(&agent, resource_scope)?;
	require_writable_scope(&resolved)?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;
	match manager.load() {
		Ok(_) => {}
		Err(ConfigError::NotFound { .. }) => return Ok(NoContent),
		Err(e) => return Err(ApiError::from(e)),
	}
	if let Some(skill) = manager.get_skill(name) {
		ensure_skill_not_plugin_managed(skill, "delete").await?;
	}
	match manager.remove_skill(name) {
		Ok(()) | Err(ConfigError::ResourceNotFound { .. }) => Ok(NoContent),
		Err(e) => Err(ApiError::from(e)),
	}
}

#[post("/agents/<agent>/skills/<name>/enable?<scope..>")]
pub async fn enable_skill(
	_auth: ApiAuth,
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
	if let Some(skill) = manager.get_skill(name) {
		ensure_skill_not_plugin_managed(skill, "enable").await?;
	}
	manager.enable_skill(name).map_err(ApiError::from)?;
	let skill = manager.get_skill(name).expect("skill present after enable");
	Ok(Json(SkillResponse::from(skill)))
}

#[post("/agents/<agent>/skills/<name>/disable?<scope..>")]
pub async fn disable_skill(
	_auth: ApiAuth,
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
	if let Some(skill) = manager.get_skill(name) {
		ensure_skill_not_plugin_managed(skill, "disable").await?;
	}
	manager.disable_skill(name).map_err(ApiError::from)?;
	let skill = manager
		.get_skill(name)
		.expect("skill present after disable");
	Ok(Json(SkillResponse::from(skill)))
}

/// Reject mutations on skills owned by a Claude plugin.
async fn ensure_skill_not_plugin_managed(
	skill: &Skill,
	action: &str,
) -> Result<(), ApiError> {
	if let Some(plugin_name) = detect_plugin_for_path_if_present(skill).await {
		return Err(ApiError::new(
			Status::BadRequest,
			format!(
				"Cannot {action} skill '{}' managed by plugin '{plugin_name}'",
				skill.name
			),
			"MANAGED_RESOURCE",
		));
	}
	Ok(())
}

async fn detect_plugin_for_path_if_present(skill: &Skill) -> Option<String> {
	let source_path = skill
		.canonical_path
		.as_deref()
		.or(skill.source_path.as_deref())?;
	let full_path = expand_tilde_path(source_path);
	detect_plugin_for_path(&full_path).await
}

fn is_plugin_managed_skill(
	skill: &Skill,
	plugins: &[aghub_cc_plugins::claude::ClaudePluginInfo],
) -> bool {
	let source_path = skill
		.canonical_path
		.as_deref()
		.or(skill.source_path.as_deref());
	let Some(path) = source_path else {
		return false;
	};
	let full_path = expand_tilde_path(path);
	plugins.iter().any(|plugin| plugin.owns_path(&full_path))
}

#[get("/agents/all/skills?<params..>")]
pub(crate) async fn list_all_agents_skills(
	_auth: ApiAuth,
	params: SkillListParams,
) -> ApiResult<Vec<SkillResponse>> {
	let include_managed = params.include_managed();
	let resolved = params.resolve_scope()?;
	let (resource_scope, project_root) = resolved_to_resource_scope(&resolved);
	let detected_plugins = ClaudePluginManager::new()
		.await
		.map(|manager| manager.list_plugins().to_vec())
		.unwrap_or_default();
	let mut items = Vec::new();
	for agent in
		load_all_agent_skill_locations(resource_scope, project_root.as_deref())
	{
		let mut item_indices = HashMap::new();
		let mut hidden_names = HashSet::new();
		for skill in agent.skills {
			if hidden_names.contains(&skill.name) {
				continue;
			}
			let is_managed = is_plugin_managed_skill(&skill, &detected_plugins);
			let (Some(source_path), Some(source)) =
				(skill.source_path.clone(), skill.config_source)
			else {
				continue;
			};
			let location = SkillLocationResponse {
				source_path,
				is_symlink: skill.canonical_path.is_some(),
				source: source.into(),
			};
			if let Some(index) = item_indices.get(&skill.name).copied() {
				if !include_managed && is_managed {
					continue;
				}
				let item: &mut SkillResponse = &mut items[index];
				item.locations.get_or_insert_with(Vec::new).push(location);
				continue;
			}
			if !include_managed && is_managed {
				hidden_names.insert(skill.name);
				continue;
			}
			let mut response =
				SkillResponse::from_agent_skill(skill, agent.agent_id);
			response.locations = Some(vec![location]);
			item_indices.insert(response.name.clone(), items.len());
			items.push(response);
		}
	}
	Ok(Json(items))
}

#[post("/skills/install", data = "<body>")]
pub async fn install_skill(
	_auth: ApiAuth,
	body: Json<InstallSkillRequest>,
) -> ApiResult<InstallSkillResponse> {
	let req = body.into_inner();
	let resource_scope = parse_install_scope(&req.scope)?;

	let project_root = req.project_path.as_ref().map(std::path::PathBuf::from);
	if resource_scope == ResourceScope::ProjectOnly && project_root.is_none() {
		return Err(ApiError::new(
			Status::BadRequest,
			"project_path is required for project skill installs",
			"INVALID_PARAM",
		));
	}

	let source = aghub_git::resolve_remote_source(&req.source)
		.map_err(map_remote_source_error)?;
	let clone_url = source.clone_url.clone();
	let lock_source = install_lock_source_from_resolved(&source, None);

	let clone_url_for_task = clone_url.clone();
	let temp_dir = match timeout(
		Duration::from_secs(300),
		tokio::task::spawn_blocking(move || {
			aghub_git::clone_to_temp(aghub_git::CloneOptions::new(
				&clone_url_for_task,
			))
		}),
	)
	.await
	{
		Ok(Ok(Ok(temp_dir))) => temp_dir,
		Ok(Ok(Err(e))) => {
			return Err(ApiError::new(
				Status::BadRequest,
				format!("Failed to clone skill source: {e}"),
				"CLONE_FAILED",
			));
		}
		Ok(Err(e)) => {
			return Err(ApiError::new(
				Status::InternalServerError,
				format!("Clone task panicked: {e}"),
				"CLONE_ERROR",
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

	let selected_skills = skill::discover_repo_skills(
		temp_dir.path(),
		&req.skills,
		req.install_all.unwrap_or(false),
	)
	.map_err(map_repo_discovery_error)?;
	let (dir_groups, invalid_agents) = build_git_install_groups(
		&req.agents,
		resource_scope,
		project_root.as_ref(),
	);

	let mut has_errors = !invalid_agents.is_empty();
	let mut installed_skill_names = std::collections::HashSet::new();

	for skill in &selected_skills {
		for (target_dir, agents) in &dir_groups {
			match install_git_skill_to_dir(
				temp_dir.path(),
				&skill.full_path,
				target_dir,
			) {
				Ok(skill_name) => {
					installed_skill_names.insert(skill_name);
					let _ = agents;
				}
				Err(_) => has_errors = true,
			}
		}
	}

	for skill in &selected_skills {
		if !installed_skill_names.contains(&skill.name) {
			continue;
		}

		write_skill_install_lock(
			&skill.name,
			resource_scope,
			project_root.as_deref(),
			&lock_source,
			Some(skill::lock_skill_file_path(&skill.relative_dir)),
		)?;
	}

	let success = !has_errors && !installed_skill_names.is_empty();

	Ok(Json(InstallSkillResponse { success }))
}

#[post("/skills/open", format = "json", data = "<request>")]
pub async fn open_skill_folder(
	_auth: ApiAuth,
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
	_auth: ApiAuth,
	request: Json<EditSkillFolderRequest>,
) -> Result<(), String> {
	let req = request.into_inner();
	let path = expand_tilde_path(&req.skill_path);
	let folder = get_parent_folder(path);

	match detect_available_editor() {
		Some(editor) => {
			let mut cmd = std::process::Command::new(editor.cli_command());
			cmd.arg(&folder);
			#[cfg(windows)]
			{
				use std::os::windows::process::CommandExt;
				cmd.creation_flags(crate::CREATE_NO_WINDOW);
			}
			match cmd.spawn() {
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
pub fn get_skill_content(
	_auth: ApiAuth,
	query: SkillContentQuery,
) -> ApiResult<String> {
	let resolved = ScopeParams {
		scope: query.scope.clone(),
		project_root: query.project_root.clone(),
	}
	.resolve()?;
	let (resource_scope, project_root) = resolved_to_resource_scope(&resolved);
	let roots = canonical_skill_roots_for_registered_agents(
		resource_scope,
		project_root.as_deref(),
	)?;
	let known = known_skill_paths(resource_scope, project_root.as_deref());

	let path = expand_tilde_path(&query.path);
	let canonical_file = canonical_existing(&path)?;
	ensure_skill_file_allowed(&canonical_file, &roots, &known)?;

	let content = std::fs::read_to_string(&canonical_file).map_err(|e| {
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
	_auth: ApiAuth,
	query: SkillTreeQuery,
) -> ApiResult<SkillTreeNodeResponse> {
	let resolved = ScopeParams {
		scope: query.scope.clone(),
		project_root: query.project_root.clone(),
	}
	.resolve()?;
	let (resource_scope, project_root) = resolved_to_resource_scope(&resolved);
	let roots = canonical_skill_roots_for_registered_agents(
		resource_scope,
		project_root.as_deref(),
	)?;
	let known = known_skill_paths(resource_scope, project_root.as_deref());

	let path = expand_tilde_path(&query.path);
	let root = get_skill_root(path);
	let canonical_root = canonical_existing(&root)?;
	ensure_skill_tree_allowed(&canonical_root, &roots, &known)?;
	let tree = build_skill_tree_node(&canonical_root, &canonical_root)?;
	Ok(Json(tree))
}

mod conflicts;
pub use conflicts::{diff_skill, get_skill_copy_status, resolve_skill_copies};
#[cfg(test)]
use conflicts::{retain_skill_diff_previews, skill_directory_diff_response};

#[get("/skills/lock/global")]
pub fn get_global_skill_lock(
	_auth: ApiAuth,
) -> ApiResult<GlobalSkillLockResponse> {
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
	_auth: ApiAuth,
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

fn require_github_credential_url(url: &str) -> Result<(), ApiError> {
	let parsed = url::Url::parse(url).map_err(|_| {
		ApiError::new(
			Status::BadRequest,
			"GitHub credentials can only be used with github.com HTTPS URLs",
			"INVALID_GITHUB_CREDENTIAL_URL",
		)
	})?;

	let host = parsed.host_str().unwrap_or_default();
	if parsed.scheme() == "https" && host.eq_ignore_ascii_case("github.com") {
		return Ok(());
	}

	Err(ApiError::new(
		Status::BadRequest,
		"GitHub credentials can only be used with github.com HTTPS URLs",
		"INVALID_GITHUB_CREDENTIAL_URL",
	))
}

#[post("/skills/git/scan", data = "<body>")]
pub async fn git_scan_skills(
	_auth: ApiAuth,
	body: Json<GitScanRequest>,
	sessions: &rocket::State<GitCloneSessions>,
) -> ApiResult<GitScanResponse> {
	let req = body.into_inner();

	let session_reuse = if let Some(ref sid) = req.session_id {
		let map = sessions.sessions.lock().unwrap();
		map.get(sid).map(|session| {
			(
				session.url.clone(),
				session.credential_token.clone(),
				session.branches.clone(),
			)
		})
	} else {
		None
	};

	if let Some((session_url, _, _)) = &session_reuse {
		ensure_session_remote_matches(&req.url, session_url)?;
	}

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
		} else {
			session_reuse
				.as_ref()
				.and_then(|(_, token, _)| token.clone())
		};

	let cached_branches: Option<Vec<String>> =
		session_reuse.map(|(_, _, branches)| branches);

	if credential_token.is_some() {
		require_github_credential_url(&req.url)?;
	}

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
	let mut scanned_skill_paths = HashSet::new();
	for path in &skill_paths {
		match skill::parser::parse(path) {
			Ok(parsed) => {
				let relative =
					normalize_scanned_skill_path_from_file(path, &temp_path)?;
				scanned_skill_paths.insert(relative.clone());
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
				scanned_skill_paths,
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
	let mut cmd = std::process::Command::new("git");
	cmd.args(["rev-parse", "--abbrev-ref", "HEAD"])
		.current_dir(repo_path);
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		cmd.creation_flags(crate::CREATE_NO_WINDOW);
	}
	let output = cmd.output().ok()?;

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
	_auth: ApiAuth,
	body: Json<GitInstallRequest>,
	sessions: &rocket::State<GitCloneSessions>,
) -> ApiResult<GitInstallResponse> {
	let req = body.into_inner();

	// Extract temp dir path and source metadata from session
	let (temp_path, source, scanned_skill_paths) = {
		let map = sessions.sessions.lock().unwrap();
		let session = map.get(&req.session_id).ok_or_else(|| {
			ApiError::new(
				Status::NotFound,
				"Session not found or expired",
				"SESSION_NOT_FOUND",
			)
		})?;
		let ref_name = if session.current_branch.is_empty() {
			None
		} else {
			Some(session.current_branch.clone())
		};
		let resolved = aghub_git::resolve_remote_source(&session.url)
			.map_err(map_remote_source_error)?;
		(
			session.temp_dir.path().to_path_buf(),
			install_lock_source_from_resolved(&resolved, ref_name),
			session.scanned_skill_paths.clone(),
		)
	};

	let resource_scope = parse_install_scope(&req.scope)?;

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

	let selected_paths = req
		.skill_paths
		.iter()
		.map(|skill_path| {
			validate_scanned_skill_path(
				&temp_path,
				&scanned_skill_paths,
				skill_path,
			)
		})
		.collect::<Result<Vec<_>, _>>()?;

	for (relative_dir, full_path) in selected_paths {
		let mut installed = false;

		for (target_dir, agents) in &dir_groups {
			match install_git_skill_to_dir(&temp_path, &full_path, target_dir) {
				Ok(skill_name) => {
					installed = true;
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
							name: relative_dir.clone(),
							agent: agent_str.clone(),
							success: false,
							error: Some(e.body.error.clone()),
						});
					}
				}
			}
		}

		if installed {
			let parsed_name = skill::parser::parse(&full_path)
				.ok()
				.map(|skill| skill.name);
			if let Some(skill_name) = parsed_name {
				write_skill_install_lock(
					&skill_name,
					resource_scope,
					project_root.as_deref(),
					&source,
					Some(skill::lock_skill_file_path(&relative_dir)),
				)?;
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
	_auth: ApiAuth,
	body: Json<GitSyncRequest>,
	sessions: &rocket::State<GitCloneSessions>,
) -> ApiResult<GitSyncResponse> {
	let req = body.into_inner();

	// Retrieve temp dir from session (keep session alive until end)
	let (temp_path, scanned_skill_paths) = {
		let map = sessions.sessions.lock().unwrap();
		let session = map.get(&req.session_id).ok_or_else(|| {
			ApiError::new(
				Status::NotFound,
				"Session not found or expired",
				"SESSION_NOT_FOUND",
			)
		})?;
		(
			session.temp_dir.path().to_path_buf(),
			session.scanned_skill_paths.clone(),
		)
	};

	// Full path of the SKILL.md (or skill dir) inside the clone
	let (_, cloned_skill_path) = validate_scanned_skill_path(
		&temp_path,
		&scanned_skill_paths,
		&req.skill_path,
	)?;
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

	let resolved = ScopeParams {
		scope: req.scope.clone(),
		project_root: req.project_root.clone(),
	}
	.resolve()?;
	let (resource_scope, project_root) = resolved_to_resource_scope(&resolved);
	let roots = canonical_skill_roots_for_registered_agents(
		resource_scope,
		project_root.as_deref(),
	)?;
	let known = known_skill_paths(resource_scope, project_root.as_deref());
	let target_dirs = req
		.source_paths
		.iter()
		.map(|source_path| {
			validate_existing_skill_target_dir(source_path, &roots, &known)
		})
		.collect::<Result<Vec<_>, _>>()?;

	// Replace each installation path
	for target_dir in &target_dirs {
		replace_git_skill_dir_staged(
			&temp_path,
			&cloned_skill_dir,
			target_dir,
		)?;
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

	fn write_test_skill(dir: &std::path::Path, name: &str, body: &str) {
		std::fs::create_dir_all(dir).unwrap();
		std::fs::write(
			dir.join("SKILL.md"),
			format!(
				"---\nname: {name}\ndescription: test skill\n---\n\n{body}\n"
			),
		)
		.unwrap();
	}

	fn api_ok<T>(result: Result<T, ApiError>) -> T {
		match result {
			Ok(value) => value,
			Err(error) => panic!("{}", error.body.error),
		}
	}

	fn api_err<T>(result: Result<T, ApiError>) -> ApiError {
		match result {
			Ok(_) => panic!("expected API error"),
			Err(error) => error,
		}
	}

	#[test]
	fn skill_path_helpers_reject_sibling_prefix_and_resolve_dotdot() {
		let temp = tempdir().unwrap();
		let root = temp.path().join("root");
		let child = root.join("child");
		let sibling = temp.path().join("root-evil");
		std::fs::create_dir_all(&child).unwrap();
		std::fs::create_dir_all(&sibling).unwrap();

		let canonical_root = api_ok(canonical_existing(&root));
		let canonical_child = api_ok(canonical_existing(&child));
		let canonical_sibling = api_ok(canonical_existing(&sibling));
		let dotdot_child =
			api_ok(canonical_existing(&root.join("child/../child")));

		assert!(is_within(&canonical_child, &canonical_root));
		assert!(is_within(&dotdot_child, &canonical_root));
		assert!(!is_within(&canonical_sibling, &canonical_root));
	}

	#[test]
	fn delete_skill_by_path_valid_project_path_deletes() {
		let temp = tempdir().unwrap();
		let project = temp.path().join("project");
		let skill_dir = project.join(".claude/skills/demo");
		write_test_skill(&skill_dir, "demo", "old body");

		let request = DeleteSkillByPathRequest {
			source_path: skill_dir.join("SKILL.md").display().to_string(),
			agents: vec!["claude".to_string()],
			scope: "project".to_string(),
			project_root: Some(project.display().to_string()),
		};
		let runtime = tokio::runtime::Runtime::new().unwrap();
		let response = runtime
			.block_on(delete_skill_by_path(ApiAuth, Json(request)))
			.unwrap_or_else(|e| panic!("{}", e.body.error))
			.into_inner();

		assert!(response.success);
		assert!(!skill_dir.exists());
	}

	#[test]
	fn delete_skill_by_path_rejects_sibling_prefix_trick() {
		let temp = tempdir().unwrap();
		let project = temp.path().join("project");
		let skill_dir = project.join(".claude/skills-evil/demo");
		write_test_skill(&skill_dir, "demo", "old body");

		let request = DeleteSkillByPathRequest {
			source_path: skill_dir.join("SKILL.md").display().to_string(),
			agents: vec!["claude".to_string()],
			scope: "project".to_string(),
			project_root: Some(project.display().to_string()),
		};
		let runtime = tokio::runtime::Runtime::new().unwrap();
		let response = runtime
			.block_on(delete_skill_by_path(ApiAuth, Json(request)))
			.unwrap_or_else(|e| panic!("{}", e.body.error))
			.into_inner();

		assert!(!response.success);
		assert!(skill_dir.exists());
		assert!(response.validation_errors.is_some());
	}

	#[cfg(unix)]
	#[test]
	fn delete_skill_by_path_rejects_symlink_escape() {
		let temp = tempdir().unwrap();
		let project = temp.path().join("project");
		let skills_root = project.join(".claude/skills");
		let outside_dir = temp.path().join("outside/demo");
		write_test_skill(&outside_dir, "demo", "outside body");
		std::fs::create_dir_all(&skills_root).unwrap();
		std::os::unix::fs::symlink(&outside_dir, skills_root.join("demo"))
			.unwrap();

		let request = DeleteSkillByPathRequest {
			source_path: skills_root
				.join("demo/SKILL.md")
				.display()
				.to_string(),
			agents: vec!["claude".to_string()],
			scope: "project".to_string(),
			project_root: Some(project.display().to_string()),
		};
		let runtime = tokio::runtime::Runtime::new().unwrap();
		let response = runtime
			.block_on(delete_skill_by_path(ApiAuth, Json(request)))
			.unwrap_or_else(|e| panic!("{}", e.body.error))
			.into_inner();

		assert!(!response.success);
		assert!(outside_dir.join("SKILL.md").exists());
		assert!(skills_root.join("demo").exists());
	}

	#[test]
	fn skill_content_project_skill_returns_body() {
		let temp = tempdir().unwrap();
		let project = temp.path().join("project");
		let skill_file = project.join(".claude/skills/demo/SKILL.md");
		write_test_skill(skill_file.parent().unwrap(), "demo", "visible body");

		let content = api_ok(get_skill_content(
			ApiAuth,
			SkillContentQuery {
				path: skill_file.display().to_string(),
				scope: Some("project".to_string()),
				project_root: Some(project.display().to_string()),
			},
		))
		.into_inner();

		assert!(content.contains("visible body"));
	}

	#[test]
	fn skill_content_outside_skill_roots_is_rejected() {
		let temp = tempdir().unwrap();
		let project = temp.path().join("project");
		std::fs::create_dir_all(&project).unwrap();
		let outside_file = temp.path().join("outside/SKILL.md");
		write_test_skill(outside_file.parent().unwrap(), "outside", "secret");

		let error = api_err(get_skill_content(
			ApiAuth,
			SkillContentQuery {
				path: outside_file.display().to_string(),
				scope: Some("project".to_string()),
				project_root: Some(project.display().to_string()),
			},
		));

		assert_eq!(error.body.code, SKILL_PATH_OUTSIDE_ROOT);
	}

	#[test]
	fn skill_tree_outside_skill_roots_is_rejected() {
		let temp = tempdir().unwrap();
		let project = temp.path().join("project");
		std::fs::create_dir_all(&project).unwrap();
		let outside_dir = temp.path().join("outside");
		write_test_skill(&outside_dir, "outside", "secret");

		let error = api_err(get_skill_tree(
			ApiAuth,
			SkillTreeQuery {
				path: outside_dir.display().to_string(),
				scope: Some("project".to_string()),
				project_root: Some(project.display().to_string()),
			},
		));

		assert_eq!(error.body.code, SKILL_PATH_OUTSIDE_ROOT);
	}

	#[cfg(unix)]
	#[test]
	fn skill_tree_reports_broken_symlink_child() {
		let temp = tempdir().unwrap();
		let project = temp.path().join("project");
		let skill_dir = project.join(".claude/skills/demo");
		write_test_skill(&skill_dir, "demo", "visible body");
		std::os::unix::fs::symlink(
			"../missing.txt",
			skill_dir.join("linked.txt"),
		)
		.unwrap();

		let tree = api_ok(get_skill_tree(
			ApiAuth,
			SkillTreeQuery {
				path: skill_dir.display().to_string(),
				scope: Some("project".to_string()),
				project_root: Some(project.display().to_string()),
			},
		))
		.into_inner();
		let link = tree
			.children
			.iter()
			.find(|child| child.name == "linked.txt")
			.unwrap();

		assert!(matches!(link.kind, SkillTreeNodeKind::Symlink));
		assert!(link.link.as_ref().unwrap().target.is_none());
		assert!(matches!(
			link.link.as_ref().unwrap().status,
			SkillLinkStatusResponse::Broken
		));
	}

	#[cfg(unix)]
	#[test]
	fn skill_tree_reports_valid_and_outside_symlink_children() {
		let temp = tempdir().unwrap();
		let project = temp.path().join("project");
		let skill_dir = project.join(".claude/skills/demo");
		let outside_file = project.join("outside.txt");
		write_test_skill(&skill_dir, "demo", "visible body");
		std::fs::write(skill_dir.join("target.txt"), "target").unwrap();
		std::fs::write(&outside_file, "outside").unwrap();
		std::os::unix::fs::symlink("target.txt", skill_dir.join("valid.txt"))
			.unwrap();
		std::os::unix::fs::symlink(
			"../../../outside.txt",
			skill_dir.join("outside.txt"),
		)
		.unwrap();

		let tree = api_ok(get_skill_tree(
			ApiAuth,
			SkillTreeQuery {
				path: skill_dir.display().to_string(),
				scope: Some("project".to_string()),
				project_root: Some(project.display().to_string()),
			},
		))
		.into_inner();
		let status = |name: &str| {
			tree.children
				.iter()
				.find(|child| child.name == name)
				.unwrap()
				.link
				.as_ref()
				.unwrap()
				.status
				.clone()
		};

		assert!(matches!(
			status("valid.txt"),
			SkillLinkStatusResponse::Valid
		));
		assert!(matches!(
			status("outside.txt"),
			SkillLinkStatusResponse::OutsideRoot
		));
		let target = |name: &str| {
			tree.children
				.iter()
				.find(|child| child.name == name)
				.unwrap()
				.link
				.as_ref()
				.unwrap()
				.target
				.clone()
		};
		assert_eq!(target("valid.txt").as_deref(), Some("target.txt"));
		assert!(target("outside.txt").is_none());
	}

	#[test]
	fn skill_diff_reports_modified_and_added_files() {
		let temp = tempdir().unwrap();
		let installed = temp.path().join("installed");
		let comparison = temp.path().join("comparison");
		write_test_skill(&installed, "demo", "old body");
		write_test_skill(&comparison, "demo", "new body");
		std::fs::write(comparison.join("notes.txt"), "new file").unwrap();

		let response = skill_directory_diff_response(
			skill::snapshot::compare_directories(&installed, &comparison)
				.unwrap(),
		);

		assert!(!response.identical);
		assert_eq!(response.base_hash.len(), 64);
		assert_eq!(response.target_hash.len(), 64);
		assert_eq!(response.files.len(), 2);
		assert_eq!(response.files[0].path, "SKILL.md");
		assert!(matches!(
			response.files[0].change,
			SkillFileDiffKindResponse::Modified
		));
		assert!(response.files[0]
			.before
			.as_deref()
			.is_some_and(|content| content.contains("old body")));
		assert!(response.files[0]
			.after
			.as_deref()
			.is_some_and(|content| content.contains("new body")));
		assert_eq!(response.files[1].path, "notes.txt");
		assert!(matches!(
			response.files[1].change,
			SkillFileDiffKindResponse::Added
		));
	}

	#[test]
	fn skill_diff_reports_name_change() {
		let temp = tempdir().unwrap();
		let installed = temp.path().join("installed");
		let comparison = temp.path().join("comparison");
		write_test_skill(&installed, "first", "body");
		write_test_skill(&comparison, "second", "body");

		let response = skill_directory_diff_response(
			skill::snapshot::compare_directories(&installed, &comparison)
				.unwrap(),
		);

		assert!(!response.identical);
		assert_eq!(response.files.len(), 1);
		assert_eq!(response.files[0].path, "SKILL.md");
	}

	#[cfg(unix)]
	#[test]
	fn skill_diff_reports_link_target_status() {
		let temp = tempdir().unwrap();
		let installed = temp.path().join("installed");
		let comparison = temp.path().join("comparison");
		write_test_skill(&installed, "demo", "body");
		write_test_skill(&comparison, "demo", "body");
		std::fs::write(installed.join("target.txt"), "target").unwrap();
		std::os::unix::fs::symlink("target.txt", installed.join("linked.txt"))
			.unwrap();
		std::os::unix::fs::symlink(
			"missing.txt",
			comparison.join("linked.txt"),
		)
		.unwrap();

		let response = skill_directory_diff_response(
			skill::snapshot::compare_directories(&installed, &comparison)
				.unwrap(),
		);
		let link_diff = response
			.files
			.iter()
			.find(|file| file.path == "linked.txt")
			.unwrap();

		assert!(matches!(
			link_diff.before_link.as_ref().unwrap().status,
			SkillLinkStatusResponse::Valid
		));
		assert!(link_diff.after_link.as_ref().unwrap().target.is_none());
		assert!(matches!(
			link_diff.after_link.as_ref().unwrap().status,
			SkillLinkStatusResponse::Broken
		));
		assert!(!link_diff.content_omitted);
	}

	#[test]
	fn skill_diff_bounds_serialized_text_previews() {
		let mut response = SkillDirectoryDiffResponse {
			identical: false,
			base_hash: "base".to_string(),
			target_hash: "target".to_string(),
			files: vec![
				SkillFileDiffResponse {
					path: "kept.txt".to_string(),
					change: SkillFileDiffKindResponse::Modified,
					before: Some("aa".to_string()),
					after: Some("bb".to_string()),
					before_link: None,
					after_link: None,
					content_omitted: false,
				},
				SkillFileDiffResponse {
					path: "omitted.txt".to_string(),
					change: SkillFileDiffKindResponse::Modified,
					before: Some("cc".to_string()),
					after: Some("dd".to_string()),
					before_link: None,
					after_link: None,
					content_omitted: false,
				},
			],
			files_omitted: 0,
		};
		let mut remaining_bytes = 5;

		retain_skill_diff_previews(&mut response, &mut remaining_bytes);

		assert_eq!(remaining_bytes, 1);
		assert!(!response.files[0].content_omitted);
		assert!(response.files[1].content_omitted);
		assert!(response.files[1].before.is_none());
		assert!(response.files[1].after.is_none());
	}

	#[test]
	fn git_scan_session_accepts_same_normalized_remote() {
		assert!(ensure_session_remote_matches(
			"https://github.com/vercel-labs/agent-skills.git",
			"vercel-labs/agent-skills",
		)
		.is_ok());
	}

	#[test]
	fn git_scan_session_rejects_different_remote() {
		let error = ensure_session_remote_matches(
			"https://github.com/vercel-labs/agent-skills.git",
			"https://github.com/openai/codex.git",
		)
		.unwrap_err();

		assert_eq!(error.body.code, SESSION_REMOTE_MISMATCH);
	}

	#[test]
	fn git_install_path_accepts_repo_root_skill_sentinel() {
		let temp = tempdir().unwrap();
		write_test_skill(temp.path(), "root-skill", "body");
		let root = api_ok(canonical_existing(temp.path()));
		let normalized =
			api_ok(normalize_scanned_skill_path_from_file(&root, &root));
		let mut scanned = HashSet::new();
		scanned.insert(normalized.clone());

		assert_eq!(normalized, "");
		for requested in ["", ".", "./"] {
			let (relative, full_path) = api_ok(validate_scanned_skill_path(
				temp.path(),
				&scanned,
				requested,
			));
			assert_eq!(relative, "");
			assert_eq!(full_path, root);
		}
	}

	#[test]
	fn git_install_path_rejects_unscanned_and_traversal_paths() {
		let temp = tempdir().unwrap();
		let skill_file = temp.path().join("skill-a/SKILL.md");
		write_test_skill(skill_file.parent().unwrap(), "skill-a", "body");
		let mut scanned = HashSet::new();
		scanned.insert("skill-a/SKILL.md".to_string());

		let (_, valid_path) = api_ok(validate_scanned_skill_path(
			temp.path(),
			&scanned,
			"skill-a/SKILL.md",
		));
		assert_eq!(valid_path, api_ok(canonical_existing(&skill_file)));

		let unscanned = validate_scanned_skill_path(
			temp.path(),
			&scanned,
			"skill-b/SKILL.md",
		)
		.unwrap_err();
		assert_eq!(unscanned.body.code, SKILL_PATH_OUTSIDE_ROOT);

		let traversal = validate_scanned_skill_path(
			temp.path(),
			&scanned,
			"skill-a/../secret/SKILL.md",
		)
		.unwrap_err();
		assert_eq!(traversal.body.code, INVALID_SKILL_PATH);
	}

	#[test]
	fn git_sync_staged_replacement_replaces_valid_skill() {
		let temp = tempdir().unwrap();
		let source_dir = temp.path().join("source");
		let target_dir = temp.path().join("target");
		write_test_skill(&source_dir, "demo", "new body");
		write_test_skill(&target_dir, "demo", "old body");

		api_ok(replace_skill_dir_staged(&source_dir, &target_dir));

		let content =
			std::fs::read_to_string(target_dir.join("SKILL.md")).unwrap();
		assert!(content.contains("new body"));
		assert!(!content.contains("old body"));
	}

	#[test]
	fn git_sync_parse_failure_leaves_original_target_intact() {
		let temp = tempdir().unwrap();
		let source_dir = temp.path().join("source");
		let target_dir = temp.path().join("target");
		std::fs::create_dir_all(&source_dir).unwrap();
		std::fs::write(source_dir.join("notes.txt"), "not a skill").unwrap();
		write_test_skill(&target_dir, "demo", "old body");

		let error =
			replace_skill_dir_staged(&source_dir, &target_dir).unwrap_err();

		assert_eq!(error.body.code, "SKILL_PARSE_FAILED");
		let content =
			std::fs::read_to_string(target_dir.join("SKILL.md")).unwrap();
		assert!(content.contains("old body"));
	}

	#[test]
	fn staged_skill_batch_rolls_back_after_activation_failure() {
		let temp = tempdir().unwrap();
		let source_dir = temp.path().join("source");
		let first_target = temp.path().join("first-target");
		let second_target = temp.path().join("second-target");
		write_test_skill(&source_dir, "demo", "new body");
		write_test_skill(&first_target, "demo", "first old body");
		write_test_skill(&second_target, "demo", "second old body");
		let first =
			api_ok(stage_skill_dir_replacement(&source_dir, &first_target));
		let second =
			api_ok(stage_skill_dir_replacement(&source_dir, &second_target));
		cleanup_path(&second.staged);

		let error =
			apply_staged_skill_replacements(&[first, second]).unwrap_err();

		assert_eq!(error.body.code, "IO_ERROR");
		let first_content =
			std::fs::read_to_string(first_target.join("SKILL.md")).unwrap();
		let second_content =
			std::fs::read_to_string(second_target.join("SKILL.md")).unwrap();
		assert!(first_content.contains("first old body"));
		assert!(second_content.contains("second old body"));
	}

	#[test]
	fn staged_skill_batch_keeps_other_targets_available() {
		let temp = tempdir().unwrap();
		let source = temp.path().join("source");
		let targets = [
			temp.path().join("first-target"),
			temp.path().join("second-target"),
			temp.path().join("third-target"),
		];
		write_test_skill(&source, "demo", "new body");
		for (index, target) in targets.iter().enumerate() {
			write_test_skill(target, "demo", &format!("old body {index}"));
		}
		let replacements = targets
			.iter()
			.map(|target| api_ok(stage_skill_dir_replacement(&source, target)))
			.collect::<Vec<_>>();

		api_ok(apply_staged_skill_replacements_with_backup_check(
			&replacements,
			|current, replacement| {
				assert!(!replacement.target.exists());
				for (index, target) in targets.iter().enumerate() {
					if index != current {
						assert!(target.exists());
					}
				}
				Ok(())
			},
		));

		for target in targets {
			let content =
				std::fs::read_to_string(target.join("SKILL.md")).unwrap();
			assert!(content.contains("new body"));
		}
	}

	#[test]
	fn staged_skill_batch_reports_backup_cleanup_failure() {
		let temp = tempdir().unwrap();
		let source = temp.path().join("source");
		let target = temp.path().join("target");
		write_test_skill(&source, "demo", "new body");
		write_test_skill(&target, "demo", "old body");
		let replacement = api_ok(stage_skill_dir_replacement(&source, &target));
		let backup = replacement.backup.clone();

		let error = apply_staged_skill_replacements_with_checks(
			&[replacement],
			|_, _| Ok(()),
			|_| {
				Err(std::io::Error::new(
					std::io::ErrorKind::PermissionDenied,
					"backup is in use",
				))
			},
		)
		.unwrap_err();

		assert_eq!(error.body.code, "SKILL_COPY_BACKUP_CLEANUP_FAILED");
		assert!(error.body.error.contains(backup.to_string_lossy().as_ref()));
		let content = std::fs::read_to_string(target.join("SKILL.md")).unwrap();
		assert!(content.contains("new body"));
		assert!(backup.exists());
	}

	#[cfg(unix)]
	#[test]
	fn staged_skill_copy_reports_failed_temp_cleanup() {
		use std::os::unix::fs::PermissionsExt;

		let temp = tempdir().unwrap();
		let source = temp.path().join("source");
		let parent = temp.path().join("targets");
		let target = parent.join("demo");
		write_test_skill(&source, "demo", "new body");
		std::fs::create_dir_all(&parent).unwrap();
		let mut staged_path = None;

		let error =
			stage_skill_dir_replacement_with(&source, &target, |_, staged| {
				write_test_skill(staged, "demo", "partial body");
				staged_path = Some(staged.to_path_buf());
				std::fs::set_permissions(
					&parent,
					std::fs::Permissions::from_mode(0o500),
				)
				.unwrap();
				Err(ApiError::new(
					Status::InternalServerError,
					"copy failed",
					"COPY_FAILED",
				))
			})
			.unwrap_err();

		std::fs::set_permissions(
			&parent,
			std::fs::Permissions::from_mode(0o700),
		)
		.unwrap();
		let staged_path = staged_path.unwrap();
		assert_eq!(error.body.code, "SKILL_COPY_TEMP_CLEANUP_FAILED");
		assert!(error
			.body
			.error
			.contains(staged_path.to_string_lossy().as_ref()));
		assert!(staged_path.exists());
	}

	#[test]
	fn skill_copy_batch_write_budget_rejects_before_staging() {
		let temp = tempdir().unwrap();
		let source = temp.path().join("source");
		let first_target = temp.path().join("first/demo");
		let second_target = temp.path().join("second/demo");
		write_test_skill(&source, "demo", "new body");
		write_test_skill(&first_target, "demo", "first old body");
		write_test_skill(&second_target, "demo", "second old body");
		let source_bytes =
			std::fs::metadata(source.join("SKILL.md")).unwrap().len();
		let mut remaining_bytes = source_bytes * 2 - 1;

		let error = stage_skill_copy_replacements_with_budget(
			&source,
			&[first_target.clone(), second_target.clone()],
			source_bytes,
			&mut remaining_bytes,
		)
		.unwrap_err();

		assert_eq!(error.body.code, "SKILL_COPY_WRITE_LIMIT");
		for parent in [
			first_target.parent().unwrap(),
			second_target.parent().unwrap(),
		] {
			assert!(!std::fs::read_dir(parent)
				.unwrap()
				.filter_map(Result::ok)
				.any(|entry| entry
					.file_name()
					.to_string_lossy()
					.starts_with(".aghub-tmp-")));
		}
	}

	#[cfg(unix)]
	#[test]
	fn staged_skill_batch_reports_each_failed_recovery_path() {
		use std::os::unix::fs::PermissionsExt;

		let temp = tempdir().unwrap();
		let source = temp.path().join("source");
		let first_target = temp.path().join("first/demo");
		let second_target = temp.path().join("second/demo");
		let failing_target = temp.path().join("third/demo");
		write_test_skill(&source, "demo", "new body");
		write_test_skill(&first_target, "demo", "first old body");
		write_test_skill(&second_target, "demo", "second old body");
		write_test_skill(&failing_target, "demo", "third old body");
		let first = api_ok(stage_skill_dir_replacement(&source, &first_target));
		let second =
			api_ok(stage_skill_dir_replacement(&source, &second_target));
		let failing =
			api_ok(stage_skill_dir_replacement(&source, &failing_target));
		let first_backup = first.backup.clone();
		let second_backup = second.backup.clone();
		cleanup_path(&failing.staged);

		let error = apply_staged_skill_replacements_with_backup_check(
			&[first, second, failing],
			|index, _| {
				if index == 2 {
					for target in [&first_target, &second_target] {
						std::fs::set_permissions(
							target.parent().unwrap(),
							std::fs::Permissions::from_mode(0o500),
						)
						.unwrap();
					}
				}
				Ok(())
			},
		)
		.unwrap_err();

		for target in [&first_target, &second_target] {
			std::fs::set_permissions(
				target.parent().unwrap(),
				std::fs::Permissions::from_mode(0o700),
			)
			.unwrap();
		}
		assert_eq!(error.body.code, "SKILL_COPY_ROLLBACK_FAILED");
		assert!(error
			.body
			.error
			.contains(first_backup.to_string_lossy().as_ref()));
		assert!(error
			.body
			.error
			.contains(second_backup.to_string_lossy().as_ref()));
		assert!(first_backup.exists());
		assert!(second_backup.exists());
		let failing_content =
			std::fs::read_to_string(failing_target.join("SKILL.md")).unwrap();
		assert!(failing_content.contains("third old body"));
	}

	#[test]
	fn git_sync_outside_source_path_is_rejected_and_not_deleted() {
		let temp = tempdir().unwrap();
		let project = temp.path().join("project");
		let root = project.join(".claude/skills");
		std::fs::create_dir_all(&root).unwrap();
		let roots = vec![api_ok(canonical_skill_root(&root))];
		let known = Vec::new();
		let outside_dir = temp.path().join("outside");
		write_test_skill(&outside_dir, "outside", "secret");

		let error = validate_existing_skill_target_dir(
			&outside_dir.join("SKILL.md").display().to_string(),
			&roots,
			&known,
		)
		.unwrap_err();

		assert_eq!(error.body.code, SKILL_PATH_OUTSIDE_ROOT);
		assert!(outside_dir.join("SKILL.md").exists());
	}

	#[test]
	fn github_credential_url_accepts_github_https() {
		assert!(require_github_credential_url(
			"https://github.com/owner/repo.git",
		)
		.is_ok());
	}

	#[test]
	fn github_credential_url_rejects_non_github_hosts() {
		let err = require_github_credential_url(
			"https://attacker.example/owner/repo.git",
		)
		.unwrap_err();

		assert_eq!(err.status, Status::BadRequest);
		assert_eq!(err.body.code, "INVALID_GITHUB_CREDENTIAL_URL");
	}

	#[test]
	fn github_credential_url_rejects_github_lookalikes() {
		let err = require_github_credential_url(
			"https://github.com.attacker.example/owner/repo.git",
		)
		.unwrap_err();

		assert_eq!(err.status, Status::BadRequest);
	}

	#[test]
	fn github_credential_url_rejects_non_https_github() {
		let err =
			require_github_credential_url("http://github.com/owner/repo.git")
				.unwrap_err();

		assert_eq!(err.status, Status::BadRequest);
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

		let result = install_git_skill_to_dir(
			source_dir.parent().unwrap(),
			&source_dir.join("SKILL.md"),
			&target_dir,
		)
		.unwrap_or_else(|e| panic!("{}", e.body.error));
		assert_eq!(result, "hello-skill");
		assert!(target_dir.join("hello-skill/SKILL.md").exists());

		let second = install_git_skill_to_dir(
			source_dir.parent().unwrap(),
			&source_dir.join("SKILL.md"),
			&target_dir,
		)
		.unwrap_or_else(|e| panic!("{}", e.body.error));
		assert_eq!(second, "hello-skill");
		assert!(target_dir.join("hello-skill/SKILL.md").exists());
	}

	#[cfg(unix)]
	#[test]
	fn git_install_materializes_file_link_within_repository() {
		let temp = tempdir().unwrap();
		let repository = temp.path().join("repository");
		let source_dir = repository.join("skills/linked-skill");
		let references = source_dir.join("references");
		let target_dir = temp.path().join("target");
		write_test_skill(&source_dir, "linked-skill", "body");
		std::fs::create_dir_all(&references).unwrap();
		std::fs::create_dir_all(repository.join("docs")).unwrap();
		std::fs::write(repository.join("docs/example.html"), "example")
			.unwrap();
		std::os::unix::fs::symlink(
			"../../../docs/example.html",
			references.join("example.html"),
		)
		.unwrap();

		install_git_skill_to_dir(
			&repository,
			&source_dir.join("SKILL.md"),
			&target_dir,
		)
		.unwrap_or_else(|error| panic!("{}", error.body.error));
		let installed = target_dir.join("linked-skill/references/example.html");

		assert_eq!(std::fs::read_to_string(&installed).unwrap(), "example");
		assert!(!std::fs::symlink_metadata(installed)
			.unwrap()
			.file_type()
			.is_symlink());
	}

	#[cfg(unix)]
	#[test]
	fn git_install_rejects_link_outside_repository_without_partial_skill() {
		let temp = tempdir().unwrap();
		let repository = temp.path().join("repository");
		let source_dir = repository.join("skills/linked-skill");
		let references = source_dir.join("references");
		let target_dir = temp.path().join("target");
		let outside_file = temp.path().join("outside.txt");
		write_test_skill(&source_dir, "linked-skill", "body");
		std::fs::create_dir_all(&references).unwrap();
		std::fs::write(&outside_file, "outside").unwrap();
		std::os::unix::fs::symlink(
			&outside_file,
			references.join("outside.txt"),
		)
		.unwrap();

		let error = install_git_skill_to_dir(
			&repository,
			&source_dir.join("SKILL.md"),
			&target_dir,
		)
		.unwrap_err();

		assert_eq!(error.body.code, INVALID_SKILL_PATH);
		assert!(!target_dir.join("linked-skill").exists());
		assert!(std::fs::read_dir(&target_dir).unwrap().all(|entry| !entry
			.unwrap()
			.file_name()
			.to_string_lossy()
			.starts_with(".aghub-tmp-")));
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
