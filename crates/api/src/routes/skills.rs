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
use skill::snapshot::FileDiffKind;
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
		ProjectSkillLockResponse, SkillContentQuery,
		SkillCopyResolutionRequest, SkillCopyResolutionResponse,
		SkillCopyResolutionResult, SkillCopyStatusRequest,
		SkillCopyStatusResponse, SkillCopyStatusResult,
		SkillCopyStorageModeRequest, SkillDiffReferenceRequest,
		SkillDiffRequest, SkillDiffResponse, SkillDirectoryDiffResponse,
		SkillFileDiffKindResponse, SkillFileDiffResponse, SkillLinkResponse,
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

fn expand_tilde_path(path: &str) -> std::path::PathBuf {
	if path.starts_with("~/") {
		dirs::home_dir()
			.map(|home| home.join(&path[2..]))
			.unwrap_or_else(|| path.into())
	} else {
		path.into()
	}
}

fn skill_path_error(
	status: Status,
	message: impl Into<String>,
	code: &'static str,
) -> ApiError {
	ApiError::new(status, message, code)
}

fn canonical_existing(path: &Path) -> Result<PathBuf, ApiError> {
	if path.as_os_str().is_empty() {
		return Err(skill_path_error(
			Status::BadRequest,
			"Skill path cannot be empty",
			INVALID_SKILL_PATH,
		));
	}

	std::fs::canonicalize(path).map_err(|e| {
		let (status, code) = if e.kind() == std::io::ErrorKind::NotFound {
			(Status::NotFound, SKILL_PATH_NOT_FOUND)
		} else {
			(Status::BadRequest, INVALID_SKILL_PATH)
		};
		skill_path_error(
			status,
			format!("Failed to resolve skill path '{}': {e}", path.display()),
			code,
		)
	})
}

fn canonical_existing_parent(path: &Path) -> Result<PathBuf, ApiError> {
	let parent = path.parent().ok_or_else(|| {
		skill_path_error(
			Status::BadRequest,
			format!("Skill path '{}' has no parent", path.display()),
			INVALID_SKILL_PATH,
		)
	})?;
	canonical_existing(parent)
}

fn canonical_intended(path: &Path) -> Result<PathBuf, ApiError> {
	if path.exists() {
		return canonical_existing(path);
	}

	if path.as_os_str().is_empty() {
		return Err(skill_path_error(
			Status::BadRequest,
			"Skill path cannot be empty",
			INVALID_SKILL_PATH,
		));
	}

	if path.components().any(|c| matches!(c, Component::ParentDir)) {
		return Err(skill_path_error(
			Status::BadRequest,
			format!("Skill path '{}' contains '..'", path.display()),
			INVALID_SKILL_PATH,
		));
	}

	if let (Some(name), Ok(mut parent)) =
		(path.file_name(), canonical_existing_parent(path))
	{
		parent.push(name);
		return Ok(parent);
	}

	let mut missing = Vec::new();
	let mut current = path;
	while !current.exists() {
		let Some(name) = current.file_name() else {
			return Err(skill_path_error(
				Status::NotFound,
				format!(
					"No existing parent found for skill path '{}'",
					path.display()
				),
				SKILL_PATH_NOT_FOUND,
			));
		};
		missing.push(name.to_os_string());
		current = current.parent().ok_or_else(|| {
			skill_path_error(
				Status::NotFound,
				format!(
					"No existing parent found for skill path '{}'",
					path.display()
				),
				SKILL_PATH_NOT_FOUND,
			)
		})?;
	}

	let mut resolved = canonical_existing(current)?;
	for component in missing.iter().rev() {
		resolved.push(component);
	}
	Ok(resolved)
}

fn is_within(child: &Path, root: &Path) -> bool {
	child == root || child.starts_with(root)
}

fn canonical_skill_root(path: &Path) -> Result<PathBuf, ApiError> {
	if path.exists() {
		canonical_existing(path)
	} else {
		canonical_intended(path)
	}
}

fn canonical_skill_roots_for_agent(
	agent: AgentType,
	resource_scope: ResourceScope,
	project_root: Option<&Path>,
) -> Result<Vec<PathBuf>, ApiError> {
	let adapter = create_adapter(agent);
	adapter
		.get_skills_paths(project_root, resource_scope)
		.into_iter()
		.map(|path| canonical_skill_root(&path))
		.collect()
}

fn canonical_skill_roots_for_registered_agents(
	resource_scope: ResourceScope,
	project_root: Option<&Path>,
) -> Result<Vec<PathBuf>, ApiError> {
	let mut roots = Vec::new();
	for agent in AgentType::ALL {
		roots.extend(canonical_skill_roots_for_agent(
			*agent,
			resource_scope,
			project_root,
		)?);
	}
	roots.sort();
	roots.dedup();
	Ok(roots)
}

fn ensure_path_under_roots(
	path: &Path,
	roots: &[PathBuf],
) -> Result<(), ApiError> {
	if roots.iter().any(|root| is_within(path, root)) {
		return Ok(());
	}

	Err(skill_path_error(
		Status::Forbidden,
		format!(
			"Skill path '{}' is outside configured roots",
			path.display()
		),
		SKILL_PATH_OUTSIDE_ROOT,
	))
}

fn requested_skill_dir(path: &Path) -> PathBuf {
	if path.is_dir() {
		return path.to_path_buf();
	}

	if path.is_file()
		|| path.file_name().and_then(|name| name.to_str()) == Some("SKILL.md")
	{
		return get_parent_folder(path.to_path_buf());
	}

	path.to_path_buf()
}

fn remove_skill_dir_or_symlink(path: &Path) -> std::io::Result<()> {
	let metadata = std::fs::symlink_metadata(path)?;
	if metadata.file_type().is_symlink() {
		std::fs::remove_file(path)
	} else {
		std::fs::remove_dir_all(path)
	}
}

#[derive(Debug)]
struct KnownSkillPath {
	file: PathBuf,
	dir: PathBuf,
}

