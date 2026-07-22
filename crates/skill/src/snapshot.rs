use crate::error::Result;
use crate::link::{inspect_skill_link, SkillLink, SkillLinkStatus};
use crate::SkillError;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;
use std::path::Path;
use walkdir::{DirEntry, WalkDir};

const SNAPSHOT_DOMAIN: &[u8] = b"aghub-skill-snapshot-v2\0";
const SYMLINK_SNAPSHOT_DOMAIN: &[u8] = b"aghub-skill-symlink-v1\0";
const REPOSITORY_METADATA_DIRS: &[&str] = &[".git", ".hg", ".svn"];
const FILE_READ_BUFFER_BYTES: usize = 64 * 1024;
// Interactive comparisons are bounded so a skill cannot monopolize the
// desktop API while its files are hashed and prepared for display.
const MAX_SNAPSHOT_ENTRIES: usize = 10_000;
const MAX_SNAPSHOT_BYTES: u64 = 128 * 1024 * 1024;
const MAX_FILE_DIFFS: usize = 100;
const TEXT_PREVIEW_LIMIT_BYTES: usize = 256 * 1024;
const TEXT_PREVIEW_LIMIT_LINES: usize = 2_000;
const TOTAL_TEXT_PREVIEW_LIMIT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone)]
struct SnapshotFile {
	hash: [u8; 32],
	preview: Option<String>,
	link: Option<SkillLink>,
}

