use aghub_core::errors::ConfigError;
use rocket::{http::Status, serde::json::Json};
use skill::snapshot::FileDiffKind;
use std::{
	collections::HashSet,
	path::{Path, PathBuf},
};

use crate::{
	auth::ApiAuth,
	dto::skill::{
		SkillCopyResolutionRequest, SkillCopyResolutionResponse,
		SkillCopyResolutionResult, SkillCopyStatusRequest,
		SkillCopyStatusResponse, SkillCopyStatusResult,
		SkillCopyStorageModeRequest, SkillDiffReferenceRequest,
		SkillDiffRequest, SkillDiffResponse, SkillDirectoryDiffResponse,
		SkillFileDiffKindResponse, SkillFileDiffResponse,
	},
	error::{ApiError, ApiResult},
	extractors::ScopeParams,
	routes::{require_writable_scope, resolved_to_resource_scope},
	state::GitCloneSessions,
};

use super::{
	apply_staged_skill_replacements_with_backup_check, canonical_existing,
	canonical_skill_roots_for_registered_agents, copy_skill_dir_with_budget,
	existing_skill_entry_path, get_skill_root, is_within, known_skill_paths,
	lease_git_session, should_return_audit_review, skill_hard_link_response,
	skill_link_response, stage_skill_copy_replacements_with_budget,
	validate_existing_skill_target_dir, validate_scanned_skill_path,
	GitCloneSessionKind, KnownSkillPath, SkillImportReview, SkillLinkCopyMode,
	INVALID_SKILL_PATH, MAX_SKILL_COPY_LOCATIONS,
	MAX_SKILL_COPY_RESOLUTION_BATCH_BYTES,
	MAX_SKILL_COPY_RESOLUTION_BATCH_WRITE_BYTES,
	MAX_SKILL_COPY_RESOLUTION_PREPARATION_BYTES,
	MAX_SKILL_COPY_RESOLUTION_TARGETS, MAX_SKILL_COPY_STATUS_GROUPS,
	MAX_SKILL_COPY_STATUS_PATHS, MAX_SKILL_DIFF_BATCH_BYTES,
	MAX_SKILL_DIFF_RESPONSE_PREVIEW_BYTES, MAX_SKILL_DIFF_TARGETS,
	SKILL_COPY_RESOLUTION_PERMITS, SKILL_DIFF_PERMITS, SKILL_PATH_NOT_FOUND,
	SKILL_PATH_OUTSIDE_ROOT,
};

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
			session: crate::state::GitCloneSessionLease,
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
			let session = lease_git_session(
				sessions,
				&session_id,
				GitCloneSessionKind::GitScan,
			)?;
			PreparedSkillDiffReference::GitScan {
				session,
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
				session,
				skill_path,
			} => {
				let (_, path) = validate_scanned_skill_path(
					session.temp_dir.path(),
					&session.scanned_skill_paths,
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
			session: crate::state::GitCloneSessionLease,
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
			let session = lease_git_session(
				sessions,
				&session_id,
				GitCloneSessionKind::GitScan,
			)?;
			PreparedReference::GitScan {
				session_id,
				session,
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
	let expected_content_digest = request.expected_content_digest;
	let confirmed_assessment_digest = request.confirmed_assessment_digest;
	let audit_only = request.audit_only.unwrap_or(false);

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
				session,
				skill_path,
			} => {
				let (_, path) = validate_scanned_skill_path(
					session.temp_dir.path(),
					&session.scanned_skill_paths,
					&skill_path,
				)
				.map_err(public_skill_copy_path_error)?;
				let reference_dir = canonical_existing(&get_skill_root(path))
					.map_err(public_skill_copy_path_error)?;
				let materialize_root =
					canonical_existing(session.temp_dir.path())
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
		let mut remaining_preparation_bytes =
			MAX_SKILL_COPY_RESOLUTION_PREPARATION_BYTES;
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
			&mut remaining_preparation_bytes,
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
		let audit = if git_session_id.is_some() {
			let audit_root = tempfile::tempdir()
				.map_err(|error| ApiError::from(ConfigError::Io(error)))?;
			let audit_reference = audit_root.path().join("skill");
			copy_skill_dir_with_budget(
				&frozen_reference,
				&audit_reference,
				&mut remaining_preparation_bytes,
				SkillLinkCopyMode::MaterializeWithin(&frozen_reference),
			)?;
			Some(SkillImportReview::prepare(&[audit_reference])?)
		} else {
			None
		};
		let audit_confirmation_required = audit
			.as_ref()
			.is_some_and(SkillImportReview::confirmation_required);
		let return_review = match &audit {
			Some(review) => should_return_audit_review(
				review,
				audit_only,
				expected_content_digest.as_deref(),
				confirmed_assessment_digest.as_deref(),
			)?,
			None => audit_only,
		};
		if return_review {
			return Ok((
				SkillCopyResolutionResponse {
					name: reference_name,
					reference_hash,
					results: Vec::new(),
					audit: audit.map(|review| review.report.into()),
					audit_confirmation_required,
				},
				None,
			));
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
		let mut remaining_write_bytes =
			MAX_SKILL_COPY_RESOLUTION_BATCH_WRITE_BYTES;
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
				audit: audit.map(|review| review.report.into()),
				audit_confirmation_required,
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
		sessions.remove(&session_id);
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

pub(super) fn skill_directory_diff_response(
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
			before_hard_link: file
				.before_hard_link
				.map(skill_hard_link_response),
			after_hard_link: file.after_hard_link.map(skill_hard_link_response),
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

pub(super) fn retain_skill_diff_previews(
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
