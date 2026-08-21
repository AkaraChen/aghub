use crate::error::Result;
use crate::link::{inspect_skill_link, SkillLink, SkillLinkStatus};
use crate::relationship::{hard_link_identity, FileIdentity};
use crate::SkillError;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::io::Read;
use std::path::Path;
use walkdir::{DirEntry, WalkDir};

const SNAPSHOT_DOMAIN: &[u8] = b"aghub-skill-snapshot-v4\0";
const DIRECTORY_SNAPSHOT_DOMAIN: &[u8] = b"aghub-skill-snapshot-directory-v3\0";
const FILE_SNAPSHOT_DOMAIN: &[u8] = b"aghub-skill-snapshot-file-v3\0";
const SYMLINK_SNAPSHOT_DOMAIN: &[u8] = b"aghub-skill-snapshot-symlink-v3\0";
const HARD_LINK_SNAPSHOT_DOMAIN: &[u8] = b"aghub-skill-snapshot-hard-link-v4\0";
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
struct SnapshotEntry {
	hash: [u8; 32],
	preview: Option<String>,
	link: Option<SkillLink>,
	hard_link: Option<HardLink>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HardLink {
	pub peers: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct SkillDirectorySnapshot {
	pub hash: [u8; 32],
	entries: BTreeMap<String, SnapshotEntry>,
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
	pub before_hard_link: Option<HardLink>,
	pub after_hard_link: Option<HardLink>,
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

	let mut entries = BTreeMap::new();
	let mut entry_count = 0;
	let mut total_bytes = 0;
	let mut preview_bytes = 0;
	let mut hard_link_paths: HashMap<FileIdentity, Vec<String>> =
		HashMap::new();
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
		let relative = relative_snapshot_path(root, entry.path())?;
		if file_type.is_symlink() {
			let link = inspect_skill_link(root, entry.path())?;
			let snapshot =
				snapshot_link(link, &mut total_bytes, remaining_bytes)?;
			entries.insert(relative, snapshot);
			continue;
		}
		if file_type.is_dir() {
			entries.insert(relative, snapshot_directory_entry());
			continue;
		}
		if !file_type.is_file() {
			return Err(SkillError::InvalidFormat(format!(
				"Skill snapshot only supports files and directories: {}",
				entry.path().display()
			)));
		}

		let snapshot = snapshot_file(
			entry.path(),
			&mut total_bytes,
			remaining_bytes,
			&mut preview_bytes,
		)?;
		if let Some(identity) =
			hard_link_identity(entry.path(), &std::fs::metadata(entry.path())?)?
		{
			hard_link_paths
				.entry(identity)
				.or_default()
				.push(relative.clone());
		}
		entries.insert(relative, snapshot);
	}
	apply_hard_link_groups(&mut entries, hard_link_paths);

	let mut hasher = Sha256::new();
	hasher.update(SNAPSHOT_DOMAIN);
	for (path, entry) in &entries {
		let path_bytes = path.as_bytes();
		hasher.update((path_bytes.len() as u64).to_be_bytes());
		hasher.update(path_bytes);
		hasher.update(entry.hash);
	}

	Ok(SkillDirectorySnapshot {
		hash: hasher.finalize().into(),
		entries,
	})
}

pub fn diff_snapshots(
	base: &SkillDirectorySnapshot,
	target: &SkillDirectorySnapshot,
) -> DirectoryDiff {
	let paths = base
		.entries
		.keys()
		.chain(target.entries.keys())
		.cloned()
		.collect::<BTreeSet<_>>();
	let mut files = Vec::new();
	let mut files_omitted = 0;

	for path in paths {
		let before_file = base.entries.get(&path);
		let after_file = target.entries.get(&path);
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
		let before_hard_link =
			before_file.and_then(|file| file.hard_link.clone());
		let after_hard_link =
			after_file.and_then(|file| file.hard_link.clone());
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
			before_hard_link,
			after_hard_link,
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

fn apply_hard_link_groups(
	entries: &mut BTreeMap<String, SnapshotEntry>,
	groups: HashMap<FileIdentity, Vec<String>>,
) {
	for mut paths in groups.into_values() {
		if paths.len() < 2 {
			continue;
		}
		paths.sort();
		for path in &paths {
			let Some(entry) = entries.get_mut(path) else {
				continue;
			};
			let mut hasher = Sha256::new();
			hasher.update(HARD_LINK_SNAPSHOT_DOMAIN);
			hasher.update(entry.hash);
			hasher.update((paths.len() as u64).to_be_bytes());
			for member in &paths {
				let bytes = member.as_bytes();
				hasher.update((bytes.len() as u64).to_be_bytes());
				hasher.update(bytes);
			}
			entry.hash = hasher.finalize().into();
			entry.hard_link = Some(HardLink {
				peers: paths
					.iter()
					.filter(|member| *member != path)
					.cloned()
					.collect(),
			});
		}
	}
}

fn snapshot_file(
	path: &Path,
	total_bytes: &mut u64,
	remaining_bytes: &mut u64,
	preview_bytes: &mut usize,
) -> Result<SnapshotEntry> {
	let mut source = std::fs::File::open(path)?;
	let mut hasher = Sha256::new();
	hasher.update(FILE_SNAPSHOT_DOMAIN);
	hasher.update([executable_flag(&source.metadata()?)]);
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

	Ok(SnapshotEntry {
		hash: hasher.finalize().into(),
		preview,
		link: None,
		hard_link: None,
	})
}

fn snapshot_directory_entry() -> SnapshotEntry {
	let mut hasher = Sha256::new();
	hasher.update(DIRECTORY_SNAPSHOT_DOMAIN);
	SnapshotEntry {
		hash: hasher.finalize().into(),
		preview: None,
		link: None,
		hard_link: None,
	}
}

fn snapshot_link(
	link: SkillLink,
	total_bytes: &mut u64,
	remaining_bytes: &mut u64,
) -> Result<SnapshotEntry> {
	let target_bytes = link.target.as_os_str().as_encoded_bytes();
	charge_snapshot_bytes(target_bytes.len(), total_bytes, remaining_bytes)?;
	let mut hasher = Sha256::new();
	hasher.update(SYMLINK_SNAPSHOT_DOMAIN);
	hasher.update([match link.status {
		SkillLinkStatus::Valid => 0,
		SkillLinkStatus::Broken => 1,
		SkillLinkStatus::OutsideRoot => 2,
		SkillLinkStatus::Unreadable => 3,
	}]);
	hasher.update((target_bytes.len() as u64).to_be_bytes());
	hasher.update(target_bytes);

	Ok(SnapshotEntry {
		hash: hasher.finalize().into(),
		preview: None,
		link: Some(link),
		hard_link: None,
	})
}

#[cfg(unix)]
fn executable_flag(metadata: &std::fs::Metadata) -> u8 {
	use std::os::unix::fs::PermissionsExt;

	u8::from(metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn executable_flag(_metadata: &std::fs::Metadata) -> u8 {
	0
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
	fn snapshot_hash_includes_empty_directories() {
		let temp = tempdir().unwrap();
		let base = temp.path().join("base");
		let target = temp.path().join("target");
		std::fs::create_dir_all(&base).unwrap();
		std::fs::create_dir_all(target.join("empty")).unwrap();

		let diff = compare_directories(&base, &target).unwrap();

		assert!(!diff.identical);
		assert_eq!(diff.files.len(), 1);
		assert_eq!(diff.files[0].path, "empty");
		assert_eq!(diff.files[0].kind, FileDiffKind::Added);
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

	#[test]
	fn directory_diff_reports_hard_link_relationship_changes() {
		let temp = tempdir().unwrap();
		let base = temp.path().join("base");
		let target = temp.path().join("target");
		std::fs::create_dir_all(&base).unwrap();
		std::fs::create_dir_all(&target).unwrap();
		std::fs::write(base.join("first.txt"), "same").unwrap();
		std::fs::write(base.join("second.txt"), "same").unwrap();
		std::fs::write(target.join("first.txt"), "same").unwrap();
		std::fs::hard_link(target.join("first.txt"), target.join("second.txt"))
			.unwrap();

		let diff = compare_directories(&base, &target).unwrap();

		assert!(!diff.identical);
		assert_eq!(diff.files.len(), 2);
		for file in diff.files {
			assert!(file.before_hard_link.is_none());
			assert_eq!(file.after_hard_link.unwrap().peers.len(), 1);
		}
	}

	#[test]
	fn matching_hard_link_groups_are_identical() {
		let temp = tempdir().unwrap();
		let base = temp.path().join("base");
		let target = temp.path().join("target");
		std::fs::create_dir_all(&base).unwrap();
		std::fs::create_dir_all(&target).unwrap();
		for root in [&base, &target] {
			std::fs::write(root.join("first.txt"), "same").unwrap();
			std::fs::hard_link(root.join("first.txt"), root.join("second.txt"))
				.unwrap();
		}

		let diff = compare_directories(&base, &target).unwrap();

		assert!(diff.identical);
		assert!(diff.files.is_empty());
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
	fn snapshot_hash_distinguishes_file_from_symlink() {
		let temp = tempdir().unwrap();
		let base = temp.path().join("base");
		let target = temp.path().join("target");
		std::fs::create_dir_all(&base).unwrap();
		std::fs::create_dir_all(&target).unwrap();
		std::fs::write(base.join("target.txt"), "target").unwrap();
		std::fs::write(target.join("target.txt"), "target").unwrap();
		let mut legacy_link_hash_input = b"aghub-skill-symlink-v1\0".to_vec();
		legacy_link_hash_input.push(0);
		legacy_link_hash_input.extend_from_slice(b"target.txt");
		std::fs::write(base.join("entry"), legacy_link_hash_input).unwrap();
		std::os::unix::fs::symlink("target.txt", target.join("entry")).unwrap();

		let diff = compare_directories(&base, &target).unwrap();

		assert!(!diff.identical);
		assert_eq!(
			diff.files
				.iter()
				.find(|file| file.path == "entry")
				.unwrap()
				.kind,
			FileDiffKind::Modified
		);
	}

	#[cfg(unix)]
	#[test]
	fn snapshot_hash_includes_executable_flag() {
		use std::os::unix::fs::PermissionsExt;

		let temp = tempdir().unwrap();
		let base = temp.path().join("base");
		let target = temp.path().join("target");
		std::fs::create_dir_all(&base).unwrap();
		std::fs::create_dir_all(&target).unwrap();
		let base_file = base.join("run.sh");
		let target_file = target.join("run.sh");
		std::fs::write(&base_file, "#!/bin/sh\n").unwrap();
		std::fs::write(&target_file, "#!/bin/sh\n").unwrap();
		std::fs::set_permissions(
			&base_file,
			std::fs::Permissions::from_mode(0o644),
		)
		.unwrap();
		std::fs::set_permissions(
			&target_file,
			std::fs::Permissions::from_mode(0o755),
		)
		.unwrap();

		let diff = compare_directories(&base, &target).unwrap();

		assert!(!diff.identical);
		assert_eq!(diff.files.len(), 1);
		assert_eq!(diff.files[0].kind, FileDiffKind::Modified);
	}

	#[cfg(unix)]
	#[test]
	fn snapshot_hash_uses_raw_symlink_target_bytes() {
		use std::ffi::OsString;
		use std::os::unix::ffi::OsStringExt;

		let temp = tempdir().unwrap();
		let base = temp.path().join("base");
		let target = temp.path().join("target");
		std::fs::create_dir_all(&base).unwrap();
		std::fs::create_dir_all(&target).unwrap();
		std::os::unix::fs::symlink(
			OsString::from_vec(vec![0xff]),
			base.join("linked"),
		)
		.unwrap();
		std::os::unix::fs::symlink(
			OsString::from_vec(vec![0xfe]),
			target.join("linked"),
		)
		.unwrap();

		let diff = compare_directories(&base, &target).unwrap();

		assert!(!diff.identical);
		assert_ne!(
			diff.files[0].before_link.as_ref().unwrap().target,
			diff.files[0].after_link.as_ref().unwrap().target
		);
	}

	#[cfg(unix)]
	#[test]
	fn snapshot_link_uses_the_inspected_target() {
		let temp = tempdir().unwrap();
		let root = temp.path().join("skill");
		let link_path = root.join("linked.txt");
		std::fs::create_dir_all(&root).unwrap();
		std::fs::write(root.join("first.txt"), "first").unwrap();
		std::fs::write(root.join("second.txt"), "second").unwrap();
		std::os::unix::fs::symlink("first.txt", &link_path).unwrap();
		let inspected = inspect_skill_link(&root, &link_path).unwrap();

		std::fs::remove_file(&link_path).unwrap();
		std::os::unix::fs::symlink("second.txt", &link_path).unwrap();
		let mut observed_bytes = 0;
		let mut observed_budget = MAX_SNAPSHOT_BYTES;
		let observed =
			snapshot_link(inspected, &mut observed_bytes, &mut observed_budget)
				.unwrap();

		std::fs::remove_file(&link_path).unwrap();
		std::os::unix::fs::symlink("first.txt", &link_path).unwrap();
		let expected_link = inspect_skill_link(&root, &link_path).unwrap();
		let mut expected_bytes = 0;
		let mut expected_budget = MAX_SNAPSHOT_BYTES;
		let expected = snapshot_link(
			expected_link,
			&mut expected_bytes,
			&mut expected_budget,
		)
		.unwrap();

		assert_eq!(observed.hash, expected.hash);
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
		assert_eq!(
			link_diff.before_link.as_ref().unwrap().target,
			std::path::PathBuf::from("first.txt")
		);
		assert_eq!(
			link_diff.after_link.as_ref().unwrap().target,
			std::path::PathBuf::from("second.txt")
		);
		assert!(!link_diff.content_omitted);
	}
}