#[derive(Debug, Clone)]
pub struct SkillDirectorySnapshot {
	pub hash: [u8; 32],
	files: BTreeMap<String, SnapshotFile>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileDiffKind {
	Added,
	Removed,
	Modified,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileDiff {
	pub path: String,
	pub kind: FileDiffKind,
	pub before: Option<String>,
	pub after: Option<String>,
	pub before_link: Option<SkillLink>,
	pub after_link: Option<SkillLink>,
	pub content_omitted: bool,
}

#[derive(Debug, Clone)]
pub struct DirectoryDiff {
	pub identical: bool,
	pub base_hash: [u8; 32],
	pub target_hash: [u8; 32],
	pub files: Vec<FileDiff>,
	pub files_omitted: usize,
}

pub fn snapshot_directory(root: &Path) -> Result<SkillDirectorySnapshot> {
	let mut remaining_bytes = MAX_SNAPSHOT_BYTES;
	snapshot_directory_with_budget(root, &mut remaining_bytes)
}

/// Snapshot a directory while charging file reads to a shared byte budget.
pub fn snapshot_directory_with_budget(
	root: &Path,
	remaining_bytes: &mut u64,
) -> Result<SkillDirectorySnapshot> {
	if *remaining_bytes == 0 {
		return Err(SkillError::InvalidFormat(
			"Skill snapshot comparison byte budget is exhausted".to_string(),
		));
	}
	let root_metadata = std::fs::symlink_metadata(root)?;
	if root_metadata.file_type().is_symlink() {
		return Err(SkillError::InvalidFormat(format!(
			"Skill snapshot root cannot be a symbolic link: {}",
			root.display()
		)));
	}
	if !root_metadata.is_dir() {
		return Err(SkillError::InvalidFormat(format!(
			"Skill snapshot root is not a directory: {}",
			root.display()
		)));
	}

	let mut files = BTreeMap::new();
	let mut entry_count = 0;
	let mut total_bytes = 0;
	let mut preview_bytes = 0;
	// The BTreeMap below determines hash order without buffering each directory.
	for entry in WalkDir::new(root)
		.follow_links(false)
		.into_iter()
		.filter_entry(include_snapshot_entry)
	{
		let entry = entry.map_err(|error| {
			SkillError::InvalidFormat(format!(
				"Failed to read skill directory: {error}"
			))
		})?;
		if entry.depth() == 0 {
			continue;
		}
		entry_count += 1;
		if entry_count > MAX_SNAPSHOT_ENTRIES {
			return Err(SkillError::InvalidFormat(format!(
				"Skill snapshot exceeds the {MAX_SNAPSHOT_ENTRIES}-entry comparison limit"
			)));
		}

		let file_type = entry.file_type();
		if file_type.is_symlink() {
			let relative = relative_snapshot_path(root, entry.path())?;
			let link = inspect_skill_link(root, entry.path())?;
			let file = snapshot_link(link, &mut total_bytes, remaining_bytes)?;
			files.insert(relative, file);
			continue;
		}
		if file_type.is_dir() {
			continue;
		}
		if !file_type.is_file() {
			return Err(SkillError::InvalidFormat(format!(
				"Skill snapshot only supports files and directories: {}",
				entry.path().display()
			)));
		}

		let relative = relative_snapshot_path(root, entry.path())?;
		let file = snapshot_file(
			entry.path(),
			&mut total_bytes,
			remaining_bytes,
			&mut preview_bytes,
		)?;
		files.insert(relative, file);
	}

	let mut hasher = Sha256::new();
	hasher.update(SNAPSHOT_DOMAIN);
	for (path, file) in &files {
		let path_bytes = path.as_bytes();
		hasher.update((path_bytes.len() as u64).to_be_bytes());
		hasher.update(path_bytes);
		hasher.update(file.hash);
	}

	Ok(SkillDirectorySnapshot {
		hash: hasher.finalize().into(),
		files,
	})
}

pub fn diff_snapshots(
	base: &SkillDirectorySnapshot,
	target: &SkillDirectorySnapshot,
) -> DirectoryDiff {
	let paths = base
		.files
		.keys()
		.chain(target.files.keys())
		.cloned()
		.collect::<BTreeSet<_>>();
	let mut files = Vec::new();
	let mut files_omitted = 0;

	for path in paths {
		let before_file = base.files.get(&path);
		let after_file = target.files.get(&path);
		let kind = match (before_file, after_file) {
			(Some(before), Some(after)) if before.hash == after.hash => {
				continue
			}
			(Some(_), Some(_)) => FileDiffKind::Modified,
			(None, Some(_)) => FileDiffKind::Added,
			(Some(_), None) => FileDiffKind::Removed,
			(None, None) => continue,
		};
		if files.len() >= MAX_FILE_DIFFS {
			files_omitted += 1;
			continue;
		}

		let before = before_file.and_then(|file| file.preview.clone());
		let after = after_file.and_then(|file| file.preview.clone());
		let before_link = before_file.and_then(|file| file.link.clone());
		let after_link = after_file.and_then(|file| file.link.clone());
		let content_omitted = before_file
			.is_some_and(|file| file.link.is_none() && file.preview.is_none())
			|| after_file.is_some_and(|file| {
				file.link.is_none() && file.preview.is_none()
			});
		files.push(FileDiff {
			path,
			kind,
			before,
			after,
			before_link,
			after_link,
			content_omitted,
		});
	}

	DirectoryDiff {
		identical: base.hash == target.hash,
		base_hash: base.hash,
		target_hash: target.hash,
		files,
		files_omitted,
	}
}

pub fn compare_directories(
	base: &Path,
	target: &Path,
) -> Result<DirectoryDiff> {
	let base = snapshot_directory(base)?;
	let target = snapshot_directory(target)?;
	Ok(diff_snapshots(&base, &target))
}

fn include_snapshot_entry(entry: &DirEntry) -> bool {
	if entry.depth() == 0 {
		return true;
	}

	!entry
		.file_name()
		.to_str()
		.is_some_and(|name| REPOSITORY_METADATA_DIRS.contains(&name))
}

fn relative_snapshot_path(root: &Path, path: &Path) -> Result<String> {
	let relative = path.strip_prefix(root)?;
	let mut parts = Vec::new();
	for component in relative.components() {
		let value = component.as_os_str().to_str().ok_or_else(|| {
			SkillError::InvalidFormat(format!(
				"Skill snapshot path is not valid UTF-8: {}",
				path.display()
			))
		})?;
		parts.push(value);
	}
	Ok(parts.join("/"))
}

fn snapshot_file(
	path: &Path,
	total_bytes: &mut u64,
	remaining_bytes: &mut u64,
	preview_bytes: &mut usize,
) -> Result<SnapshotFile> {
	let mut source = std::fs::File::open(path)?;
	let mut hasher = Sha256::new();
	let mut buffer = [0; FILE_READ_BUFFER_BYTES];
	let mut preview = Some(Vec::new());
	let mut preview_lines = 1;

	loop {
		let count = source.read(&mut buffer)?;
		if count == 0 {
			break;
		}

		charge_snapshot_bytes(count, total_bytes, remaining_bytes)?;

		hasher.update(&buffer[..count]);
		let next_preview_lines = preview_lines
			+ buffer[..count]
				.iter()
				.filter(|byte| **byte == b'\n')
				.count();
		let can_extend_preview = preview.as_ref().is_some_and(|content| {
			let next_length = content.len() + count;
			next_length <= TEXT_PREVIEW_LIMIT_BYTES
				&& next_preview_lines <= TEXT_PREVIEW_LIMIT_LINES
				&& next_length
					<= TOTAL_TEXT_PREVIEW_LIMIT_BYTES
						.saturating_sub(*preview_bytes)
		});
		if can_extend_preview {
			preview_lines = next_preview_lines;
			preview
				.as_mut()
				.expect("preview exists when extension is allowed")
				.extend_from_slice(&buffer[..count]);
		} else {
			preview = None;
		}
	}

	let preview = preview.and_then(|content| String::from_utf8(content).ok());
	if let Some(content) = &preview {
		*preview_bytes += content.len();
	}

	Ok(SnapshotFile {
		hash: hasher.finalize().into(),
		preview,
		link: None,
	})
}

fn snapshot_link(
	link: SkillLink,
	total_bytes: &mut u64,
	remaining_bytes: &mut u64,
) -> Result<SnapshotFile> {
	charge_snapshot_bytes(link.target.len(), total_bytes, remaining_bytes)?;
	let mut hasher = Sha256::new();
	hasher.update(SYMLINK_SNAPSHOT_DOMAIN);
	hasher.update([match link.status {
		SkillLinkStatus::Valid => 0,
		SkillLinkStatus::Broken => 1,
		SkillLinkStatus::OutsideRoot => 2,
		SkillLinkStatus::Unreadable => 3,
	}]);
	hasher.update(link.target.as_bytes());

	Ok(SnapshotFile {
		hash: hasher.finalize().into(),
		preview: None,
		link: Some(link),
	})
}

fn charge_snapshot_bytes(
	count: usize,
	total_bytes: &mut u64,
	remaining_bytes: &mut u64,
) -> Result<()> {
	*total_bytes = total_bytes.checked_add(count as u64).ok_or_else(|| {
		SkillError::InvalidFormat(
			"Skill snapshot byte count overflowed".to_string(),
		)
	})?;
	if *total_bytes > MAX_SNAPSHOT_BYTES {
		return Err(SkillError::InvalidFormat(format!(
			"Skill snapshot exceeds the {} MiB comparison limit",
			MAX_SNAPSHOT_BYTES / 1024 / 1024
		)));
	}
	if count as u64 > *remaining_bytes {
		*remaining_bytes = 0;
		return Err(SkillError::InvalidFormat(
			"Skill snapshot comparison byte budget is exhausted".to_string(),
		));
	}
	*remaining_bytes -= count as u64;
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;
	use tempfile::tempdir;

	#[test]
	fn directory_diff_reports_text_and_file_changes() {
		let temp = tempdir().unwrap();
		let base = temp.path().join("base");
		let target = temp.path().join("target");
		std::fs::create_dir_all(&base).unwrap();
		std::fs::create_dir_all(&target).unwrap();
		std::fs::write(base.join("SKILL.md"), "alpha\nbeta\n").unwrap();
		std::fs::write(target.join("SKILL.md"), "alpha\ngamma\n").unwrap();
		std::fs::write(base.join("removed.txt"), "removed\n").unwrap();
		std::fs::write(target.join("added.txt"), "added\n").unwrap();

		let diff = compare_directories(&base, &target).unwrap();

		assert!(!diff.identical);
		assert_eq!(diff.files.len(), 3);
		assert_eq!(diff.files[0].path, "SKILL.md");
		assert_eq!(diff.files[0].kind, FileDiffKind::Modified);
		assert_eq!(diff.files[0].before.as_deref(), Some("alpha\nbeta\n"));
		assert_eq!(diff.files[0].after.as_deref(), Some("alpha\ngamma\n"));
		assert_eq!(diff.files[1].path, "added.txt");
		assert_eq!(diff.files[1].kind, FileDiffKind::Added);
		assert_eq!(diff.files[2].path, "removed.txt");
		assert_eq!(diff.files[2].kind, FileDiffKind::Removed);
	}

	#[test]
	fn directory_diff_ignores_repository_metadata() {
		let temp = tempdir().unwrap();
		let base = temp.path().join("base");
		let target = temp.path().join("target");
		std::fs::create_dir_all(base.join(".git")).unwrap();
		std::fs::create_dir_all(&target).unwrap();
		std::fs::write(base.join("SKILL.md"), "same\n").unwrap();
		std::fs::write(target.join("SKILL.md"), "same\n").unwrap();
		std::fs::write(base.join(".git/config"), "private metadata").unwrap();

		let diff = compare_directories(&base, &target).unwrap();

		assert!(diff.identical);
		assert!(diff.files.is_empty());
	}

	#[test]
	fn directory_diff_ignores_worktree_metadata_file() {
		let temp = tempdir().unwrap();
		let base = temp.path().join("base");
		let target = temp.path().join("target");
		std::fs::create_dir_all(&base).unwrap();
		std::fs::create_dir_all(&target).unwrap();
		std::fs::write(base.join("SKILL.md"), "same\n").unwrap();
		std::fs::write(target.join("SKILL.md"), "same\n").unwrap();
		std::fs::write(base.join(".git"), "gitdir: /private/worktree").unwrap();

		let diff = compare_directories(&base, &target).unwrap();

		assert!(diff.identical);
		assert!(diff.files.is_empty());
	}

	#[test]
	fn directory_diff_omits_large_text_preview() {
		let temp = tempdir().unwrap();
		let base = temp.path().join("base");
		let target = temp.path().join("target");
		std::fs::create_dir_all(&base).unwrap();
		std::fs::create_dir_all(&target).unwrap();
		std::fs::write(base.join("large.txt"), "small").unwrap();
		std::fs::write(
			target.join("large.txt"),
			"x".repeat(TEXT_PREVIEW_LIMIT_BYTES + 1),
		)
		.unwrap();

		let diff = compare_directories(&base, &target).unwrap();

		assert_eq!(diff.files.len(), 1);
		assert!(diff.files[0].content_omitted);
		assert_eq!(diff.files[0].before.as_deref(), Some("small"));
		assert!(diff.files[0].after.is_none());
	}

	#[test]
	fn directory_diff_omits_high_line_count_preview() {
		let temp = tempdir().unwrap();
		let base = temp.path().join("base");
		let target = temp.path().join("target");
		std::fs::create_dir_all(&base).unwrap();
		std::fs::create_dir_all(&target).unwrap();
		std::fs::write(base.join("many-lines.txt"), "small").unwrap();
		std::fs::write(
			target.join("many-lines.txt"),
			"x\n".repeat(TEXT_PREVIEW_LIMIT_LINES + 1),
		)
		.unwrap();

		let diff = compare_directories(&base, &target).unwrap();

		assert_eq!(diff.files.len(), 1);
		assert!(diff.files[0].content_omitted);
		assert!(diff.files[0].after.is_none());
	}

	#[test]
	fn directory_diff_bounds_total_text_preview() {
		let temp = tempdir().unwrap();
		let base = temp.path().join("base");
		let target = temp.path().join("target");
		std::fs::create_dir_all(&base).unwrap();
		std::fs::create_dir_all(&target).unwrap();
		for index in 0..9 {
			std::fs::write(
				target.join(format!("{index}.txt")),
				"x".repeat(TEXT_PREVIEW_LIMIT_BYTES),
			)
			.unwrap();
		}

		let diff = compare_directories(&base, &target).unwrap();

		assert_eq!(diff.files.len(), 9);
		assert!(diff.files.iter().any(|file| !file.content_omitted));
		assert!(diff.files.iter().any(|file| file.content_omitted));
	}

	#[test]
	fn directory_diff_bounds_changed_file_list() {
		let temp = tempdir().unwrap();
		let base = temp.path().join("base");
		let target = temp.path().join("target");
		std::fs::create_dir_all(&base).unwrap();
		std::fs::create_dir_all(&target).unwrap();
		for index in 0..=MAX_FILE_DIFFS {
			std::fs::write(target.join(format!("{index:03}.txt")), "changed")
				.unwrap();
		}

		let diff = compare_directories(&base, &target).unwrap();

		assert_eq!(diff.files.len(), MAX_FILE_DIFFS);
		assert_eq!(diff.files_omitted, 1);
		assert!(!diff.identical);
	}

	#[test]
	fn snapshot_hash_is_independent_of_file_creation_order() {
		let temp = tempdir().unwrap();
		let first = temp.path().join("first");
		let second = temp.path().join("second");
		std::fs::create_dir_all(&first).unwrap();
		std::fs::create_dir_all(&second).unwrap();
		std::fs::write(first.join("b.txt"), "b").unwrap();
		std::fs::write(first.join("a.txt"), "a").unwrap();
		std::fs::write(second.join("a.txt"), "a").unwrap();
		std::fs::write(second.join("b.txt"), "b").unwrap();

		let first = snapshot_directory(&first).unwrap();
		let second = snapshot_directory(&second).unwrap();

		assert_eq!(first.hash, second.hash);
	}

	#[test]
	fn snapshots_share_a_read_budget() {
		let temp = tempdir().unwrap();
		let first = temp.path().join("first");
		let second = temp.path().join("second");
		std::fs::create_dir_all(&first).unwrap();
		std::fs::create_dir_all(&second).unwrap();
		std::fs::write(first.join("SKILL.md"), "1234").unwrap();
		std::fs::write(second.join("SKILL.md"), "5678").unwrap();
		let mut remaining_bytes = 6;

		snapshot_directory_with_budget(&first, &mut remaining_bytes).unwrap();
		let error =
			snapshot_directory_with_budget(&second, &mut remaining_bytes)
				.unwrap_err();

		assert_eq!(remaining_bytes, 0);
		assert!(error.to_string().contains("byte budget"));
	}

	#[cfg(unix)]
	#[test]
	fn directory_diff_accepts_matching_symlinked_content() {
		let temp = tempdir().unwrap();
		let base = temp.path().join("base");
		let target = temp.path().join("target");
		std::fs::create_dir_all(&base).unwrap();
		std::fs::create_dir_all(&target).unwrap();
		std::fs::write(base.join("SKILL.md"), "same\n").unwrap();
		std::fs::write(target.join("SKILL.md"), "same\n").unwrap();
		std::os::unix::fs::symlink("SKILL.md", base.join("linked.md")).unwrap();
		std::os::unix::fs::symlink("SKILL.md", target.join("linked.md"))
			.unwrap();

		let diff = compare_directories(&base, &target).unwrap();

		assert!(diff.identical);
		assert!(diff.files.is_empty());
	}

	#[cfg(unix)]
	#[test]
	fn directory_diff_reports_changed_symlink_target() {
		let temp = tempdir().unwrap();
		let base = temp.path().join("base");
		let target = temp.path().join("target");
		std::fs::create_dir_all(&base).unwrap();
		std::fs::create_dir_all(&target).unwrap();
		std::fs::write(base.join("first.txt"), "first").unwrap();
		std::fs::write(target.join("second.txt"), "second").unwrap();
		std::os::unix::fs::symlink("first.txt", base.join("linked.txt"))
			.unwrap();
		std::os::unix::fs::symlink("second.txt", target.join("linked.txt"))
			.unwrap();

		let diff = compare_directories(&base, &target).unwrap();
		let link_diff = diff
			.files
			.iter()
			.find(|file| file.path == "linked.txt")
			.unwrap();

		assert_eq!(link_diff.kind, FileDiffKind::Modified);
		assert_eq!(link_diff.before_link.as_ref().unwrap().target, "first.txt");
		assert_eq!(link_diff.after_link.as_ref().unwrap().target, "second.txt");
		assert!(!link_diff.content_omitted);
	}
}
