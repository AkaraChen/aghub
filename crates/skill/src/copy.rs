use crate::link::{inspect_skill_link, SkillLinkStatus};
use crate::SkillError;
use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const COPY_BUFFER_BYTES: usize = 64 * 1024;
const REPOSITORY_METADATA_DIRS: &[&str] = &[".git", ".hg", ".svn"];

#[derive(Debug, thiserror::Error)]
pub enum SkillCopyError {
	#[error("Skill copy source is not a directory: {path:?}")]
	SourceNotDirectory { path: PathBuf },
	#[error("Skill copy contains a link cycle at {path:?}")]
	LinkCycle { path: PathBuf },
	#[error("Skill copy does not support source entry {path:?}")]
	UnsupportedEntry { path: PathBuf },
	#[error("Failed to inspect skill source link {path:?}: {source}")]
	LinkInspection { path: PathBuf, source: SkillError },
	#[error("Skill source contains a {status:?} symbolic link at {path:?}")]
	InvalidLink {
		path: PathBuf,
		status: SkillLinkStatus,
	},
	#[error("Skill copy cannot preserve absolute symbolic link {path:?}")]
	AbsoluteLink { path: PathBuf },
	#[error("Skill source link could not be resolved at {path:?}")]
	UnresolvedLink { path: PathBuf },
	#[error(
		"Skill source link does not resolve to a file or directory at {path:?}"
	)]
	UnsupportedLinkTarget { path: PathBuf },
	#[error("Skill copy exceeds the {max_entries}-entry limit")]
	EntryLimit { max_entries: usize },
	#[error("Skill copy exceeds its byte limit")]
	ByteLimit,
	#[error(transparent)]
	Io(#[from] std::io::Error),
}