fn known_skill_paths(
	resource_scope: ResourceScope,
	project_root: Option<&Path>,
) -> Vec<KnownSkillPath> {
	load_all_agent_skill_locations(resource_scope, project_root)
		.into_iter()
		.flat_map(|resources| resources.skills)
		.filter_map(|skill| {
			let source_path = skill
				.canonical_path
				.as_deref()
				.or(skill.source_path.as_deref())?;
			let expanded = expand_tilde_path(source_path);
			let file = canonical_existing(&expanded).ok()?;
			let dir =
				canonical_existing(&requested_skill_dir(&expanded)).ok()?;
			Some(KnownSkillPath { file, dir })
		})
		.collect()
}

fn ensure_skill_file_allowed(
	file: &Path,
	roots: &[PathBuf],
	known: &[KnownSkillPath],
) -> Result<(), ApiError> {
	if roots.iter().any(|root| is_within(file, root))
		|| known.iter().any(|path| path.file == file)
	{
		return Ok(());
	}

	Err(skill_path_error(
		Status::Forbidden,
		format!(
			"Skill file '{}' is outside configured roots",
			file.display()
		),
		SKILL_PATH_OUTSIDE_ROOT,
	))
}

fn ensure_skill_tree_allowed(
	dir: &Path,
	roots: &[PathBuf],
	known: &[KnownSkillPath],
) -> Result<(), ApiError> {
	if roots.iter().any(|root| is_within(dir, root))
		|| known.iter().any(|path| is_within(dir, &path.dir))
	{
		return Ok(());
	}

	Err(skill_path_error(
		Status::Forbidden,
		format!(
			"Skill directory '{}' is outside configured roots",
			dir.display()
		),
		SKILL_PATH_OUTSIDE_ROOT,
	))
}

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

#[derive(Clone, Copy)]
enum SkillLinkCopyMode<'a> {
	PreserveWithin(&'a Path),
	MaterializeWithin(&'a Path),
}

fn copy_skill_dir_with_budget(
	from: &Path,
	to: &Path,
	remaining_bytes: &mut u64,
	link_mode: SkillLinkCopyMode<'_>,
) -> Result<u64, ApiError> {
	let link_treatment = match link_mode {
		SkillLinkCopyMode::PreserveWithin(root) => {
			skill::copy::LinkTreatment::PreserveWithin(root)
		}
		SkillLinkCopyMode::MaterializeWithin(root) => {
			skill::copy::LinkTreatment::MaterializeWithin(root)
		}
	};
	skill::copy::copy_directory_with_budget(
		from,
		to,
		remaining_bytes,
		MAX_SKILL_COPY_ENTRIES,
		link_treatment,
	)
	.map_err(map_skill_copy_error)
}

fn map_skill_copy_error(error: skill::copy::SkillCopyError) -> ApiError {
	log::warn!("Skill copy failed: {error}");
	match error {
		skill::copy::SkillCopyError::ByteLimit
		| skill::copy::SkillCopyError::EntryLimit { .. } => skill_copy_write_limit(),
		skill::copy::SkillCopyError::SourceNotDirectory { .. } => {
			skill_copy_invalid_source("Skill copy source is not a directory")
		}
		skill::copy::SkillCopyError::LinkCycle { .. } => {
			skill_copy_invalid_source("Skill copy contains a link cycle")
		}
		skill::copy::SkillCopyError::UnsupportedEntry { .. } => {
			skill_copy_invalid_source(
				"Skill copy only supports files and directories",
			)
		}
		skill::copy::SkillCopyError::LinkInspection { .. } => {
			skill_copy_invalid_source(
				"Skill source contains a link that could not be inspected",
			)
		}
		skill::copy::SkillCopyError::InvalidLink { status, .. } => {
			skill_copy_invalid_source(format!(
				"Skill source contains a {} symbolic link",
				skill_link_status_name(status)
			))
		}
		skill::copy::SkillCopyError::AbsoluteLink { .. } => {
			skill_copy_invalid_source(
				"Skill copy cannot preserve an absolute symbolic link",
			)
		}
		skill::copy::SkillCopyError::UnresolvedLink { .. } => {
			skill_copy_invalid_source(
				"Skill source contains a link that could not be resolved",
			)
		}
		skill::copy::SkillCopyError::UnsupportedLinkTarget { .. } => {
			skill_copy_invalid_source(
				"Skill source link does not resolve to a file or directory",
			)
		}
		skill::copy::SkillCopyError::Io(error) => {
			ApiError::from(ConfigError::Io(error))
		}
	}
}

fn skill_copy_invalid_source(message: impl Into<String>) -> ApiError {
	ApiError::new(Status::BadRequest, message, INVALID_SKILL_PATH)
}

fn skill_link_status_name(
	status: skill::link::SkillLinkStatus,
) -> &'static str {
	match status {
		skill::link::SkillLinkStatus::Valid => "valid",
		skill::link::SkillLinkStatus::Broken => "broken",
		skill::link::SkillLinkStatus::OutsideRoot => "out-of-root",
		skill::link::SkillLinkStatus::Unreadable => "unreadable",
	}
}

fn skill_copy_write_limit() -> ApiError {
	ApiError::new(
		Status::PayloadTooLarge,
		"Skill copy exceeds its batch write limit",
		"SKILL_COPY_WRITE_LIMIT",
	)
}

#[cfg(test)]
fn cleanup_path(path: &Path) {
	let _ = remove_path_if_exists(path);
}

fn remove_path_if_exists(path: &Path) -> std::io::Result<()> {
	let metadata = match std::fs::symlink_metadata(path) {
		Ok(metadata) => metadata,
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			return Ok(())
		}
		Err(error) => return Err(error),
	};
	if metadata.file_type().is_symlink() || !metadata.is_dir() {
		std::fs::remove_file(path)
	} else {
		std::fs::remove_dir_all(path)
	}
}

#[derive(Debug)]
struct StagedSkillReplacement {
	target: PathBuf,
	staged: PathBuf,
	backup: PathBuf,
	target_exists: bool,
}

struct SkillCopyPathCleanupFailure {
	path: PathBuf,
	error: std::io::Error,
}

