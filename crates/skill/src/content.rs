//! Bounded, in-memory reads of complete skill content.

use crate::error::{Result, SkillError};
use crate::package::open_skill_archive;
use crate::{
	is_repository_metadata_dir, MAX_SKILL_CONTENT_BYTES,
	MAX_SKILL_CONTENT_DEPTH, MAX_SKILL_CONTENT_FILES, RESOURCE_DIR_NAMES,
};
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

#[cfg(unix)]
mod unix;

#[cfg(unix)]
pub use unix::{
	open_skill_content_directory, read_skill_content_directory,
	OpenSkillContentDirectoryEntry, SkillContentDirectoryEntries,
};

/// One file bundled with a skill.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillContentFile {
	/// Path relative to the skill root.
	pub path: String,
	/// Exact file bytes.
	pub content: Vec<u8>,
}

/// Raw instruction and resource bytes read from one skill source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillContentSnapshot {
	/// Raw UTF-8 SKILL.md content, including frontmatter.
	pub skill_md: String,
	/// Every resource included by the source format.
	pub resources: Vec<SkillContentFile>,
}

/// Read a directory, standalone document, or packaged skill into memory.
pub fn read_skill_content(path: &Path) -> Result<SkillContentSnapshot> {
	let metadata = source_metadata(path)?;
	if metadata.file_type().is_symlink() {
		return Err(rejected_path(path, "symbolic link"));
	}
	if metadata.is_dir() {
		return read_skill_directory_content(path);
	}
	if !metadata.is_file() {
		return Err(rejected_path(path, "special file"));
	}

	let extension = path
		.extension()
		.and_then(|extension| extension.to_str())
		.unwrap_or_default()
		.to_ascii_lowercase();
	if extension == "skill" || extension == "zip" {
		return read_packaged_content(path);
	}
	if path
		.file_name()
		.is_some_and(|name| name.eq_ignore_ascii_case("skill.md"))
	{
		let parent = path
			.parent()
			.filter(|parent| !parent.as_os_str().is_empty())
			.unwrap_or_else(|| Path::new("."));
		return read_skill_directory_content(parent);
	}

	read_standalone_content(path)
}

/// Read one regular UTF-8 skill document without following a final symlink.
pub fn read_skill_document(path: &Path) -> Result<String> {
	let metadata = source_metadata(path)?;
	if metadata.file_type().is_symlink() {
		return Err(rejected_path(path, "symbolic link"));
	}
	if !metadata.is_file() {
		return Err(rejected_path(path, "non-regular file"));
	}
	read_standalone_skill_md(path)
}

/// Atomically replace a regular skill document in its current directory.
pub fn write_skill_document_atomic(path: &Path, content: &str) -> Result<()> {
	let parent = path.parent().ok_or_else(|| {
		SkillError::InvalidFormat(format!(
			"Skill document has no parent: {}",
			path.display()
		))
	})?;
	let permissions = match std::fs::symlink_metadata(path) {
		Ok(metadata) if metadata.file_type().is_file() => {
			Some(metadata.permissions())
		}
		Ok(_) => return Err(rejected_path(path, "non-regular file")),
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
		Err(error) => return Err(error.into()),
	};
	let mut temporary = tempfile::Builder::new()
		.prefix(".aghub-skill-")
		.tempfile_in(parent)?;
	if let Some(permissions) = permissions {
		std::fs::set_permissions(temporary.path(), permissions)?;
	}
	temporary.write_all(content.as_bytes())?;
	temporary.as_file().sync_all()?;
	temporary.persist(path).map_err(|error| error.error)?;
	#[cfg(unix)]
	std::fs::File::open(parent)?.sync_all()?;
	Ok(())
}

/// Read a skill directory and every regular file below its root.
pub fn read_skill_directory_content(
	dir: &Path,
) -> Result<SkillContentSnapshot> {
	let metadata = source_metadata(dir)?;
	if metadata.file_type().is_symlink() {
		return Err(rejected_path(dir, "symbolic link"));
	}
	if !metadata.is_dir() {
		return Err(rejected_path(dir, "non-directory"));
	}

	let (skill_md, skill_md_path) = read_directory_skill_md(dir)?;
	let mut budget = ContentBudget::new(skill_md.len())?;
	let mut resources = Vec::new();
	collect_directory(
		dir,
		dir,
		&skill_md_path,
		0,
		&mut budget,
		&mut resources,
	)?;
	resources.sort_by(|left, right| left.path.cmp(&right.path));

	Ok(SkillContentSnapshot {
		skill_md,
		resources,
	})
}

