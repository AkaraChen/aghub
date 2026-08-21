use aghub_core::errors::ConfigError;
use rocket::http::Status;
use std::path::{Path, PathBuf};

use crate::error::ApiError;

use super::{
	skill_path_error, INVALID_SKILL_PATH, MAX_SKILL_COPY_ENTRIES,
	MAX_SKILL_COPY_RESOLUTION_BATCH_WRITE_BYTES,
};

#[derive(Clone, Copy)]
pub(super) enum SkillLinkCopyMode<'a> {
	PreserveWithin(&'a Path),
	MaterializeWithin(&'a Path),
}

pub(super) fn copy_skill_dir_with_budget(
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
pub(super) fn cleanup_path(path: &Path) {
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
pub(super) struct StagedSkillReplacement {
	pub(super) target: PathBuf,
	pub(super) staged: PathBuf,
	pub(super) backup: PathBuf,
	pub(super) target_exists: bool,
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

pub(super) fn stage_skill_dir_replacement(
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

pub(super) fn stage_skill_dir_replacement_with<F>(
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

pub(super) fn stage_skill_copy_replacements_with_budget(
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

pub(super) fn apply_staged_skill_replacements(
	replacements: &[StagedSkillReplacement],
) -> Result<(), ApiError> {
	apply_staged_skill_replacements_with_backup_check(replacements, |_, _| {
		Ok(())
	})
}

pub(super) fn apply_staged_skill_replacements_with_backup_check<F>(
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

pub(super) fn apply_staged_skill_replacements_with_checks<F, G>(
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

pub(super) fn replace_skill_dir_staged(
	source_dir: &Path,
	target_dir: &Path,
) -> Result<(), ApiError> {
	let replacement = stage_skill_dir_replacement(source_dir, target_dir)?;
	apply_staged_skill_replacements(&[replacement])
}