#[derive(Clone, Copy)]
pub enum LinkTreatment<'a> {
	PreserveWithin(&'a Path),
	MaterializeWithin(&'a Path),
}

pub fn copy_directory_with_budget(
	from: &Path,
	to: &Path,
	remaining_bytes: &mut u64,
	max_entries: usize,
	link_treatment: LinkTreatment<'_>,
) -> Result<u64, SkillCopyError> {
	let metadata = std::fs::symlink_metadata(from)?;
	if metadata.file_type().is_symlink() || !metadata.is_dir() {
		return Err(SkillCopyError::SourceNotDirectory {
			path: from.to_path_buf(),
		});
	}

	let initial_bytes = *remaining_bytes;
	let mut entry_count = 0;
	let mut active_directories = HashSet::new();
	std::fs::create_dir_all(to)?;
	copy_directory_entries(
		from,
		to,
		remaining_bytes,
		max_entries,
		&mut entry_count,
		link_treatment,
		&mut active_directories,
	)?;
	Ok(initial_bytes - *remaining_bytes)
}

fn copy_directory_entries(
	from: &Path,
	to: &Path,
	remaining_bytes: &mut u64,
	max_entries: usize,
	entry_count: &mut usize,
	link_treatment: LinkTreatment<'_>,
	active_directories: &mut HashSet<PathBuf>,
) -> Result<(), SkillCopyError> {
	let canonical_from = std::fs::canonicalize(from)?;
	if !active_directories.insert(canonical_from.clone()) {
		return Err(SkillCopyError::LinkCycle {
			path: from.to_path_buf(),
		});
	}

	for entry in std::fs::read_dir(from)? {
		let entry = entry?;
		let name = entry.file_name();
		if name
			.to_str()
			.is_some_and(|name| REPOSITORY_METADATA_DIRS.contains(&name))
		{
			continue;
		}

		*entry_count = entry_count.saturating_add(1);
		if *entry_count > max_entries {
			return Err(SkillCopyError::EntryLimit { max_entries });
		}

		let from_path = entry.path();
		let to_path = to.join(&name);
		let file_type = entry.file_type()?;
		if file_type.is_symlink() {
			copy_link(
				&from_path,
				&to_path,
				remaining_bytes,
				max_entries,
				entry_count,
				link_treatment,
				active_directories,
			)?;
			continue;
		}
		if file_type.is_dir() {
			std::fs::create_dir(&to_path)?;
			copy_directory_entries(
				&from_path,
				&to_path,
				remaining_bytes,
				max_entries,
				entry_count,
				link_treatment,
				active_directories,
			)?;
			continue;
		}
		if !file_type.is_file() {
			return Err(SkillCopyError::UnsupportedEntry { path: from_path });
		}
		copy_file(&from_path, &to_path, remaining_bytes)?;
	}

	active_directories.remove(&canonical_from);
	Ok(())
}

fn copy_link(
	from: &Path,
	to: &Path,
	remaining_bytes: &mut u64,
	max_entries: usize,
	entry_count: &mut usize,
	link_treatment: LinkTreatment<'_>,
	active_directories: &mut HashSet<PathBuf>,
) -> Result<(), SkillCopyError> {
	let allowed_root = match link_treatment {
		LinkTreatment::PreserveWithin(root)
		| LinkTreatment::MaterializeWithin(root) => root,
	};
	let link = inspect_skill_link(allowed_root, from).map_err(|error| {
		SkillCopyError::LinkInspection {
			path: from.to_path_buf(),
			source: error,
		}
	})?;
	if link.status != SkillLinkStatus::Valid {
		return Err(SkillCopyError::InvalidLink {
			path: from.to_path_buf(),
			status: link.status,
		});
	}

	if matches!(link_treatment, LinkTreatment::PreserveWithin(_)) {
		let target = &link.target;
		if target.is_absolute() {
			return Err(SkillCopyError::AbsoluteLink {
				path: from.to_path_buf(),
			});
		}
		charge_bytes(
			target.as_os_str().as_encoded_bytes().len(),
			remaining_bytes,
		)?;
		return create_symlink(target, to, link.resolved_path.as_deref());
	}

	let resolved =
		link.resolved_path
			.ok_or_else(|| SkillCopyError::UnresolvedLink {
				path: from.to_path_buf(),
			})?;
	let metadata = std::fs::symlink_metadata(&resolved)?;
	if metadata.is_dir() {
		std::fs::create_dir(to)?;
		return copy_directory_entries(
			&resolved,
			to,
			remaining_bytes,
			max_entries,
			entry_count,
			link_treatment,
			active_directories,
		);
	}
	if metadata.is_file() {
		return copy_file(&resolved, to, remaining_bytes);
	}

	Err(SkillCopyError::UnsupportedLinkTarget {
		path: from.to_path_buf(),
	})
}

#[cfg(unix)]
fn create_symlink(
	target: &Path,
	path: &Path,
	_resolved: Option<&Path>,
) -> Result<(), SkillCopyError> {
	std::os::unix::fs::symlink(target, path)?;
	Ok(())
}

#[cfg(windows)]
fn create_symlink(
	target: &Path,
	path: &Path,
	resolved: Option<&Path>,
) -> Result<(), SkillCopyError> {
	let resolved = resolved.ok_or_else(|| SkillCopyError::UnresolvedLink {
		path: path.to_path_buf(),
	})?;
	if std::fs::metadata(resolved)?.is_dir() {
		std::os::windows::fs::symlink_dir(target, path)?;
	} else {
		std::os::windows::fs::symlink_file(target, path)?;
	}
	Ok(())
}

fn copy_file(
	from: &Path,
	to: &Path,
	remaining_bytes: &mut u64,
) -> Result<(), SkillCopyError> {
	let mut source = std::fs::File::open(from)?;
	let permissions = source.metadata()?.permissions();
	let mut destination = std::fs::OpenOptions::new()
		.write(true)
		.create_new(true)
		.open(to)?;
	let mut buffer = [0; COPY_BUFFER_BYTES];

	loop {
		let read_limit = remaining_bytes
			.saturating_add(1)
			.min(COPY_BUFFER_BYTES as u64) as usize;
		let count = source.read(&mut buffer[..read_limit])?;
		if count == 0 {
			break;
		}
		charge_bytes(count, remaining_bytes)?;
		destination.write_all(&buffer[..count])?;
	}
	output_file(destination, to, permissions)
}

fn output_file(
	mut destination: std::fs::File,
	to: &Path,
	permissions: std::fs::Permissions,
) -> Result<(), SkillCopyError> {
	destination.flush()?;
	drop(destination);
	std::fs::set_permissions(to, permissions)?;
	Ok(())
}

fn charge_bytes(
	count: usize,
	remaining_bytes: &mut u64,
) -> Result<(), SkillCopyError> {
	if count as u64 > *remaining_bytes {
		*remaining_bytes = 0;
		return Err(SkillCopyError::ByteLimit);
	}
	*remaining_bytes -= count as u64;
	Ok(())
}

#[cfg(all(test, unix))]
mod tests {
	use super::*;
	use tempfile::tempdir;

	#[test]
	fn preserves_relative_file_link() {
		let temp = tempdir().unwrap();
		let source = temp.path().join("source");
		let target = temp.path().join("target");
		std::fs::create_dir_all(&source).unwrap();
		std::fs::write(source.join("notes.txt"), "notes").unwrap();
		std::os::unix::fs::symlink("notes.txt", source.join("linked.txt"))
			.unwrap();
		let mut remaining = 1024;

		copy_directory_with_budget(
			&source,
			&target,
			&mut remaining,
			10,
			LinkTreatment::PreserveWithin(&source),
		)
		.unwrap();

		assert!(std::fs::symlink_metadata(target.join("linked.txt"))
			.unwrap()
			.file_type()
			.is_symlink());
		assert_eq!(
			std::fs::read_link(target.join("linked.txt")).unwrap(),
			PathBuf::from("notes.txt")
		);
	}

	#[test]
	fn materializes_file_link() {
		let temp = tempdir().unwrap();
		let source = temp.path().join("source");
		let target = temp.path().join("target");
		std::fs::create_dir_all(&source).unwrap();
		std::fs::write(source.join("notes.txt"), "notes").unwrap();
		std::os::unix::fs::symlink("notes.txt", source.join("linked.txt"))
			.unwrap();
		let mut remaining = 1024;

		copy_directory_with_budget(
			&source,
			&target,
			&mut remaining,
			10,
			LinkTreatment::MaterializeWithin(&source),
		)
		.unwrap();

		assert!(std::fs::symlink_metadata(target.join("linked.txt"))
			.unwrap()
			.is_file());
		assert_eq!(
			std::fs::read_to_string(target.join("linked.txt")).unwrap(),
			"notes"
		);
	}

	#[test]
	fn rejects_broken_link_with_typed_error() {
		let temp = tempdir().unwrap();
		let source = temp.path().join("source");
		let target = temp.path().join("target");
		std::fs::create_dir_all(&source).unwrap();
		let link = source.join("linked.txt");
		std::os::unix::fs::symlink("missing.txt", &link).unwrap();
		let mut remaining = 1024;

		let error = copy_directory_with_budget(
			&source,
			&target,
			&mut remaining,
			10,
			LinkTreatment::PreserveWithin(&source),
		)
		.unwrap_err();

		assert!(matches!(
			error,
			SkillCopyError::InvalidLink {
				path,
				status: SkillLinkStatus::Broken,
			} if path == link
		));
	}
}