fn remove_skill_copy_temp(path: &Path) -> Option<SkillCopyPathCleanupFailure> {
	remove_path_if_exists(path)
		.err()
		.map(|error| SkillCopyPathCleanupFailure {
			path: path.to_path_buf(),
			error,
		})
}

fn finish_skill_copy_temp_cleanup(
	error: ApiError,
	failures: Vec<SkillCopyPathCleanupFailure>,
) -> ApiError {
	if failures.is_empty() {
		return error;
	}
	let preserved = failures
		.into_iter()
		.map(|failure| {
			format!("'{}' ({})", failure.path.display(), failure.error)
		})
		.collect::<Vec<_>>()
		.join("; ");
	ApiError::new(
		Status::InternalServerError,
		format!(
			"Skill copy operation failed after '{}'; remove the preserved temporary paths: {preserved}",
			error.body.error
		),
		"SKILL_COPY_TEMP_CLEANUP_FAILED",
	)
}

#[cfg(test)]
fn stage_skill_dir_replacement(
	source_dir: &Path,
	target_dir: &Path,
) -> Result<StagedSkillReplacement, ApiError> {
	stage_skill_dir_replacement_with(source_dir, target_dir, |from, to| {
		let mut remaining_bytes = MAX_SKILL_COPY_RESOLUTION_BATCH_WRITE_BYTES;
		copy_skill_dir_with_budget(
			from,
			to,
			&mut remaining_bytes,
			SkillLinkCopyMode::PreserveWithin(from),
		)
		.map(|_| ())
	})
}

fn stage_skill_dir_replacement_with_budget(
	source_dir: &Path,
	target_dir: &Path,
	remaining_bytes: &mut u64,
) -> Result<StagedSkillReplacement, ApiError> {
	stage_skill_dir_replacement_with(source_dir, target_dir, |from, to| {
		copy_skill_dir_with_budget(
			from,
			to,
			remaining_bytes,
			SkillLinkCopyMode::PreserveWithin(from),
		)
		.map(|_| ())
	})
}

fn stage_git_skill_dir_replacement(
	repository_root: &Path,
	source_dir: &Path,
	target_dir: &Path,
) -> Result<StagedSkillReplacement, ApiError> {
	stage_skill_dir_replacement_with(source_dir, target_dir, |from, to| {
		let mut remaining_bytes = MAX_SKILL_COPY_RESOLUTION_BATCH_WRITE_BYTES;
		copy_skill_dir_with_budget(
			from,
			to,
			&mut remaining_bytes,
			SkillLinkCopyMode::MaterializeWithin(repository_root),
		)
		.map(|_| ())
	})
}

fn stage_skill_dir_replacement_with<F>(
	source_dir: &Path,
	target_dir: &Path,
	copy: F,
) -> Result<StagedSkillReplacement, ApiError>
where
	F: FnOnce(&Path, &Path) -> Result<(), ApiError>,
{
	let parent = target_dir.parent().ok_or_else(|| {
		skill_path_error(
			Status::BadRequest,
			format!("Skill path '{}' has no parent", target_dir.display()),
			INVALID_SKILL_PATH,
		)
	})?;
	let target_name = target_dir
		.file_name()
		.and_then(|name| name.to_str())
		.unwrap_or("skill");
	let suffix = uuid::Uuid::new_v4().simple().to_string();
	let staged = parent.join(format!(".aghub-tmp-{target_name}-{suffix}"));
	let backup = parent.join(format!(".aghub-backup-{target_name}-{suffix}"));

	for path in [&staged, &backup] {
		match std::fs::symlink_metadata(path) {
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
			Err(error) => return Err(ApiError::from(ConfigError::Io(error))),
			Ok(_) => {
				return Err(ApiError::new(
					Status::InternalServerError,
					format!(
						"Generated skill copy path already exists: '{}'",
						path.display()
					),
					"SKILL_COPY_TEMP_PATH_COLLISION",
				));
			}
		}
	}
	if let Err(error) = copy(source_dir, &staged) {
		return Err(finish_skill_copy_temp_cleanup(
			error,
			remove_skill_copy_temp(&staged).into_iter().collect(),
		));
	}
	if let Err(error) = skill::parser::parse(&staged) {
		let parse_error = ApiError::new(
			Status::BadRequest,
			format!("Replacement skill is invalid: {error}"),
			"SKILL_PARSE_FAILED",
		);
		return Err(finish_skill_copy_temp_cleanup(
			parse_error,
			remove_skill_copy_temp(&staged).into_iter().collect(),
		));
	}

	Ok(StagedSkillReplacement {
		target: target_dir.to_path_buf(),
		staged,
		backup,
		target_exists: std::fs::symlink_metadata(target_dir).is_ok(),
	})
}

fn stage_skill_copy_replacements_with_budget(
	source_dir: &Path,
	target_dirs: &[PathBuf],
	source_bytes: u64,
	remaining_bytes: &mut u64,
) -> Result<Vec<StagedSkillReplacement>, ApiError> {
	let projected_bytes = source_bytes
		.checked_mul(target_dirs.len() as u64)
		.ok_or_else(skill_copy_write_limit)?;
	if projected_bytes > *remaining_bytes {
		return Err(skill_copy_write_limit());
	}

	let mut replacements = Vec::with_capacity(target_dirs.len());
	for target_dir in target_dirs {
		let replacement = match stage_skill_dir_replacement_with_budget(
			source_dir,
			target_dir,
			remaining_bytes,
		) {
			Ok(replacement) => replacement,
			Err(error) => {
				return Err(finish_skill_copy_temp_cleanup(
					error,
					cleanup_staged_skill_replacements(&replacements),
				));
			}
		};
		replacements.push(replacement);
	}
	Ok(replacements)
}

fn cleanup_staged_skill_replacements(
	replacements: &[StagedSkillReplacement],
) -> Vec<SkillCopyPathCleanupFailure> {
	replacements
		.iter()
		.filter_map(|replacement| remove_skill_copy_temp(&replacement.staged))
		.collect()
}

struct SkillCopyRecoveryFailure {
	target: PathBuf,
	backup: Option<PathBuf>,
	error: std::io::Error,
}