fn read_packaged_content(path: &Path) -> Result<SkillContentSnapshot> {
	let mut package = open_skill_archive(path)?;
	let skill_md = package.read_skill_md()?;
	let mut budget = ContentBudget::new(skill_md.len())?;
	let mut resources = Vec::new();

	for (index, relative_path) in package.skill_files() {
		budget.record_entry()?;
		let content = package.read_entry(index, budget.remaining_bytes())?;
		budget.record_bytes(content.len())?;
		resources.push(SkillContentFile {
			path: relative_path,
			content,
		});
	}
	resources.sort_by(|left, right| left.path.cmp(&right.path));

	Ok(SkillContentSnapshot {
		skill_md,
		resources,
	})
}

fn read_standalone_content(path: &Path) -> Result<SkillContentSnapshot> {
	let skill_md = read_standalone_skill_md(path)?;
	let mut budget = ContentBudget::new(skill_md.len())?;
	let mut resources = Vec::new();

	if let Some(root) = path.parent() {
		for dir_name in RESOURCE_DIR_NAMES {
			let resource_dir = root.join(dir_name);
			match std::fs::symlink_metadata(&resource_dir) {
				Ok(metadata) if metadata.file_type().is_symlink() => {
					return Err(rejected_path(&resource_dir, "symbolic link"));
				}
				Ok(metadata) if metadata.is_dir() => {
					budget.record_entry()?;
					collect_directory(
						root,
						&resource_dir,
						path,
						1,
						&mut budget,
						&mut resources,
					)?;
				}
				Ok(_) => {}
				Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
				Err(error) => return Err(error.into()),
			}
		}
	}
	resources.sort_by(|left, right| left.path.cmp(&right.path));

	Ok(SkillContentSnapshot {
		skill_md,
		resources,
	})
}

pub(crate) fn read_directory_skill_md(dir: &Path) -> Result<(String, PathBuf)> {
	for name in ["SKILL.md", "skill.md"] {
		let path = dir.join(name);
		match std::fs::symlink_metadata(&path) {
			Ok(metadata) => {
				if metadata.file_type().is_symlink() {
					return Err(rejected_path(&path, "symbolic link"));
				}
				if !metadata.is_file() {
					return Err(rejected_path(&path, "non-regular file"));
				}
				let bytes = read_regular_file(&path, MAX_SKILL_CONTENT_BYTES)?;
				let skill_md = String::from_utf8(bytes).map_err(|error| {
					SkillError::InvalidFormat(format!(
						"{} is not valid UTF-8: {error}",
						path.display()
					))
				})?;
				return Ok((skill_md, path));
			}
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
			Err(error) => return Err(error.into()),
		}
	}

	Err(SkillError::MissingSkillMd {
		path: dir.to_path_buf(),
	})
}

pub(crate) fn read_standalone_skill_md(path: &Path) -> Result<String> {
	let bytes = read_regular_file(path, MAX_SKILL_CONTENT_BYTES)?;
	String::from_utf8(bytes).map_err(|error| {
		SkillError::InvalidFormat(format!(
			"{} is not valid UTF-8: {error}",
			path.display()
		))
	})
}