fn rollback_staged_skill_replacement(
	replacement: &StagedSkillReplacement,
	target_replaced: bool,
) -> Result<(), SkillCopyRecoveryFailure> {
	if target_replaced {
		if let Err(error) = remove_path_if_exists(&replacement.target) {
			return Err(SkillCopyRecoveryFailure {
				target: replacement.target.clone(),
				backup: replacement
					.target_exists
					.then(|| replacement.backup.clone()),
				error,
			});
		}
	}
	if replacement.target_exists {
		std::fs::rename(&replacement.backup, &replacement.target).map_err(
			|error| SkillCopyRecoveryFailure {
				target: replacement.target.clone(),
				backup: Some(replacement.backup.clone()),
				error,
			},
		)?;
	}
	Ok(())
}

fn apply_staged_skill_replacements(
	replacements: &[StagedSkillReplacement],
) -> Result<(), ApiError> {
	apply_staged_skill_replacements_with_backup_check(replacements, |_, _| {
		Ok(())
	})
}

fn apply_staged_skill_replacements_with_backup_check<F>(
	replacements: &[StagedSkillReplacement],
	check_backup: F,
) -> Result<(), ApiError>
where
	F: FnMut(usize, &StagedSkillReplacement) -> Result<(), ApiError>,
{
	apply_staged_skill_replacements_with_checks(
		replacements,
		check_backup,
		remove_path_if_exists,
	)
}

fn apply_staged_skill_replacements_with_checks<F, G>(
	replacements: &[StagedSkillReplacement],
	mut check_backup: F,
	mut cleanup_backup: G,
) -> Result<(), ApiError>
where
	F: FnMut(usize, &StagedSkillReplacement) -> Result<(), ApiError>,
	G: FnMut(&Path) -> std::io::Result<()>,
{
	for (index, replacement) in replacements.iter().enumerate() {
		let moved = if replacement.target_exists {
			if let Err(error) =
				std::fs::rename(&replacement.target, &replacement.backup)
			{
				return Err(finish_skill_copy_batch_failure(
					ApiError::from(ConfigError::Io(error)),
					replacements,
					index,
					false,
				));
			}
			true
		} else {
			false
		};

		if let Err(error) = check_backup(index, replacement) {
			return Err(finish_skill_copy_batch_failure(
				error,
				replacements,
				index,
				moved,
			));
		}

		if let Err(error) =
			std::fs::rename(&replacement.staged, &replacement.target)
		{
			return Err(finish_skill_copy_batch_failure(
				ApiError::from(ConfigError::Io(error)),
				replacements,
				index,
				moved,
			));
		}
	}

	let mut cleanup_failures = Vec::new();
	for replacement in replacements {
		if let Err(error) = cleanup_backup(&replacement.backup) {
			cleanup_failures
				.push(format!("'{}' ({error})", replacement.backup.display()));
		}
	}
	if !cleanup_failures.is_empty() {
		return Err(ApiError::new(
			Status::InternalServerError,
			format!(
				"Skill copies were replaced, but backup cleanup failed. Remove the preserved backups: {}",
				cleanup_failures.join("; ")
			),
			"SKILL_COPY_BACKUP_CLEANUP_FAILED",
		));
	}
	Ok(())
}

fn finish_skill_copy_batch_failure(
	error: ApiError,
	replacements: &[StagedSkillReplacement],
	activated: usize,
	current_moved: bool,
) -> ApiError {
	let mut recovery_failures = Vec::new();
	if current_moved {
		if let Err(failure) =
			rollback_staged_skill_replacement(&replacements[activated], false)
		{
			recovery_failures.push(failure);
		}
	}
	for replacement in replacements[..activated].iter().rev() {
		if let Err(failure) =
			rollback_staged_skill_replacement(replacement, true)
		{
			recovery_failures.push(failure);
		}
	}
	let temp_cleanup_failures = cleanup_staged_skill_replacements(replacements);

	if recovery_failures.is_empty() {
		return finish_skill_copy_temp_cleanup(error, temp_cleanup_failures);
	}

	let recovery_steps = recovery_failures
		.into_iter()
		.map(|failure| match failure.backup {
			Some(backup) => format!(
				"restore '{}' to '{}' ({})",
				backup.display(),
				failure.target.display(),
				failure.error
			),
			None => format!(
				"remove partial target '{}' ({})",
				failure.target.display(),
				failure.error
			),
		})
		.chain(temp_cleanup_failures.into_iter().map(|failure| {
			format!(
				"remove temporary path '{}' ({})",
				failure.path.display(),
				failure.error
			)
		}))
		.collect::<Vec<_>>()
		.join("; ");
	ApiError::new(
		Status::InternalServerError,
		format!(
			"Skill copy rollback failed after '{}'; manual recovery: {recovery_steps}",
			error.body.error
		),
		"SKILL_COPY_ROLLBACK_FAILED",
	)
}

#[cfg(test)]
fn replace_skill_dir_staged(
	source_dir: &Path,
	target_dir: &Path,
) -> Result<(), ApiError> {
	let replacement = stage_skill_dir_replacement(source_dir, target_dir)?;
	apply_staged_skill_replacements(&[replacement])
}