fn collect_directory(
	root: &Path,
	dir: &Path,
	skill_md_path: &Path,
	depth: usize,
	budget: &mut ContentBudget,
	resources: &mut Vec<SkillContentFile>,
) -> Result<()> {
	if depth > MAX_SKILL_CONTENT_DEPTH {
		return Err(limit_error(format!(
			"Skill exceeds the {MAX_SKILL_CONTENT_DEPTH}-level content limit"
		)));
	}

	let mut entries = Vec::new();
	for entry in std::fs::read_dir(dir)? {
		let entry = entry?;
		if is_repository_metadata_dir(&entry.file_name()) {
			continue;
		}
		if entry.path() == skill_md_path {
			continue;
		}
		let name = entry.file_name().into_string().map_err(|_| {
			std::io::Error::new(
				std::io::ErrorKind::InvalidData,
				format!("{} contains a non-UTF-8 path", dir.display()),
			)
		})?;
		budget.record_entry()?;
		entries.push((name, entry));
	}
	entries.sort_by(|left, right| left.0.cmp(&right.0));

	for (_, entry) in entries {
		let path = entry.path();
		let file_type = entry.file_type()?;
		if file_type.is_symlink() {
			return Err(rejected_path(&path, "symbolic link"));
		}
		if file_type.is_dir() {
			collect_directory(
				root,
				&path,
				skill_md_path,
				depth + 1,
				budget,
				resources,
			)?;
			continue;
		}
		if !file_type.is_file() {
			return Err(rejected_path(&path, "special file"));
		}
		let content = read_regular_file(&path, budget.remaining_bytes())?;
		budget.record_bytes(content.len())?;
		resources.push(SkillContentFile {
			path: relative_path(root, &path)?,
			content,
		});
	}

	Ok(())
}

struct ContentBudget {
	entries: usize,
	bytes: usize,
}

impl ContentBudget {
	fn new(skill_md_bytes: usize) -> Result<Self> {
		if skill_md_bytes > MAX_SKILL_CONTENT_BYTES {
			return Err(byte_limit_error(Path::new("SKILL.md")));
		}
		Ok(Self {
			entries: 1,
			bytes: skill_md_bytes,
		})
	}

	fn record_entry(&mut self) -> Result<()> {
		if self.entries >= MAX_SKILL_CONTENT_FILES {
			return Err(limit_error(format!(
				"Skill exceeds the {MAX_SKILL_CONTENT_FILES}-entry content limit"
			)));
		}
		self.entries += 1;
		Ok(())
	}

	fn remaining_bytes(&self) -> usize {
		MAX_SKILL_CONTENT_BYTES.saturating_sub(self.bytes)
	}

	fn record_bytes(&mut self, bytes: usize) -> Result<()> {
		if bytes > self.remaining_bytes() {
			return Err(byte_limit_error(Path::new("skill content")));
		}
		self.bytes += bytes;
		Ok(())
	}
}

fn read_regular_file(path: &Path, max_bytes: usize) -> Result<Vec<u8>> {
	let (file, metadata) = open_skill_content_file(path)?;
	if metadata.len() > max_bytes as u64 {
		return Err(byte_limit_error(path));
	}

	let mut content = Vec::with_capacity(metadata.len() as usize);
	file.take(max_bytes as u64 + 1).read_to_end(&mut content)?;
	if content.len() > max_bytes {
		return Err(byte_limit_error(path));
	}
	Ok(content)
}

/// Open a regular skill content file without following a final symlink.
pub fn open_skill_content_file(
	path: &Path,
) -> Result<(File, std::fs::Metadata)> {
	let mut options = OpenOptions::new();
	options.read(true);
	#[cfg(unix)]
	{
		use std::os::unix::fs::OpenOptionsExt;
		options.custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
	}
	#[cfg(windows)]
	{
		use std::os::windows::fs::OpenOptionsExt;
		const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
		options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
	}
	let file = options.open(path)?;
	let metadata = file.metadata()?;
	if metadata.file_type().is_symlink() {
		return Err(rejected_path(path, "symbolic link"));
	}
	if !metadata.is_file() {
		return Err(rejected_path(path, "non-regular file"));
	}
	Ok((file, metadata))
}

fn relative_path(root: &Path, path: &Path) -> Result<String> {
	let relative = path.strip_prefix(root)?;
	let mut parts = Vec::new();
	for component in relative.components() {
		match component {
			Component::Normal(part) => {
				parts.push(part.to_str().ok_or_else(|| {
					SkillError::InvalidFormat(format!(
						"{} is not a UTF-8 path",
						path.display()
					))
				})?);
			}
			_ => return Err(rejected_path(path, "invalid relative path")),
		}
	}
	Ok(parts.join("/"))
}

fn source_metadata(path: &Path) -> Result<std::fs::Metadata> {
	match std::fs::symlink_metadata(path) {
		Ok(metadata) => Ok(metadata),
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			Err(SkillError::NotFound(format!(
				"Skill source not found: {}",
				path.display()
			)))
		}
		Err(error) => Err(error.into()),
	}
}

fn byte_limit_error(path: &Path) -> SkillError {
	limit_error(format!(
		"{} exceeds the {MAX_SKILL_CONTENT_BYTES}-byte content limit",
		path.display()
	))
}

fn limit_error(message: String) -> SkillError {
	SkillError::InvalidFormat(message)
}

fn rejected_path(path: &Path, kind: &str) -> SkillError {
	SkillError::InvalidFormat(format!(
		"Skill content rejected {kind}: {}",
		path.display()
	))
}

#[cfg(test)]
mod tests {
	use super::*;
	use tempfile::tempdir;

	const TEST_SKILL_MD: &str =
		"---\nname: test-skill\ndescription: test skill\n---\n";

	fn write_skill(dir: &Path) {
		std::fs::create_dir_all(dir).unwrap();
		std::fs::write(dir.join("SKILL.md"), TEST_SKILL_MD).unwrap();
	}

	#[test]
	fn directory_content_is_sorted_and_recursive() {
		let temp = tempdir().unwrap();
		write_skill(temp.path());
		std::fs::create_dir(temp.path().join("scripts")).unwrap();
		std::fs::write(temp.path().join("z.txt"), "z").unwrap();
		std::fs::write(temp.path().join("a.txt"), "a").unwrap();
		std::fs::write(temp.path().join("scripts/run.sh"), "run").unwrap();

		let content = read_skill_directory_content(temp.path()).unwrap();
		let paths = content
			.resources
			.iter()
			.map(|file| file.path.as_str())
			.collect::<Vec<_>>();

		assert_eq!(paths, ["a.txt", "scripts/run.sh", "z.txt"]);
	}

	#[test]
	fn standalone_content_reads_only_resource_directories() {
		let temp = tempdir().unwrap();
		let skill_md = temp.path().join("instructions.md");
		std::fs::write(&skill_md, TEST_SKILL_MD).unwrap();
		std::fs::create_dir(temp.path().join("scripts")).unwrap();
		std::fs::write(temp.path().join("scripts/run.sh"), "run").unwrap();
		std::fs::write(temp.path().join("unrelated.txt"), "skip").unwrap();

		let content = read_skill_content(&skill_md).unwrap();

		assert_eq!(content.resources.len(), 1);
		assert_eq!(content.resources[0].path, "scripts/run.sh");
	}

	#[test]
	fn skill_md_path_reads_the_complete_skill_directory() {
		let temp = tempdir().unwrap();
		write_skill(temp.path());
		std::fs::write(temp.path().join("payload.bin"), "payload").unwrap();

		let content =
			read_skill_content(&temp.path().join("SKILL.md")).unwrap();

		assert_eq!(content.resources.len(), 1);
		assert_eq!(content.resources[0].path, "payload.bin");
	}

	#[test]
	fn standalone_content_counts_resource_directories_toward_entry_limit() {
		let temp = tempdir().unwrap();
		let skill_md = temp.path().join("instructions.md");
		std::fs::write(&skill_md, TEST_SKILL_MD).unwrap();
		for dir_name in RESOURCE_DIR_NAMES {
			std::fs::create_dir(temp.path().join(dir_name)).unwrap();
		}
		for index in 0..509 {
			std::fs::write(
				temp.path().join("scripts").join(format!("{index}.txt")),
				"",
			)
			.unwrap();
		}

		assert!(read_skill_content(&skill_md).is_err());
	}