fn replace_git_skill_dir_staged(
	repository_root: &Path,
	source_dir: &Path,
	target_dir: &Path,
) -> Result<(), ApiError> {
	let replacement = stage_git_skill_dir_replacement(
		repository_root,
		source_dir,
		target_dir,
	)?;
	apply_staged_skill_replacements(&[replacement])
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

#[post("/skills/diff", data = "<body>")]
pub async fn diff_skill(
	_auth: ApiAuth,
	body: Json<SkillDiffRequest>,
	sessions: &rocket::State<GitCloneSessions>,
) -> ApiResult<SkillDiffResponse> {
	let request = body.into_inner();
	if !(1..=MAX_SKILL_DIFF_TARGETS).contains(&request.installed_paths.len()) {
		return Err(ApiError::new(
			Status::BadRequest,
			format!(
				"Skill diff requires 1 to {MAX_SKILL_DIFF_TARGETS} installed paths"
			),
			"SKILL_DIFF_TARGET_LIMIT",
		));
	}

	enum PreparedSkillDiffReference {
		Installed(String),
		GitScan {
			temp_path: PathBuf,
			scanned_skill_paths: HashSet<String>,
			skill_path: String,
		},
	}

	let reference = match request.reference {
		SkillDiffReferenceRequest::Installed { source_path } => {
			PreparedSkillDiffReference::Installed(source_path)
		}
		SkillDiffReferenceRequest::GitScan {
			session_id,
			skill_path,
		} => {
			let (temp_path, scanned_skill_paths) = {
				let map = sessions.sessions.lock().unwrap();
				let session = map.get(&session_id).ok_or_else(|| {
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
			PreparedSkillDiffReference::GitScan {
				temp_path,
				scanned_skill_paths,
				skill_path,
			}
		}
	};
	let scope = ScopeParams {
		scope: request.scope,
		project_root: request.project_root,
	};
	let installed_paths = request.installed_paths;

	let permit = SKILL_DIFF_PERMITS
		.acquire()
		.await
		.expect("static skill diff semaphore remains open");
	let response = tokio::task::spawn_blocking(move || {
		let _permit = permit;
		let resolved = scope.resolve()?;
		let (resource_scope, project_root) =
			resolved_to_resource_scope(&resolved);
		let roots = canonical_skill_roots_for_registered_agents(
			resource_scope,
			project_root.as_deref(),
		)
		.map_err(public_skill_diff_path_error)?;
		let known = known_skill_paths(resource_scope, project_root.as_deref());
		let reference_dir = match reference {
			PreparedSkillDiffReference::Installed(source_path) => {
				validated_diff_directory(&source_path, &roots, &known)?
			}
			PreparedSkillDiffReference::GitScan {
				temp_path,
				scanned_skill_paths,
				skill_path,
			} => {
				let (_, path) = validate_scanned_skill_path(
					&temp_path,
					&scanned_skill_paths,
					&skill_path,
				)
				.map_err(public_skill_diff_path_error)?;
				canonical_existing(&get_skill_root(path))
					.map_err(public_skill_diff_path_error)?
			}
		};
		let mut target_dirs = Vec::with_capacity(installed_paths.len());
		for installed_path in installed_paths {
			let target_dir =
				match validated_diff_directory(&installed_path, &roots, &known)
				{
					Ok(path) => path,
					Err(_) => {
						target_dirs.push(None);
						continue;
					}
				};
			target_dirs.push(Some(target_dir));
		}
		compare_skill_diff_batch(&reference_dir, target_dirs)
	})
	.await
	.map_err(|error| {
		ApiError::new(
			Status::InternalServerError,
			format!("Skill diff task failed: {error}"),
			"SKILL_DIFF_TASK_FAILED",
		)
	})??;

	Ok(Json(response))
}

#[post("/skills/copies/status", data = "<body>")]
pub async fn get_skill_copy_status(
	_auth: ApiAuth,
	body: Json<SkillCopyStatusRequest>,
) -> ApiResult<SkillCopyStatusResponse> {
	let request = body.into_inner();
	if !(1..=MAX_SKILL_COPY_STATUS_GROUPS).contains(&request.groups.len()) {
		return Err(ApiError::new(
			Status::BadRequest,
			format!(
				"Skill copy status requires 1 to {MAX_SKILL_COPY_STATUS_GROUPS} groups"
			),
			"SKILL_COPY_STATUS_GROUP_LIMIT",
		));
	}
	let path_count = request
		.groups
		.iter()
		.map(|group| group.source_paths.len())
		.sum::<usize>();
	if path_count > MAX_SKILL_COPY_STATUS_PATHS
		|| request.groups.iter().any(|group| {
			!(2..=MAX_SKILL_COPY_LOCATIONS).contains(&group.source_paths.len())
		}) {
		return Err(ApiError::new(
			Status::BadRequest,
			format!(
				"Skill copy status accepts 2 to {MAX_SKILL_COPY_LOCATIONS} paths per group and {MAX_SKILL_COPY_STATUS_PATHS} paths total"
			),
			"SKILL_COPY_STATUS_PATH_LIMIT",
		));
	}
	let mut names = HashSet::with_capacity(request.groups.len());
	if request
		.groups
		.iter()
		.any(|group| group.name.is_empty() || !names.insert(group.name.clone()))
	{
		return Err(ApiError::new(
			Status::BadRequest,
			"Skill copy status group names must be unique and non-empty",
			"INVALID_SKILL_COPY_STATUS_GROUP",
		));
	}

	let scope = ScopeParams {
		scope: request.scope,
		project_root: request.project_root,
	};
	let groups = request.groups;
	let permit = SKILL_DIFF_PERMITS
		.acquire()
		.await
		.expect("static skill diff semaphore remains open");
	let response =
		tokio::task::spawn_blocking(move || -> Result<_, ApiError> {
			let _permit = permit;
			let resolved = scope.resolve()?;
			let (resource_scope, project_root) =
				resolved_to_resource_scope(&resolved);
			let roots = canonical_skill_roots_for_registered_agents(
				resource_scope,
				project_root.as_deref(),
			)
			.map_err(public_skill_diff_path_error)?;
			let known =
				known_skill_paths(resource_scope, project_root.as_deref());
			let mut remaining_snapshot_bytes = MAX_SKILL_DIFF_BATCH_BYTES;
			let mut results = Vec::with_capacity(groups.len());

			for group in groups {
				let mut hashes = HashSet::new();
				let mut seen_paths = HashSet::new();
				let mut unavailable = 0;
				for source_path in group.source_paths {
					let directory = match validated_diff_directory(
						&source_path,
						&roots,
						&known,
					) {
						Ok(directory) => directory,
						Err(_) => {
							unavailable += 1;
							continue;
						}
					};
					if !seen_paths.insert(directory.clone()) {
						continue;
					}
					match skill::snapshot::snapshot_directory_with_budget(
						&directory,
						&mut remaining_snapshot_bytes,
					) {
						Ok(snapshot) => {
							hashes.insert(snapshot.hash);
						}
						Err(error) => {
							log_skill_diff_snapshot_error(error);
							unavailable += 1;
						}
					}
				}
				results.push(SkillCopyStatusResult {
					name: group.name,
					has_differences: hashes.len() > 1,
					unavailable,
				});
			}

			Ok::<_, ApiError>(SkillCopyStatusResponse { results })
		})
		.await
		.map_err(|error| {
			ApiError::new(
				Status::InternalServerError,
				format!("Skill copy status task failed: {error}"),
				"SKILL_COPY_STATUS_TASK_FAILED",
			)
		})??;

	Ok(Json(response))
}

#[post("/skills/copies/resolve", data = "<body>")]
pub async fn resolve_skill_copies(
	_auth: ApiAuth,
	body: Json<SkillCopyResolutionRequest>,
	sessions: &rocket::State<GitCloneSessions>,
) -> ApiResult<SkillCopyResolutionResponse> {
	let request = body.into_inner();
	if !(1..=MAX_SKILL_COPY_RESOLUTION_TARGETS).contains(&request.targets.len())
	{
		return Err(ApiError::new(
			Status::BadRequest,
			format!(
				"Skill copy resolution requires 1 to {MAX_SKILL_COPY_RESOLUTION_TARGETS} targets"
			),
			"SKILL_COPY_TARGET_LIMIT",
		));
	}
	if request.scope.as_deref() == Some("all") && request.project_root.is_none()
	{
		return Err(ApiError::new(
			Status::BadRequest,
			"project_root is required when resolving copies with scope=all",
			"MISSING_PARAM",
		));
	}

	enum PreparedReference {
		Installed(String),
		GitScan {
			session_id: String,
			temp_path: PathBuf,
			scanned_skill_paths: HashSet<String>,
			skill_path: String,
		},
	}

	let reference = match request.reference {
		SkillDiffReferenceRequest::Installed { source_path } => {
			PreparedReference::Installed(source_path)
		}
		SkillDiffReferenceRequest::GitScan {
			session_id,
			skill_path,
		} => {
			let (temp_path, scanned_skill_paths) = {
				let map = sessions.sessions.lock().unwrap();
				let session = map.get(&session_id).ok_or_else(|| {
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
			PreparedReference::GitScan {
				session_id,
				temp_path,
				scanned_skill_paths,
				skill_path,
			}
		}
	};
	let scope = ScopeParams {
		scope: request.scope,
		project_root: request.project_root,
	};
	let expected_reference_hash = request.expected_reference_hash;
	let storage_mode = request.storage_mode;
	let targets = request.targets;

	let permit = SKILL_COPY_RESOLUTION_PERMITS
		.acquire()
		.await
		.expect("static skill copy resolution semaphore remains open");
	let response = tokio::task::spawn_blocking(move || {
		let _permit = permit;
		let resolved = scope.resolve()?;
		if !resolved.is_all() {
			require_writable_scope(&resolved)?;
		}
		let (resource_scope, project_root) =
			resolved_to_resource_scope(&resolved);
		let roots = canonical_skill_roots_for_registered_agents(
			resource_scope,
			project_root.as_deref(),
		)
		.map_err(public_skill_copy_path_error)?;
		let known = known_skill_paths(resource_scope, project_root.as_deref());
		let (reference_dir, materialize_root, git_session_id) = match reference
		{
			PreparedReference::Installed(source_path) => {
				let requested = validate_existing_skill_target_dir(
					&source_path,
					&roots,
					&known,
				)
				.map_err(public_skill_copy_path_error)?;
				let canonical = canonical_existing(&requested)
					.map_err(public_skill_copy_path_error)?;
				(canonical.clone(), canonical, None)
			}
			PreparedReference::GitScan {
				session_id,
				temp_path,
				scanned_skill_paths,
				skill_path,
			} => {
				let (_, path) = validate_scanned_skill_path(
					&temp_path,
					&scanned_skill_paths,
					&skill_path,
				)
				.map_err(public_skill_copy_path_error)?;
				let reference_dir = canonical_existing(&get_skill_root(path))
					.map_err(public_skill_copy_path_error)?;
				let materialize_root = canonical_existing(&temp_path)
					.map_err(public_skill_copy_path_error)?;
				(reference_dir, materialize_root, Some(session_id))
			}
		};
		let mut remaining_snapshot_bytes =
			MAX_SKILL_COPY_RESOLUTION_BATCH_BYTES;
		let reference_hash = skill_copy_directory_hash(
			&reference_dir,
			&mut remaining_snapshot_bytes,
		)?;
		if reference_hash != expected_reference_hash {
			return Err(skill_copy_changed());
		}
		let initial_reference_name = parse_skill_name(&reference_dir)?;

		struct PreparedTarget {
			source_paths: Vec<(usize, String)>,
			content_dir: PathBuf,
			write_dir: Option<PathBuf>,
			expected_hash: String,
			write_is_symlink: bool,
		}

		let mut seen_source_paths = HashSet::new();
		let mut prepared_targets = Vec::with_capacity(targets.len());
		for (request_index, target) in targets.into_iter().enumerate() {
			if !seen_source_paths.insert(target.source_path.clone()) {
				return Err(ApiError::new(
					Status::BadRequest,
					"Skill copy targets must be unique",
					"DUPLICATE_SKILL_COPY_TARGET",
				));
			}
			let requested_dir = validate_existing_skill_target_dir(
				&target.source_path,
				&roots,
				&known,
			)
			.map_err(public_skill_copy_path_error)?;
			let content_dir = canonical_existing(&requested_dir)
				.map_err(public_skill_copy_path_error)?;
			let entry_dir = existing_skill_entry_path(&requested_dir)
				.map_err(public_skill_copy_path_error)?;
			let entry_is_symlink = std::fs::symlink_metadata(&entry_dir)
				.map_err(|error| ApiError::from(ConfigError::Io(error)))?
				.file_type()
				.is_symlink();
			let write_dir = match storage_mode {
				SkillCopyStorageModeRequest::Preserve
					if content_dir == reference_dir =>
				{
					None
				}
				SkillCopyStorageModeRequest::Preserve => {
					Some(content_dir.clone())
				}
				SkillCopyStorageModeRequest::Copy => Some(entry_dir),
			};
			let materializes_reference =
				matches!(storage_mode, SkillCopyStorageModeRequest::Copy)
					&& content_dir == reference_dir;
			if let Some(write_dir) = &write_dir {
				if !materializes_reference
					&& skill_copy_paths_overlap(write_dir, &reference_dir)
				{
					return Err(skill_copy_path_overlap());
				}
			}
			if let Some(existing) = prepared_targets.iter_mut().find(
				|prepared: &&mut PreparedTarget| {
					prepared.write_dir == write_dir
						&& prepared.content_dir == content_dir
				},
			) {
				if existing.expected_hash != target.expected_hash {
					return Err(skill_copy_changed());
				}
				existing
					.source_paths
					.push((request_index, target.source_path));
				continue;
			}
			if let Some(write_dir) = &write_dir {
				if prepared_targets.iter().any(|prepared: &PreparedTarget| {
					prepared.write_dir.as_ref().is_some_and(|prepared_dir| {
						skill_copy_paths_overlap(write_dir, prepared_dir)
					})
				}) {
					return Err(skill_copy_path_overlap());
				}
			}
			prepared_targets.push(PreparedTarget {
				source_paths: vec![(request_index, target.source_path)],
				content_dir,
				write_dir,
				expected_hash: target.expected_hash,
				write_is_symlink: matches!(
					storage_mode,
					SkillCopyStorageModeRequest::Copy
				) && entry_is_symlink,
			});
		}

		for target in &prepared_targets {
			let target_hash = skill_copy_directory_hash(
				&target.content_dir,
				&mut remaining_snapshot_bytes,
			)?;
			if target_hash != target.expected_hash {
				return Err(skill_copy_changed());
			}
			if parse_skill_name(&target.content_dir)? != initial_reference_name
			{
				return Err(skill_copy_name_mismatch());
			}
		}

		let frozen_root = tempfile::tempdir()
			.map_err(|error| ApiError::from(ConfigError::Io(error)))?;
		let frozen_reference = frozen_root.path().join("skill");
		let mut remaining_write_bytes =
			MAX_SKILL_COPY_RESOLUTION_BATCH_WRITE_BYTES;
		let link_mode = match storage_mode {
			SkillCopyStorageModeRequest::Preserve => {
				SkillLinkCopyMode::PreserveWithin(&reference_dir)
			}
			SkillCopyStorageModeRequest::Copy => {
				SkillLinkCopyMode::MaterializeWithin(&materialize_root)
			}
		};
		let frozen_bytes = copy_skill_dir_with_budget(
			&reference_dir,
			&frozen_reference,
			&mut remaining_write_bytes,
			link_mode,
		)?;
		let frozen_hash = skill_copy_directory_hash(
			&frozen_reference,
			&mut remaining_snapshot_bytes,
		)?;
		let current_reference_hash = skill_copy_directory_hash(
			&reference_dir,
			&mut remaining_snapshot_bytes,
		)?;
		if current_reference_hash != reference_hash {
			return Err(skill_copy_changed());
		}
		let reference_name = parse_skill_name(&frozen_reference)?;
		if reference_name != initial_reference_name {
			return Err(skill_copy_changed());
		}

		let mut writable_targets = prepared_targets
			.iter()
			.filter(|target| target.write_dir.is_some())
			.collect::<Vec<_>>();
		writable_targets.sort_by_key(|target| !target.write_is_symlink);
		let target_dirs = writable_targets
			.iter()
			.filter_map(|target| target.write_dir.clone())
			.collect::<Vec<_>>();
		let replacements = stage_skill_copy_replacements_with_budget(
			&frozen_reference,
			&target_dirs,
			frozen_bytes,
			&mut remaining_write_bytes,
		)?;

		apply_staged_skill_replacements_with_backup_check(
			&replacements,
			|index, replacement| {
				let target = writable_targets[index];
				let backup_content = if target.write_is_symlink {
					target.content_dir.clone()
				} else {
					canonical_existing(&replacement.backup)
						.map_err(public_skill_copy_path_error)?
				};
				let target_hash = skill_copy_directory_hash(
					&backup_content,
					&mut remaining_snapshot_bytes,
				)?;
				if target_hash != target.expected_hash {
					return Err(skill_copy_changed());
				}
				if parse_skill_name(&backup_content)? != reference_name {
					return Err(skill_copy_name_mismatch());
				}
				Ok(())
			},
		)?;
		let mut results = Vec::new();
		for target in prepared_targets {
			for (index, source_path) in target.source_paths {
				results.push((
					index,
					SkillCopyResolutionResult {
						source_path,
						content_hash: frozen_hash.clone(),
					},
				));
			}
		}
		results.sort_by_key(|(index, _)| *index);
		let results = results.into_iter().map(|(_, result)| result).collect();

		Ok((
			SkillCopyResolutionResponse {
				name: reference_name,
				reference_hash,
				results,
			},
			git_session_id,
		))
	})
	.await
	.map_err(|error| {
		ApiError::new(
			Status::InternalServerError,
			format!("Skill copy resolution task failed: {error}"),
			"SKILL_COPY_TASK_FAILED",
		)
	})??;

	if let Some(session_id) = response.1 {
		sessions.sessions.lock().unwrap().remove(&session_id);
	}

	Ok(Json(response.0))
}

fn parse_skill_name(path: &Path) -> Result<String, ApiError> {
	skill::parser::parse(path)
		.map(|skill| skill.name)
		.map_err(|error| {
			ApiError::new(
				Status::BadRequest,
				format!("Invalid skill copy: {error}"),
				"SKILL_COPY_PARSE_FAILED",
			)
		})
}

fn skill_copy_directory_hash(
	path: &Path,
	remaining_bytes: &mut u64,
) -> Result<String, ApiError> {
	skill::snapshot::snapshot_directory_with_budget(path, remaining_bytes)
		.map(|snapshot| encode_snapshot_hash(snapshot.hash))
		.map_err(public_skill_copy_snapshot_error)
}

fn skill_copy_changed() -> ApiError {
	ApiError::new(
		Status::Conflict,
		"A skill copy changed after comparison; compare again before resolving",
		"SKILL_COPY_CHANGED",
	)
}

fn skill_copy_name_mismatch() -> ApiError {
	ApiError::new(
		Status::BadRequest,
		"Skill copies must have the same name",
		"SKILL_COPY_NAME_MISMATCH",
	)
}

fn skill_copy_paths_overlap(first: &Path, second: &Path) -> bool {
	is_within(first, second) || is_within(second, first)
}

fn skill_copy_path_overlap() -> ApiError {
	ApiError::new(
		Status::BadRequest,
		"Skill copy paths cannot contain one another",
		"OVERLAPPING_SKILL_COPY_PATH",
	)
}

fn public_skill_copy_snapshot_error(error: skill::SkillError) -> ApiError {
	log::warn!("Skill copy snapshot failed: {error}");
	ApiError::new(
		Status::BadRequest,
		"Skill copies could not be read",
		"SKILL_COPY_SNAPSHOT_FAILED",
	)
}

fn public_skill_copy_path_error(error: ApiError) -> ApiError {
	let status = error.status;
	let code = error.body.code;
	log::warn!("Skill copy path validation failed: {}", error.body.error);
	let message = match code {
		SKILL_PATH_OUTSIDE_ROOT => "Skill path is outside configured roots",
		SKILL_PATH_NOT_FOUND => "Skill path was not found",
		INVALID_SKILL_PATH => "Skill path is invalid",
		_ => "Skill path could not be resolved",
	};
	ApiError::new(status, message, code)
}

fn compare_skill_diff_batch(
	reference_dir: &Path,
	target_dirs: Vec<Option<PathBuf>>,
) -> Result<SkillDiffResponse, ApiError> {
	let mut remaining_snapshot_bytes = MAX_SKILL_DIFF_BATCH_BYTES;
	let reference = skill::snapshot::snapshot_directory_with_budget(
		reference_dir,
		&mut remaining_snapshot_bytes,
	)
	.map_err(public_skill_diff_snapshot_error)?;
	let mut results = Vec::with_capacity(target_dirs.len());
	let mut remaining_preview_bytes = MAX_SKILL_DIFF_RESPONSE_PREVIEW_BYTES;
	for target_dir in target_dirs {
		let Some(target_dir) = target_dir else {
			results.push(None);
			continue;
		};
		let target = match skill::snapshot::snapshot_directory_with_budget(
			&target_dir,
			&mut remaining_snapshot_bytes,
		) {
			Ok(snapshot) => snapshot,
			Err(error) => {
				log_skill_diff_snapshot_error(error);
				results.push(None);
				continue;
			}
		};
		let mut response = skill_directory_diff_response(
			skill::snapshot::diff_snapshots(&reference, &target),
		);
		retain_skill_diff_previews(&mut response, &mut remaining_preview_bytes);
		results.push(Some(response));
	}

	Ok(SkillDiffResponse { results })
}

fn validated_diff_directory(
	source_path: &str,
	roots: &[PathBuf],
	known: &[KnownSkillPath],
) -> Result<PathBuf, ApiError> {
	let path = validate_existing_skill_target_dir(source_path, roots, known)
		.map_err(public_skill_diff_path_error)?;
	canonical_existing(&path).map_err(public_skill_diff_path_error)
}

fn skill_directory_diff_response(
	diff: skill::snapshot::DirectoryDiff,
) -> SkillDirectoryDiffResponse {
	let files = diff
		.files
		.into_iter()
		.map(|file| SkillFileDiffResponse {
			path: file.path,
			change: match file.kind {
				FileDiffKind::Added => SkillFileDiffKindResponse::Added,
				FileDiffKind::Removed => SkillFileDiffKindResponse::Removed,
				FileDiffKind::Modified => SkillFileDiffKindResponse::Modified,
			},
			before: file.before,
			after: file.after,
			before_link: file.before_link.map(skill_link_response),
			after_link: file.after_link.map(skill_link_response),
			content_omitted: file.content_omitted,
		})
		.collect();

	SkillDirectoryDiffResponse {
		identical: diff.identical,
		base_hash: encode_snapshot_hash(diff.base_hash),
		target_hash: encode_snapshot_hash(diff.target_hash),
		files,
		files_omitted: diff.files_omitted,
	}
}

fn retain_skill_diff_previews(
	diff: &mut SkillDirectoryDiffResponse,
	remaining_bytes: &mut usize,
) {
	for file in &mut diff.files {
		if file.content_omitted {
			file.before = None;
			file.after = None;
			continue;
		}

		let preview_bytes = file.before.as_ref().map_or(0, String::len)
			+ file.after.as_ref().map_or(0, String::len);
		if preview_bytes <= *remaining_bytes {
			*remaining_bytes -= preview_bytes;
			continue;
		}

		file.before = None;
		file.after = None;
		file.content_omitted = true;
	}
}

fn public_skill_diff_snapshot_error(error: skill::SkillError) -> ApiError {
	log_skill_diff_snapshot_error(error);
	ApiError::new(
		Status::BadRequest,
		"Skill directories could not be compared",
		"SKILL_DIFF_FAILED",
	)
}

fn log_skill_diff_snapshot_error(error: skill::SkillError) {
	log::warn!("Skill directory comparison failed: {error}");
}

fn public_skill_diff_path_error(error: ApiError) -> ApiError {
	let status = error.status;
	let code = error.body.code;
	log::warn!("Skill diff path validation failed: {}", error.body.error);
	let message = match code {
		SKILL_PATH_OUTSIDE_ROOT => "Skill path is outside configured roots",
		SKILL_PATH_NOT_FOUND => "Skill path was not found",
		INVALID_SKILL_PATH => "Skill path is invalid",
		_ => "Skill path could not be resolved",
	};
	ApiError::new(status, message, code)
}

fn encode_snapshot_hash(hash: [u8; 32]) -> String {
	const HEX: &[u8; 16] = b"0123456789abcdef";
	let mut encoded = String::with_capacity(hash.len() * 2);
	for byte in hash {
		encoded.push(HEX[(byte >> 4) as usize] as char);
		encoded.push(HEX[(byte & 0x0f) as usize] as char);
	}
	encoded
}

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