	#[test]
	fn directory_content_skips_repository_metadata() {
		let temp = tempdir().unwrap();
		write_skill(temp.path());
		std::fs::create_dir_all(temp.path().join(".GIT/objects")).unwrap();
		std::fs::create_dir_all(temp.path().join("nested/.Hg/store")).unwrap();
		std::fs::write(temp.path().join(".GIT/config"), "private").unwrap();
		std::fs::write(temp.path().join("nested/.Hg/store/data"), "private")
			.unwrap();
		std::fs::write(temp.path().join(".svn"), "worktree metadata").unwrap();
		std::fs::write(temp.path().join("visible.txt"), "visible").unwrap();

		let content = read_skill_directory_content(temp.path()).unwrap();
		let paths = content
			.resources
			.iter()
			.map(|file| file.path.as_str())
			.collect::<Vec<_>>();

		assert_eq!(paths, ["visible.txt"]);
	}

	#[test]
	fn directory_content_rejects_non_utf8_skill_md() {
		let temp = tempdir().unwrap();
		std::fs::write(temp.path().join("SKILL.md"), [0xff]).unwrap();

		assert!(matches!(
			read_skill_directory_content(temp.path()),
			Err(SkillError::InvalidFormat(_))
		));
	}

	#[test]
	fn directory_content_rejects_excessive_depth() {
		let temp = tempdir().unwrap();
		write_skill(temp.path());
		let mut nested = temp.path().to_path_buf();
		for _ in 0..=MAX_SKILL_CONTENT_DEPTH {
			nested.push("nested");
			std::fs::create_dir(&nested).unwrap();
		}

		assert!(read_skill_directory_content(temp.path()).is_err());
	}

	#[test]
	fn directory_content_accepts_entry_limit_boundary() {
		let temp = tempdir().unwrap();
		write_skill(temp.path());
		for index in 0..MAX_SKILL_CONTENT_FILES - 1 {
			std::fs::write(temp.path().join(format!("{index}.txt")), "")
				.unwrap();
		}

		let content = read_skill_directory_content(temp.path()).unwrap();

		assert_eq!(content.resources.len(), MAX_SKILL_CONTENT_FILES - 1);
	}

	#[test]
	fn directory_content_rejects_excessive_file_count() {
		let temp = tempdir().unwrap();
		write_skill(temp.path());
		for index in 0..MAX_SKILL_CONTENT_FILES {
			std::fs::write(temp.path().join(format!("{index}.txt")), "")
				.unwrap();
		}

		assert!(read_skill_directory_content(temp.path()).is_err());
	}

	#[test]
	fn directory_content_rejects_excessive_empty_directories() {
		let temp = tempdir().unwrap();
		write_skill(temp.path());
		for index in 0..MAX_SKILL_CONTENT_FILES {
			std::fs::create_dir(temp.path().join(format!("dir-{index}")))
				.unwrap();
		}

		assert!(read_skill_directory_content(temp.path()).is_err());
	}

	#[test]
	fn directory_content_rejects_excessive_bytes() {
		let temp = tempdir().unwrap();
		write_skill(temp.path());
		let payload = File::create(temp.path().join("payload.bin")).unwrap();
		payload.set_len(MAX_SKILL_CONTENT_BYTES as u64 + 1).unwrap();

		assert!(read_skill_directory_content(temp.path()).is_err());
	}

	#[cfg(unix)]
	#[test]
	fn directory_content_rejects_symbolic_links() {
		use std::os::unix::fs::symlink;

		let temp = tempdir().unwrap();
		let outside = tempdir().unwrap();
		write_skill(temp.path());
		std::fs::write(outside.path().join("outside.txt"), "outside").unwrap();
		symlink(
			outside.path().join("outside.txt"),
			temp.path().join("linked.txt"),
		)
		.unwrap();

		assert!(matches!(
			read_skill_directory_content(temp.path()),
			Err(SkillError::InvalidFormat(_))
		));
	}

	#[cfg(unix)]
	#[test]
	fn directory_content_rejects_special_files() {
		use std::os::unix::net::UnixListener;

		let temp = tempdir().unwrap();
		write_skill(temp.path());
		let _listener = match UnixListener::bind(temp.path().join("skill.sock"))
		{
			Ok(listener) => listener,
			Err(error)
				if error.kind() == std::io::ErrorKind::PermissionDenied =>
			{
				return
			}
			Err(error) => panic!("failed to create test socket: {error}"),
		};

		assert!(matches!(
			read_skill_directory_content(temp.path()),
			Err(SkillError::InvalidFormat(_))
		));
	}
}
