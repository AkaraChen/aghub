use super::ConfigManager;
use crate::{
	convert_skill,
	errors::{ConfigError, Result},
	models::Skill,
};
use log::{debug, info, warn};
use skill::{sanitize::sanitize_name, SkillSource};
use std::{
	collections::{hash_map::DefaultHasher, BTreeMap},
	convert::Infallible,
	fs::File,
	hash::{Hash, Hasher},
	io::Read,
	path::{Path, PathBuf},
};

const MAX_STAGING_SAFE_NAME_BYTES: usize = 80;

/// Private copy of an import source captured before review and installation.
pub struct SkillImportSnapshot {
	path: PathBuf,
	original_root: Option<PathBuf>,
	entry_count: usize,
	byte_count: usize,
	_temp_dir: tempfile::TempDir,
}

#[derive(Debug)]
pub enum SkillImportCommitError<E> {
	Import(ConfigError),
	Commit(E),
	Rollback {
		commit: E,
		rollback: ConfigError,
		skill_name: String,
	},
}

impl SkillImportSnapshot {
	pub fn capture(path: &Path) -> Result<Self> {
		Self::capture_with_directory_read(path, &mut |_| {})
	}

	fn capture_with_directory_read<F>(
		path: &Path,
		before_directory_read: &mut F,
	) -> Result<Self>
	where
		F: FnMut(&Path),
	{
		let metadata = std::fs::symlink_metadata(path)?;
		if metadata.file_type().is_symlink() {
			return Err(symlink_import_error(path));
		}

		let temp_dir = tempfile::TempDir::new().map_err(ConfigError::Io)?;
		let mut budget = SnapshotBudget::default();
		let (snapshot_path, original_root) = if metadata.is_dir() {
			let snapshot_path = temp_dir.path().join("source");
			copy_snapshot_dir_with_directory_read(
				path,
				&snapshot_path,
				0,
				&mut budget,
				before_directory_read,
			)?;
			(
				snapshot_path,
				Some(std::fs::canonicalize(path).map_err(ConfigError::Io)?),
			)
		} else if metadata.is_file() {
			capture_snapshot_file(path, temp_dir.path(), &mut budget)?
		} else {
			return Err(unsupported_import_entry_error(path));
		};

		Ok(Self {
			path: snapshot_path,
			original_root,
			entry_count: budget.entries,
			byte_count: budget.bytes,
			_temp_dir: temp_dir,
		})
	}

	pub fn path(&self) -> &Path {
		&self.path
	}

	pub fn entry_count(&self) -> usize {
		self.entry_count
	}

	pub fn byte_count(&self) -> usize {
		self.byte_count
	}

	fn original_root(&self) -> Option<&Path> {
		self.original_root.as_deref()
	}
}

#[derive(Default)]
struct SnapshotBudget {
	entries: usize,
	bytes: usize,
}

impl SnapshotBudget {
	fn record_entry(&mut self) -> Result<()> {
		if self.entries >= skill::MAX_SKILL_CONTENT_FILES {
			return Err(snapshot_limit_error(format!(
				"Skill snapshot exceeds the {}-entry limit",
				skill::MAX_SKILL_CONTENT_FILES
			)));
		}
		self.entries += 1;
		Ok(())
	}

	fn remaining_bytes(&self) -> usize {
		skill::MAX_SKILL_CONTENT_BYTES.saturating_sub(self.bytes)
	}

	fn ensure_bytes(&self, bytes: u64) -> Result<()> {
		if bytes > self.remaining_bytes() as u64 {
			return Err(snapshot_limit_error(format!(
				"Skill snapshot exceeds the {}-byte limit",
				skill::MAX_SKILL_CONTENT_BYTES
			)));
		}
		Ok(())
	}

	fn record_bytes(&mut self, bytes: u64) -> Result<()> {
		self.ensure_bytes(bytes)?;
		self.bytes += bytes as usize;
		Ok(())
	}
}

enum SkillImportSource {
	Directory(PathBuf),
	SkillMd(PathBuf),
	Package {
		root: PathBuf,
		_temp_dir: tempfile::TempDir,
	},
}

impl SkillImportSource {
	fn root_path(&self) -> Option<&Path> {
		match self {
			SkillImportSource::Directory(root)
			| SkillImportSource::Package { root, .. } => Some(root),
			SkillImportSource::SkillMd(path) => path.parent(),
		}
	}
}

/// Resolve a source_path string (potentially with `~/` prefix) to an absolute PathBuf
fn resolve_source_path(sp: &str) -> PathBuf {
	if let Some(stripped) = sp.strip_prefix("~/") {
		if let Some(home) = dirs::home_dir() {
			home.join(stripped)
		} else {
			PathBuf::from(sp)
		}
	} else {
		PathBuf::from(sp)
	}
}

/// Remove a skill's file or directory from disk.
///
/// Handles three cases:
/// 1. Symlink — only unlink the symlink directory, leave the target intact
/// 2. Named directory (e.g. `skills/my-skill/SKILL.md`) — remove entire dir
/// 3. Standalone file — remove just the file
fn remove_skill_path(
	path: &Path,
	safe_name: &str,
	is_symlink: bool,
) -> Result<()> {
	if is_symlink {
		let Some(parent) = path.parent() else {
			return Ok(());
		};
		let is_link = parent
			.symlink_metadata()
			.map(|m| m.file_type().is_symlink())
			.unwrap_or(false);
		if is_link {
			std::fs::remove_file(parent).map_err(|e| {
				ConfigError::Io(std::io::Error::new(
					e.kind(),
					format!(
						"Failed to remove symlink '{}': {}",
						parent.display(),
						e
					),
				))
			})?;
		}
		return Ok(());
	}

	let Some(parent) = path.parent() else {
		return std::fs::remove_file(path).map_err(|e| e.into());
	};

	let is_named_dir =
		parent.file_name().and_then(|n| n.to_str()) == Some(safe_name);
	if is_named_dir {
		std::fs::remove_dir_all(parent).map_err(|e| {
			ConfigError::Io(std::io::Error::new(
				e.kind(),
				format!(
					"Failed to remove directory '{}': {}",
					parent.display(),
					e
				),
			))
		})?;
	} else {
		std::fs::remove_file(path).map_err(|e| {
			ConfigError::Io(std::io::Error::new(
				e.kind(),
				format!("Failed to remove file '{}': {}", path.display(), e),
			))
		})?;
	}
	Ok(())
}

fn symlink_import_error(path: &Path) -> ConfigError {
	ConfigError::InvalidConfig(format!(
		"Refusing to copy symlink '{}'",
		path.display()
	))
}

fn unsupported_import_entry_error(path: &Path) -> ConfigError {
	ConfigError::InvalidConfig(format!(
		"Refusing to copy unsupported import entry '{}'",
		path.display()
	))
}

fn snapshot_limit_error(message: impl Into<String>) -> ConfigError {
	ConfigError::InvalidConfig(message.into())
}

fn copy_snapshot_file(
	from: &Path,
	to: &Path,
	budget: &mut SnapshotBudget,
) -> Result<()> {
	let (source, metadata) = skill::open_skill_content_file(from)
		.map_err(|error| ConfigError::InvalidConfig(error.to_string()))?;
	copy_open_snapshot_file(source, metadata, to, budget)
}

fn copy_open_snapshot_file(
	source: File,
	metadata: std::fs::Metadata,
	to: &Path,
	budget: &mut SnapshotBudget,
) -> Result<()> {
	budget.ensure_bytes(metadata.len())?;
	let remaining = budget.remaining_bytes();
	if let Some(parent) = to.parent() {
		std::fs::create_dir_all(parent)?;
	}

	let mut source = source.take(remaining as u64 + 1);
	let mut destination = File::create(to)?;
	let copied = std::io::copy(&mut source, &mut destination)?;
	budget.record_bytes(copied)?;
	#[cfg(unix)]
	std::fs::set_permissions(to, metadata.permissions())?;
	Ok(())
}

fn measure_snapshot_file(
	path: &Path,
	budget: &mut SnapshotBudget,
) -> Result<()> {
	let (_, metadata) = skill::open_skill_content_file(path)
		.map_err(|error| ConfigError::InvalidConfig(error.to_string()))?;
	budget.record_bytes(metadata.len())
}

fn measure_snapshot_dir(
	path: &Path,
	depth: usize,
	budget: &mut SnapshotBudget,
) -> Result<()> {
	if depth > skill::MAX_SKILL_CONTENT_DEPTH {
		return Err(snapshot_limit_error(format!(
			"Skill snapshot exceeds the {}-level limit",
			skill::MAX_SKILL_CONTENT_DEPTH
		)));
	}

	let metadata = std::fs::symlink_metadata(path)?;
	if metadata.file_type().is_symlink() {
		return Err(symlink_import_error(path));
	}
	if !metadata.is_dir() {
		return Err(unsupported_import_entry_error(path));
	}

	let mut entries = Vec::new();
	for entry in std::fs::read_dir(path)? {
		let entry = entry?;
		if skill::is_repository_metadata_dir(&entry.file_name()) {
			continue;
		}
		budget.record_entry()?;
		entries.push(entry);
	}
	entries.sort_by_key(std::fs::DirEntry::file_name);
	for entry in entries {
		let path = entry.path();
		let file_type = entry.file_type()?;
		if file_type.is_symlink() {
			return Err(symlink_import_error(&path));
		}
		if file_type.is_dir() {
			measure_snapshot_dir(&path, depth + 1, budget)?;
		} else if file_type.is_file() {
			measure_snapshot_file(&path, budget)?;
		} else {
			return Err(unsupported_import_entry_error(&path));
		}
	}
	Ok(())
}

fn copy_snapshot_dir(
	from: &Path,
	to: &Path,
	depth: usize,
	budget: &mut SnapshotBudget,
) -> Result<()> {
	copy_snapshot_dir_with_directory_read(from, to, depth, budget, &mut |_| {})
}

#[cfg(unix)]
fn copy_snapshot_dir_with_directory_read<F>(
	from: &Path,
	to: &Path,
	depth: usize,
	budget: &mut SnapshotBudget,
	before_directory_read: &mut F,
) -> Result<()>
where
	F: FnMut(&Path),
{
	let directory = skill::open_skill_content_directory(from)
		.map_err(|error| ConfigError::InvalidConfig(error.to_string()))?;
	copy_open_snapshot_dir(
		directory,
		from,
		to,
		depth,
		budget,
		before_directory_read,
	)
}

#[cfg(unix)]
fn copy_open_snapshot_dir<F>(
	directory: File,
	from: &Path,
	to: &Path,
	depth: usize,
	budget: &mut SnapshotBudget,
	before_directory_read: &mut F,
) -> Result<()>
where
	F: FnMut(&Path),
{
	if depth > skill::MAX_SKILL_CONTENT_DEPTH {
		return Err(snapshot_limit_error(format!(
			"Skill snapshot exceeds the {}-level limit",
			skill::MAX_SKILL_CONTENT_DEPTH
		)));
	}

	std::fs::create_dir_all(to)?;
	before_directory_read(from);
	let entries = skill::read_skill_content_directory(&directory, from)
		.map_err(|error| ConfigError::InvalidConfig(error.to_string()))?;
	for entry in entries {
		let entry = entry
			.map_err(|error| ConfigError::InvalidConfig(error.to_string()))?;
		if skill::is_repository_metadata_dir(entry.file_name()) {
			continue;
		}
		budget.record_entry()?;
		let (name, file, metadata) = entry.into_parts();
		let from_path = from.join(&name);
		let to_path = to.join(&name);
		if metadata.is_dir() {
			copy_open_snapshot_dir(
				file,
				&from_path,
				&to_path,
				depth + 1,
				budget,
				before_directory_read,
			)?;
		} else if metadata.is_file() {
			copy_open_snapshot_file(file, metadata, &to_path, budget)?;
		} else {
			return Err(unsupported_import_entry_error(&from_path));
		}
	}
	Ok(())
}

#[cfg(not(unix))]
fn copy_snapshot_dir_with_directory_read<F>(
	from: &Path,
	to: &Path,
	depth: usize,
	budget: &mut SnapshotBudget,
	before_directory_read: &mut F,
) -> Result<()>
where
	F: FnMut(&Path),
{
	if depth > skill::MAX_SKILL_CONTENT_DEPTH {
		return Err(snapshot_limit_error(format!(
			"Skill snapshot exceeds the {}-level limit",
			skill::MAX_SKILL_CONTENT_DEPTH
		)));
	}

	let metadata = std::fs::symlink_metadata(from)?;
	if metadata.file_type().is_symlink() {
		return Err(symlink_import_error(from));
	}
	if !metadata.is_dir() {
		return Err(unsupported_import_entry_error(from));
	}

	std::fs::create_dir_all(to)?;
	before_directory_read(from);
	let mut entries = Vec::new();
	for entry in std::fs::read_dir(from)? {
		let entry = entry?;
		if skill::is_repository_metadata_dir(&entry.file_name()) {
			continue;
		}
		budget.record_entry()?;
		entries.push(entry);
	}
	entries.sort_by_key(std::fs::DirEntry::file_name);
	for entry in entries {
		let from_path = entry.path();
		let to_path = to.join(entry.file_name());
		let file_type = entry.file_type()?;
		if file_type.is_symlink() {
			return Err(symlink_import_error(&from_path));
		}
		if file_type.is_dir() {
			copy_snapshot_dir_with_directory_read(
				&from_path,
				&to_path,
				depth + 1,
				budget,
				before_directory_read,
			)?;
		} else if file_type.is_file() {
			copy_snapshot_file(&from_path, &to_path, budget)?;
		} else {
			return Err(unsupported_import_entry_error(&from_path));
		}
	}
	Ok(())
}

fn capture_snapshot_file(
	path: &Path,
	temp_root: &Path,
	budget: &mut SnapshotBudget,
) -> Result<(PathBuf, Option<PathBuf>)> {
	let extension = path
		.extension()
		.and_then(|extension| extension.to_str())
		.unwrap_or_default()
		.to_ascii_lowercase();
	if extension == "skill" || extension == "zip" {
		let root = skill::package::unpack_skill_root(path, temp_root).map_err(
			|error| {
				ConfigError::InvalidConfig(format!(
					"Failed to unpack skill package: {error}"
				))
			},
		)?;
		let parsed =
			skill::parser::parse_skill_dir(&root).map_err(|error| {
				ConfigError::InvalidConfig(format!(
					"Failed to parse skill snapshot: {error}"
				))
			})?;
		ensure_unique_package_skill_root(&root, &parsed.name)?;
		measure_snapshot_dir(&root, 0, budget)?;
		return Ok((root, None));
	}

	budget.record_entry()?;
	let snapshot_root = temp_root.join("source");
	let snapshot_path = snapshot_root.join("SKILL.md");
	copy_snapshot_file(path, &snapshot_path, budget)?;
	if let Some(parent) = path.parent() {
		for dir_name in skill::RESOURCE_DIR_NAMES {
			let resource_dir = parent.join(dir_name);
			match std::fs::symlink_metadata(&resource_dir) {
				Ok(metadata) if metadata.file_type().is_symlink() => {
					return Err(symlink_import_error(&resource_dir));
				}
				Ok(metadata) if metadata.is_dir() => {
					budget.record_entry()?;
					copy_snapshot_dir(
						&resource_dir,
						&snapshot_root.join(dir_name),
						1,
						budget,
					)?;
				}
				Ok(_) => {}
				Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
				Err(error) => return Err(ConfigError::Io(error)),
			}
		}
	}
	let original_root = path
		.parent()
		.map(std::fs::canonicalize)
		.transpose()
		.map_err(ConfigError::Io)?;
	Ok((snapshot_path, original_root))
}

fn same_existing_path(left: &Path, right: &Path) -> bool {
	if left == right {
		return true;
	}

	match (std::fs::canonicalize(left), std::fs::canonicalize(right)) {
		(Ok(left), Ok(right)) => left == right,
		_ => false,
	}
}

fn should_skip_import_path(path: &Path, skip_paths: &[PathBuf]) -> bool {
	skip_paths
		.iter()
		.any(|skip_path| same_existing_path(path, skip_path))
}

fn strict_relative_descendant(parent: &Path, child: &Path) -> Option<PathBuf> {
	let parent =
		std::fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
	let child =
		std::fs::canonicalize(child).unwrap_or_else(|_| child.to_path_buf());
	if child == parent {
		return None;
	}
	child.strip_prefix(parent).ok().map(Path::to_path_buf)
}

fn copy_dir_recursive(
	from: &Path,
	to: &Path,
	skip_paths: &[PathBuf],
) -> Result<()> {
	let metadata = std::fs::symlink_metadata(from)?;
	if metadata.file_type().is_symlink() {
		return Err(symlink_import_error(from));
	}
	if !metadata.is_dir() {
		return Err(unsupported_import_entry_error(from));
	}

	std::fs::create_dir_all(to)?;
	for entry in std::fs::read_dir(from)? {
		let entry = entry?;
		if skill::is_repository_metadata_dir(&entry.file_name()) {
			continue;
		}
		let from_path = entry.path();
		let to_path = to.join(entry.file_name());
		let file_type = entry.file_type()?;
		if file_type.is_symlink() {
			return Err(symlink_import_error(&from_path));
		}
		if should_skip_import_path(&from_path, skip_paths) {
			continue;
		}
		if file_type.is_dir() {
			copy_dir_recursive(&from_path, &to_path, skip_paths)?;
		} else if file_type.is_file() {
			std::fs::copy(&from_path, &to_path)?;
		} else {
			return Err(unsupported_import_entry_error(&from_path));
		}
	}
	Ok(())
}

fn cleanup_import_path(path: &Path) {
	let _ = remove_import_path(path);
}

fn remove_import_path(path: &Path) -> std::io::Result<()> {
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

fn copy_skill_md_with_resources(
	from: &Path,
	to: &Path,
	skip_paths: &[PathBuf],
) -> Result<()> {
	let metadata = std::fs::symlink_metadata(from)?;
	if metadata.file_type().is_symlink() {
		return Err(symlink_import_error(from));
	}
	if !metadata.is_file() {
		return Err(unsupported_import_entry_error(from));
	}

	std::fs::create_dir_all(to)?;
	std::fs::copy(from, to.join("SKILL.md"))?;
	if let Some(parent) = from.parent() {
		for dir_name in skill::RESOURCE_DIR_NAMES {
			let resource_dir = parent.join(dir_name);
			match std::fs::symlink_metadata(&resource_dir) {
				Ok(metadata) if metadata.file_type().is_symlink() => {
					return Err(symlink_import_error(&resource_dir));
				}
				Ok(metadata) if metadata.is_dir() => {
					copy_dir_recursive(
						&resource_dir,
						&to.join(dir_name),
						skip_paths,
					)?;
				}
				Ok(_) => {}
				Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
				Err(e) => return Err(ConfigError::Io(e)),
			}
		}
	}
	Ok(())
}

fn copy_import_source(
	source: &SkillImportSource,
	to: &Path,
	skip_paths: &[PathBuf],
) -> Result<()> {
	match source {
		SkillImportSource::Directory(root)
		| SkillImportSource::Package { root, .. } => {
			copy_dir_recursive(root, to, skip_paths)
		}
		SkillImportSource::SkillMd(path) => {
			copy_skill_md_with_resources(path, to, skip_paths)
		}
	}
}

fn staged_import_dir(parent: &Path, safe_name: &str) -> PathBuf {
	let now = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|duration| duration.as_nanos())
		.unwrap_or_default();
	let safe_name = staging_safe_name(safe_name);
	parent.join(format!(".aghub-import-{safe_name}-{now}"))
}

fn staging_safe_name(safe_name: &str) -> String {
	if safe_name.len() <= MAX_STAGING_SAFE_NAME_BYTES {
		return safe_name.to_string();
	}

	let mut hasher = DefaultHasher::new();
	safe_name.hash(&mut hasher);
	let digest = format!("{:016x}", hasher.finish());
	let mut prefix = String::new();
	for ch in safe_name.chars() {
		if prefix.len() + ch.len_utf8() > MAX_STAGING_SAFE_NAME_BYTES {
			break;
		}
		prefix.push(ch);
	}
	format!("{prefix}-{digest}")
}

fn copy_import_source_staged(
	source: &SkillImportSource,
	target_dir: &Path,
	original_root: Option<&Path>,
) -> Result<()> {
	let parent = target_dir.parent().ok_or_else(|| {
		ConfigError::InvalidConfig(format!(
			"Skill target '{}' has no parent",
			target_dir.display()
		))
	})?;
	std::fs::create_dir_all(parent)?;
	let safe_name = target_dir
		.file_name()
		.and_then(|name| name.to_str())
		.unwrap_or("skill");
	let staged = staged_import_dir(parent, safe_name);
	cleanup_import_path(&staged);

	let mut skip_paths = vec![staged.clone()];
	if let (Some(source_root), Some(original_root)) =
		(source.root_path(), original_root)
	{
		if let Some(relative) =
			strict_relative_descendant(original_root, parent)
		{
			skip_paths.push(source_root.join(relative));
		}
	}

	if let Err(e) = copy_import_source(source, &staged, &skip_paths) {
		cleanup_import_path(&staged);
		return Err(e);
	}

	if let Err(e) = std::fs::rename(&staged, target_dir) {
		cleanup_import_path(&staged);
		return Err(ConfigError::Io(e));
	}

	Ok(())
}

fn create_skill_document_staged(
	target_dir: &Path,
	content: &str,
) -> Result<()> {
	let parent = target_dir.parent().ok_or_else(|| {
		ConfigError::InvalidConfig(format!(
			"Skill target '{}' has no parent",
			target_dir.display()
		))
	})?;
	std::fs::create_dir_all(parent)?;
	let safe_name = target_dir
		.file_name()
		.and_then(|name| name.to_str())
		.unwrap_or("skill");
	let staged = staged_import_dir(parent, safe_name);
	cleanup_import_path(&staged);

	let result = (|| -> Result<()> {
		std::fs::create_dir(&staged)?;
		std::fs::write(staged.join("SKILL.md"), content)?;
		std::fs::rename(&staged, target_dir)?;
		Ok(())
	})();
	if result.is_err() {
		cleanup_import_path(&staged);
	}
	result
}

fn persisted_skill_matches(loaded: &Skill, current: &Skill) -> bool {
	loaded.name == current.name
		&& loaded.description == current.description
		&& loaded.author == current.author
		&& loaded.version == current.version
		&& loaded.content == current.content
		&& loaded.tools == current.tools
}

fn format_validated_skill(
	skill: &Skill,
	existing_body: Option<&str>,
) -> Result<String> {
	let content = format_skill(skill, existing_body);
	skill::parser::parse_skill_md(&content).map_err(|error| {
		ConfigError::InvalidConfig(format!("Invalid skill document: {error}"))
	})?;
	Ok(content)
}

fn import_source_from_parsed(
	path: &Path,
	source: &SkillSource,
	skill_name: &str,
) -> Result<SkillImportSource> {
	match source {
		SkillSource::Directory(root) => {
			Ok(SkillImportSource::Directory(root.clone()))
		}
		SkillSource::SkillMd(skill_md) => {
			Ok(SkillImportSource::SkillMd(skill_md.clone()))
		}
		SkillSource::SkillFile(_) | SkillSource::ZipFile(_) => {
			let temp_dir = tempfile::TempDir::new().map_err(ConfigError::Io)?;
			let root = skill::package::unpack_skill_root(path, temp_dir.path())
				.map_err(|e| {
					ConfigError::InvalidConfig(format!(
						"Failed to unpack skill package: {e}"
					))
				})?;
			ensure_unique_package_skill_root(&root, skill_name)?;
			Ok(SkillImportSource::Package {
				root,
				_temp_dir: temp_dir,
			})
		}
	}
}

fn ensure_unique_package_skill_root(
	root: &Path,
	skill_name: &str,
) -> Result<()> {
	let mut pending = vec![root.to_path_buf()];
	let mut matches = 0;
	while let Some(dir) = pending.pop() {
		if skill::parser::parse_skill_dir(&dir)
			.is_ok_and(|skill| skill.name == skill_name)
		{
			matches += 1;
			if matches > 1 {
				return Err(ConfigError::InvalidConfig(format!(
					"Unpacked skill package contains multiple roots named \
					 '{skill_name}'"
				)));
			}
		}

		for entry in std::fs::read_dir(&dir)? {
			let entry = entry?;
			if entry.file_type()?.is_dir() {
				pending.push(entry.path());
			}
		}
	}

	if matches == 1 {
		Ok(())
	} else {
		Err(ConfigError::InvalidConfig(format!(
			"Unpacked skill package did not contain skill '{skill_name}'"
		)))
	}
}

impl ConfigManager {
	pub fn add_skill(&mut self, skill: Skill) -> Result<()> {
		let target_dir = self.target_skills_dir().ok_or_else(|| {
			ConfigError::InvalidConfig(
				"Agent does not support persistent skill creation \
				 in the current scope"
					.into(),
			)
		})?;
		let agent_name = self.adapter.name().to_string();
		let safe_name = sanitize_name(&skill.name);
		let skill_dir = target_dir.join(&safe_name);
		let _transaction =
			skill::lock::lock_skill_paths([skill_dir.as_path()])?;
		let config = self.config_mut()?;
		if config.skills.iter().any(|s| s.name == skill.name) {
			return Err(ConfigError::resource_exists("skill", &skill.name));
		}
		match std::fs::symlink_metadata(&skill_dir) {
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
			Err(error) => return Err(ConfigError::Io(error)),
			Ok(_) => {
				return Err(ConfigError::resource_exists(
					"skill target",
					skill_dir.display().to_string(),
				));
			}
		}
		info!("adding skill '{}' for agent '{}'", skill.name, agent_name);

		let content = format_validated_skill(&skill, None)?;
		create_skill_document_staged(&skill_dir, &content)?;
		let mut fs_skill = skill.clone();
		fs_skill.source_path =
			Some(skill_dir.join("SKILL.md").to_string_lossy().to_string());
		fs_skill.canonical_path = None;
		config.skills.push(fs_skill);

		Ok(())
	}

	pub fn get_skill(&self, name: &str) -> Option<&Skill> {
		self.config.as_ref()?.skills.iter().find(|s| s.name == name)
	}

	pub fn update_skill(&mut self, name: &str, skill: Skill) -> Result<()> {
		let target_dir = self.target_skills_dir();
		let agent_name = self.adapter.name().to_string();
		let config = self.config.as_ref().ok_or_else(|| {
			ConfigError::InvalidConfig("No configuration loaded".to_string())
		})?;
		let index = config
			.skills
			.iter()
			.position(|s| s.name == name)
			.ok_or_else(|| ConfigError::resource_not_found("skill", name))?;
		let existing_skill = config.skills[index].clone();

		let safe_old_name = sanitize_name(name);
		// Prefer canonical path (real location) for writes
		let file_path = if let Some(cp) = &existing_skill.canonical_path {
			Some(resolve_source_path(cp))
		} else if let Some(sp) = &existing_skill.source_path {
			Some(resolve_source_path(sp))
		} else {
			target_dir.map(|dir| dir.join(&safe_old_name).join("SKILL.md"))
		};
		let path = file_path.as_ref().ok_or_else(|| {
			ConfigError::InvalidConfig(
				"Agent does not support persistent skill updates \
				 or source missing"
					.into(),
			)
		})?;
		let current_transaction_path =
			skill::lock::skill_transaction_path(path);
		let rename_transaction_path = if name != skill.name {
			let safe_new_name = sanitize_name(&skill.name);
			path.parent().and_then(|parent| {
				if parent.file_name().and_then(|value| value.to_str())
					== Some(&safe_old_name)
				{
					Some(parent.with_file_name(&safe_new_name))
				} else if path.file_name().and_then(|value| value.to_str())
					== Some(&format!("{safe_old_name}.md"))
				{
					Some(path.with_file_name(format!("{safe_new_name}.md")))
				} else {
					None
				}
			})
		} else {
			None
		};
		let mut transaction_paths = vec![current_transaction_path.clone()];
		transaction_paths.extend(rename_transaction_path.iter().cloned());
		let _transaction = skill::lock::lock_skill_paths(
			transaction_paths.iter().map(PathBuf::as_path),
		)?;
		let config = self.config_mut()?;
		if name != skill.name
			&& config.skills.iter().enumerate().any(|(other, existing)| {
				other != index && existing.name == skill.name
			}) {
			return Err(ConfigError::resource_exists("skill", &skill.name));
		}
		if let Some(target) = rename_transaction_path
			.as_ref()
			.filter(|target| *target != &current_transaction_path)
		{
			match std::fs::symlink_metadata(target) {
				Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
				Err(error) => return Err(ConfigError::Io(error)),
				Ok(_) => {
					return Err(ConfigError::resource_exists(
						"skill target",
						target.display().to_string(),
					));
				}
			}
		}
		info!(
			"updating skill '{}' -> '{}' for agent '{}'",
			name, skill.name, agent_name
		);

		if let Some(path) = file_path {
			// Read existing body before any filesystem changes
			let existing_document = match skill::read_skill_document(&path) {
				Ok(content) => content,
				Err(skill::SkillError::NotFound(_)) => {
					return Err(ConfigError::resource_not_found("skill", name));
				}
				Err(error) => {
					return Err(ConfigError::InvalidConfig(format!(
						"Failed to read existing skill '{}': {error}",
						path.display()
					)));
				}
			};
			let existing =
				skill::parse_skill_md(&existing_document).map_err(|error| {
					ConfigError::InvalidConfig(format!(
						"Failed to parse existing skill '{}': {error}",
						path.display()
					))
				})?;
			if existing.name != name {
				return Err(ConfigError::resource_not_found("skill", name));
			}
			let current_skill = convert_skill(existing.clone());
			if !persisted_skill_matches(&existing_skill, &current_skill) {
				return Err(ConfigError::resource_changed("skill", name));
			}
			let allowed_tools =
				(!skill.tools.is_empty()).then(|| skill.tools.join(","));
			let content = skill::update_skill_md(
				&existing_document,
				&skill.name,
				skill.description.as_deref().unwrap_or(""),
				skill.author.as_deref(),
				skill.version.as_deref(),
				allowed_tools.as_deref(),
				skill.content.as_deref(),
			)
			.map_err(|error| {
				ConfigError::InvalidConfig(format!(
					"Invalid skill document: {error}"
				))
			})?;

			let mut final_file_path = path.clone();
			let mut renamed_path = None;

			// Handle rename
			if name != skill.name {
				let safe_new_name = sanitize_name(&skill.name);
				if let Some(parent) = path.parent() {
					if parent.file_name().and_then(|n| n.to_str())
						== Some(&safe_old_name)
					{
						let new_parent = parent.with_file_name(&safe_new_name);
						std::fs::rename(parent, &new_parent).map_err(|e| {
							ConfigError::Io(std::io::Error::new(
								e.kind(),
								format!(
									"Failed to rename skill \
										 directory '{}' -> '{}': {}",
									parent.display(),
									new_parent.display(),
									e
								),
							))
						})?;
						final_file_path =
							new_parent.join(path.file_name().unwrap());
						renamed_path = Some((new_parent, parent.to_path_buf()));
					} else if path.file_name().and_then(|n| n.to_str())
						== Some(&format!("{safe_old_name}.md"))
					{
						let new_path =
							path.with_file_name(format!("{safe_new_name}.md"));
						std::fs::rename(&path, &new_path).map_err(|e| {
							ConfigError::Io(std::io::Error::new(
								e.kind(),
								format!(
									"Failed to rename skill \
										 file '{}' -> '{}': {}",
									path.display(),
									new_path.display(),
									e
								),
							))
						})?;
						final_file_path = new_path;
						renamed_path =
							Some((final_file_path.clone(), path.clone()));
					}
				}
			}

			if let Some(parent) = final_file_path.parent() {
				if !parent.exists() {
					std::fs::create_dir_all(parent)?;
				}
			}

			if let Err(write_error) =
				skill::write_skill_document_atomic(&final_file_path, &content)
			{
				let write_error = match write_error {
					skill::SkillError::Io(error) => ConfigError::Io(error),
					error => ConfigError::InvalidConfig(format!(
						"Failed to write skill document: {error}"
					)),
				};
				if let Some((renamed, original)) = renamed_path {
					if let Err(restore_error) =
						std::fs::rename(&renamed, &original)
					{
						return Err(ConfigError::InvalidConfig(format!(
							"Failed to update skill '{}': {write_error}; failed to restore '{}': {restore_error}",
							skill.name,
							original.display()
						)));
					}
				}
				return Err(write_error);
			}

			let mut fs_skill = skill.clone();
			if final_file_path == path {
				fs_skill.source_path = existing_skill.source_path.clone();
				fs_skill.canonical_path = existing_skill.canonical_path.clone();
			} else {
				fs_skill.source_path =
					Some(final_file_path.to_string_lossy().to_string());
				fs_skill.canonical_path = None;
			}
			config.skills[index] = fs_skill;
		}

		Ok(())
	}

	pub fn remove_skill(&mut self, name: &str) -> Result<()> {
		let target_dir = self.target_skills_dir();
		let agent_name = self.adapter.name().to_string();
		let config = self.config.as_ref().ok_or_else(|| {
			ConfigError::InvalidConfig("No configuration loaded".to_string())
		})?;
		let index = config
			.skills
			.iter()
			.position(|s| s.name == name)
			.ok_or_else(|| ConfigError::resource_not_found("skill", name))?;
		let existing_skill = config.skills[index].clone();

		let safe_name = sanitize_name(name);
		let file_path = if let Some(sp) = &existing_skill.source_path {
			Some(resolve_source_path(sp))
		} else {
			target_dir.map(|dir| dir.join(&safe_name).join("SKILL.md"))
		};
		let is_symlink = existing_skill.canonical_path.is_some();
		let transaction_paths = file_path
			.as_deref()
			.map(skill::lock::skill_transaction_path)
			.into_iter()
			.collect::<Vec<_>>();
		let _transaction = skill::lock::lock_skill_paths(
			transaction_paths.iter().map(PathBuf::as_path),
		)?;
		let config = self.config_mut()?;
		info!("removing skill '{}' for agent '{}'", name, agent_name);

		if let Some(path) = file_path {
			let current = match skill::parser::parse(&path) {
				Ok(current) if current.name == name => convert_skill(current),
				Ok(_) => {
					return Err(ConfigError::resource_changed("skill", name));
				}
				Err(skill::SkillError::NotFound(_)) => {
					return Err(ConfigError::resource_not_found("skill", name));
				}
				Err(error) => {
					return Err(ConfigError::InvalidConfig(format!(
						"Failed to parse existing skill '{}': {error}",
						path.display()
					)));
				}
			};
			if !persisted_skill_matches(&existing_skill, &current) {
				return Err(ConfigError::resource_changed("skill", name));
			}
			remove_skill_path(&path, &safe_name, is_symlink)?;
		}

		config.skills.remove(index);
		Ok(())
	}

	fn set_skill_enabled(&mut self, name: &str, enabled: bool) -> Result<()> {
		let agent_name = self.adapter.name().to_string();
		let config = self.config_mut()?;
		let skill = config
			.skills
			.iter_mut()
			.find(|s| s.name == name)
			.ok_or_else(|| ConfigError::resource_not_found("skill", name))?;
		info!(
			"setting skill '{}' enabled={} for agent '{}'",
			name, enabled, agent_name
		);
		skill.enabled = enabled;
		Ok(())
	}

	pub fn disable_skill(&mut self, name: &str) -> Result<()> {
		self.set_skill_enabled(name, false)
	}

	pub fn enable_skill(&mut self, name: &str) -> Result<()> {
		self.set_skill_enabled(name, true)
	}

	pub fn add_skill_from_path(&mut self, path: &Path) -> Result<Skill> {
		let snapshot = SkillImportSnapshot::capture(path)?;
		self.add_skill_from_snapshot(&snapshot)
	}

	pub fn add_skill_from_snapshot(
		&mut self,
		snapshot: &SkillImportSnapshot,
	) -> Result<Skill> {
		match self.add_skill_from_snapshot_with_commit(snapshot, |_, _| {
			Ok::<(), Infallible>(())
		}) {
			Ok(skill) => Ok(skill),
			Err(SkillImportCommitError::Import(error)) => Err(error),
			Err(SkillImportCommitError::Commit(error)) => match error {},
			Err(SkillImportCommitError::Rollback { commit, .. }) => {
				match commit {}
			}
		}
	}

	pub fn add_skill_from_snapshot_with_name(
		&mut self,
		snapshot: &SkillImportSnapshot,
		name: String,
	) -> Result<Skill> {
		match self.add_skill_from_snapshot_named_with_commit(
			snapshot,
			Some(name),
			|_, _| Ok::<(), Infallible>(()),
		) {
			Ok(skill) => Ok(skill),
			Err(SkillImportCommitError::Import(error)) => Err(error),
			Err(SkillImportCommitError::Commit(error)) => match error {},
			Err(SkillImportCommitError::Rollback { commit, .. }) => {
				match commit {}
			}
		}
	}

	pub fn add_skill_from_snapshot_with_commit<E, F>(
		&mut self,
		snapshot: &SkillImportSnapshot,
		after_install: F,
	) -> std::result::Result<Skill, SkillImportCommitError<E>>
	where
		F: FnOnce(&Skill, &Path) -> std::result::Result<(), E>,
	{
		self.add_skill_from_snapshot_named_with_commit(
			snapshot,
			None,
			after_install,
		)
	}

	fn add_skill_from_snapshot_named_with_commit<E, F>(
		&mut self,
		snapshot: &SkillImportSnapshot,
		name: Option<String>,
		after_install: F,
	) -> std::result::Result<Skill, SkillImportCommitError<E>>
	where
		F: FnOnce(&Skill, &Path) -> std::result::Result<(), E>,
	{
		let path = snapshot.path();
		debug!(
			"adding skill from path '{}' for agent '{}'",
			path.display(),
			self.adapter.name()
		);
		let skill_pkg = skill::parser::parse(path)
			.map_err(|error| {
				ConfigError::InvalidConfig(format!(
					"Failed to parse skill: {error}"
				))
			})
			.map_err(SkillImportCommitError::Import)?;
		let source =
			import_source_from_parsed(path, &skill_pkg.source, &skill_pkg.name)
				.map_err(SkillImportCommitError::Import)?;
		let mut skill = convert_skill(skill_pkg);
		let has_custom_name = name.is_some();
		if let Some(name) = name {
			skill.name = name;
		}
		let renamed_skill_md = if has_custom_name {
			let reviewed = skill::read_skill_content(path)
				.map_err(|error| {
					ConfigError::InvalidConfig(format!(
						"Failed to read reviewed skill: {error}"
					))
				})
				.map_err(SkillImportCommitError::Import)?;
			Some(
				skill::rename_skill_md(&reviewed.skill_md, &skill.name)
					.map_err(|error| {
						ConfigError::InvalidConfig(format!(
							"Invalid skill name '{}': {error}",
							skill.name
						))
					})
					.map_err(SkillImportCommitError::Import)?,
			)
		} else {
			None
		};
		let target_dir = self
			.target_skills_dir()
			.ok_or_else(|| {
				ConfigError::InvalidConfig(
					"Agent does not support persistent skill creation \
					 in the current scope"
						.into(),
				)
			})
			.map_err(SkillImportCommitError::Import)?;
		let safe_name = sanitize_name(&skill.name);
		let skill_dir = target_dir.join(&safe_name);
		let agent_name = self.adapter.name().to_string();
		let _transaction = skill::lock::lock_skill_paths([skill_dir.as_path()])
			.map_err(ConfigError::Io)
			.map_err(SkillImportCommitError::Import)?;

		{
			let config =
				self.config_mut().map_err(SkillImportCommitError::Import)?;
			if config.skills.iter().any(|s| s.name == skill.name) {
				return Err(SkillImportCommitError::Import(
					ConfigError::resource_exists("skill", &skill.name),
				));
			}
			match std::fs::symlink_metadata(&skill_dir) {
				Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
				Err(error) => {
					return Err(SkillImportCommitError::Import(
						ConfigError::Io(error),
					));
				}
				Ok(_) => {
					return Err(SkillImportCommitError::Import(
						ConfigError::resource_exists(
							"skill target",
							skill_dir.display().to_string(),
						),
					));
				}
			}
		}

		info!(
			"importing skill '{}' from '{}' for agent '{}'",
			skill.name,
			path.display(),
			agent_name
		);
		copy_import_source_staged(
			&source,
			&skill_dir,
			snapshot.original_root(),
		)
		.map_err(SkillImportCommitError::Import)?;
		let installed_file = skill_dir.join("SKILL.md");
		if let Some(renamed_skill_md) = renamed_skill_md {
			if let Err(error) = skill::write_skill_document_atomic(
				&installed_file,
				&renamed_skill_md,
			) {
				let error = match error {
					skill::SkillError::Io(error) => ConfigError::Io(error),
					error => ConfigError::InvalidConfig(format!(
						"Failed to write imported skill: {error}"
					)),
				};
				if let Err(rollback_error) = remove_import_path(&skill_dir) {
					return Err(SkillImportCommitError::Import(
						ConfigError::InvalidConfig(format!(
							"Failed to write imported skill '{}': {error}; failed to remove '{}': {rollback_error}",
							skill.name,
							skill_dir.display()
						)),
					));
				}
				return Err(SkillImportCommitError::Import(error));
			}
		}

		skill.source_path = Some(installed_file.to_string_lossy().to_string());
		skill.canonical_path = None;
		self.config_mut()
			.map_err(SkillImportCommitError::Import)?
			.skills
			.push(skill.clone());
		if let Err(commit) = after_install(&skill, &skill_dir) {
			return match self.rollback_imported_skill(&skill, &skill_dir) {
				Ok(()) => Err(SkillImportCommitError::Commit(commit)),
				Err(rollback) => Err(SkillImportCommitError::Rollback {
					commit,
					rollback,
					skill_name: skill.name.clone(),
				}),
			};
		}
		Ok(skill)
	}

	fn rollback_imported_skill(
		&mut self,
		imported: &Skill,
		skill_dir: &Path,
	) -> Result<()> {
		let remove_error = remove_import_path(skill_dir).err();
		if let Some(config) = self.config.as_mut() {
			config.skills.retain(|item| item.name != imported.name);
		}

		match remove_error {
			None => Ok(()),
			Some(error) => Err(ConfigError::Io(error)),
		}
	}

	pub fn validate_skill_path(&self, path: &Path) -> Vec<String> {
		let mut errors = Vec::new();
		match skill::parser::parse(path) {
			Ok(_) => {}
			Err(e) => {
				warn!("skill validation failed for '{}': {e}", path.display());
				errors.push(format!("Parse error: {e}"));
			}
		}
		errors
	}

	fn target_skills_dir(&self) -> Option<PathBuf> {
		self.adapter
			.target_skills_dir(self.project_root.as_deref(), self.scope)
	}
}

/// Serialize frontmatter fields as structured YAML via serde_yaml
fn serialize_frontmatter(skill: &Skill) -> String {
	let mut map = BTreeMap::new();
	map.insert(
		"name".to_string(),
		serde_yaml::Value::String(skill.name.clone()),
	);
	let description = skill
		.description
		.as_deref()
		.unwrap_or("")
		.replace('\n', " ");
	map.insert(
		"description".to_string(),
		serde_yaml::Value::String(description),
	);
	if let Some(author) = &skill.author {
		map.insert(
			"author".to_string(),
			serde_yaml::Value::String(author.clone()),
		);
	}
	if let Some(version) = &skill.version {
		map.insert(
			"version".to_string(),
			serde_yaml::Value::String(version.clone()),
		);
	}
	if !skill.tools.is_empty() {
		map.insert(
			"allowed-tools".to_string(),
			serde_yaml::Value::String(skill.tools.join(",")),
		);
	}
	serde_yaml::to_string(&map).unwrap_or_default()
}

/// Format a Skill as a valid SKILL.md, preserving existing body content
/// unless new body content is explicitly supplied.
fn format_skill(skill: &Skill, existing_body: Option<&str>) -> String {
	let yaml = serialize_frontmatter(skill);
	let mut out = String::from("---\n");
	out.push_str(&yaml);
	out.push_str("---\n");

	if let Some(body) = skill.content.as_deref().or(existing_body) {
		out.push_str(body);
	} else {
		out.push_str(&format!("\n# {}\n\n", skill.name));
	}

	out
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_format_skill_preserves_body() {
		let mut skill = Skill::new("test-skill");
		skill.description = Some("A test".to_string());
		let body = "\n# Original Title\n\nInstruction content.\n";
		let output = format_skill(&skill, Some(body));
		assert!(output.contains("# Original Title"));
		assert!(output.contains("Instruction content."));
		// Frontmatter should be valid YAML
		assert!(output.starts_with("---\n"));
		assert!(output.contains("---\n\n# Original Title"));
	}

	#[test]
	fn test_format_skill_generates_placeholder_without_body() {
		let skill = Skill::new("test-skill");
		let output = format_skill(&skill, None);
		assert!(output.contains("# test-skill"));
	}

	#[test]
	fn test_format_skill_stays_parseable_by_skill_crate() {
		let skill = Skill::new("test-skill");
		let output = format_skill(&skill, None);
		let parsed = skill::parser::parse_skill_md(&output).unwrap();
		assert_eq!(parsed.name, "test-skill");
		assert_eq!(parsed.description, "");
	}

	#[test]
	fn test_format_skill_quotes_colon_in_description() {
		let mut skill = Skill::new("test");
		skill.description = Some("Source: https://example.com".to_string());
		let output = format_skill(&skill, None);
		// serde_yaml should quote the value containing ':'
		let reparsed: BTreeMap<String, String> = serde_yaml::from_str(
			output
				.trim_start_matches("---\n")
				.split("---\n")
				.next()
				.unwrap(),
		)
		.expect("Should produce valid YAML");
		assert_eq!(reparsed["description"], "Source: https://example.com");
	}

	#[test]
	fn test_format_skill_quotes_numeric_values() {
		let mut skill = Skill::new("test");
		skill.version = Some("123".to_string());
		skill.author = Some("true".to_string());
		let output = format_skill(&skill, None);
		let reparsed: BTreeMap<String, String> = serde_yaml::from_str(
			output
				.trim_start_matches("---\n")
				.split("---\n")
				.next()
				.unwrap(),
		)
		.expect("Should produce valid YAML");
		assert_eq!(reparsed["version"], "123");
		assert_eq!(reparsed["author"], "true");
	}

	#[test]
	fn staged_import_dir_bounds_long_safe_name() {
		let safe_name = "a".repeat(300);
		let staged = staged_import_dir(Path::new("/tmp"), &safe_name);
		let file_name = staged.file_name().unwrap().to_string_lossy();

		assert!(file_name.starts_with(".aghub-import-"));
		assert!(file_name.len() < 255);
		assert!(file_name.len() < safe_name.len());
	}

	#[test]
	fn directory_import_excludes_repository_metadata() {
		let temp = tempfile::tempdir().unwrap();
		let source = temp.path().join("source");
		let target = temp.path().join("target");
		std::fs::create_dir_all(source.join(".Hg/hooks")).unwrap();
		std::fs::create_dir_all(source.join("assets")).unwrap();
		std::fs::write(source.join("SKILL.md"), "---\nname: test\n---\n")
			.unwrap();
		std::fs::write(source.join(".Hg/hooks/payload.sh"), "payload").unwrap();
		std::fs::write(source.join("assets/keep.txt"), "keep").unwrap();

		copy_import_source(&SkillImportSource::Directory(source), &target, &[])
			.unwrap();

		assert!(!target.join(".Hg").exists());
		assert_eq!(
			std::fs::read_to_string(target.join("assets/keep.txt")).unwrap(),
			"keep"
		);
	}

	#[test]
	fn snapshot_accepts_the_shared_entry_limit() {
		let temp = tempfile::tempdir().unwrap();
		std::fs::write(
			temp.path().join("SKILL.md"),
			"---\nname: entry-limit\ndescription: test\n---\nbody",
		)
		.unwrap();
		for index in 0..skill::MAX_SKILL_CONTENT_FILES - 1 {
			std::fs::create_dir(temp.path().join(format!("empty-{index}")))
				.unwrap();
		}

		let snapshot = SkillImportSnapshot::capture(temp.path()).unwrap();
		assert!(snapshot.path().join("SKILL.md").exists());
	}

	#[test]
	fn directory_snapshot_reports_captured_entries_and_bytes() {
		let temp = tempfile::tempdir().unwrap();
		let skill_md = b"---\nname: directory-count\n---\nbody";
		let script = b"run";
		std::fs::write(temp.path().join("SKILL.md"), skill_md).unwrap();
		std::fs::create_dir_all(temp.path().join("scripts")).unwrap();
		std::fs::write(temp.path().join("scripts/run.sh"), script).unwrap();
		std::fs::create_dir(temp.path().join("assets")).unwrap();

		let snapshot = SkillImportSnapshot::capture(temp.path()).unwrap();

		assert_eq!(snapshot.entry_count(), 4);
		assert_eq!(snapshot.byte_count(), skill_md.len() + script.len());
	}

	#[cfg(unix)]
	#[test]
	fn directory_snapshot_keeps_open_directory_when_source_path_is_replaced() {
		use std::os::unix::fs::symlink;

		let temp = tempfile::tempdir().unwrap();
		let source_parent = temp.path().join("source-parent");
		let moved_parent = temp.path().join("moved-parent");
		let outside_parent = temp.path().join("outside-parent");
		let source = source_parent.join("source");
		let outside = outside_parent.join("source");
		std::fs::create_dir_all(&source).unwrap();
		std::fs::create_dir_all(&outside).unwrap();
		std::fs::write(
			source.join("SKILL.md"),
			"---\nname: source-swap\ndescription: test\n---\nbody",
		)
		.unwrap();
		std::fs::write(source.join("safe.txt"), "safe").unwrap();
		std::fs::write(outside.join("secret.txt"), "secret").unwrap();

		let mut swapped = false;
		let snapshot = SkillImportSnapshot::capture_with_directory_read(
			&source,
			&mut |path| {
				if path == source && !swapped {
					std::fs::rename(&source_parent, &moved_parent).unwrap();
					symlink(&outside_parent, &source_parent).unwrap();
					swapped = true;
				}
			},
		)
		.unwrap();

		assert!(swapped);
		assert_eq!(
			std::fs::read_to_string(snapshot.path().join("safe.txt")).unwrap(),
			"safe"
		);
		assert!(!snapshot.path().join("secret.txt").exists());
	}

	#[test]
	fn standalone_snapshot_reports_installed_entries_and_bytes() {
		let temp = tempfile::tempdir().unwrap();
		let skill_md = b"---\nname: standalone-count\n---\nbody";
		let script = b"setup";
		let reference = b"guide";
		let skill_path = temp.path().join("instructions.md");
		std::fs::write(&skill_path, skill_md).unwrap();
		std::fs::create_dir(temp.path().join("scripts")).unwrap();
		std::fs::write(temp.path().join("scripts/setup.sh"), script).unwrap();
		std::fs::create_dir(temp.path().join("references")).unwrap();
		std::fs::write(temp.path().join("references/guide.md"), reference)
			.unwrap();
		std::fs::write(temp.path().join("not-installed.txt"), "ignored")
			.unwrap();

		let snapshot = SkillImportSnapshot::capture(&skill_path).unwrap();

		assert_eq!(snapshot.entry_count(), 5);
		assert_eq!(
			snapshot.byte_count(),
			skill_md.len() + script.len() + reference.len()
		);
	}

	#[test]
	fn package_snapshot_reports_selected_root_entries_and_bytes() {
		let temp = tempfile::tempdir().unwrap();
		let source = temp.path().join("package-count");
		let skill_md =
			b"---\nname: package-count\ndescription: test\n---\nbody";
		let script = b"run";
		std::fs::create_dir_all(source.join("scripts")).unwrap();
		std::fs::create_dir(source.join("assets")).unwrap();
		std::fs::write(source.join("SKILL.md"), skill_md).unwrap();
		std::fs::write(source.join("scripts/run.sh"), script).unwrap();
		let package = temp.path().join("package-count.skill");
		skill::package::pack(&source, &package).unwrap();

		let snapshot = SkillImportSnapshot::capture(&package).unwrap();

		assert_eq!(snapshot.entry_count(), 4);
		assert_eq!(snapshot.byte_count(), skill_md.len() + script.len());
	}

	#[test]
	fn snapshot_rejects_entries_beyond_the_shared_limit() {
		let temp = tempfile::tempdir().unwrap();
		std::fs::write(
			temp.path().join("SKILL.md"),
			"---\nname: entry-limit\ndescription: test\n---\nbody",
		)
		.unwrap();
		for index in 0..skill::MAX_SKILL_CONTENT_FILES {
			std::fs::create_dir(temp.path().join(format!("empty-{index}")))
				.unwrap();
		}

		let error = match SkillImportSnapshot::capture(temp.path()) {
			Ok(_) => panic!("snapshot should reject too many entries"),
			Err(error) => error,
		};
		assert!(matches!(
			error,
			ConfigError::InvalidConfig(message)
				if message.contains("entry limit")
		));
	}

	#[cfg(unix)]
	#[test]
	fn snapshot_preserves_executable_mode() {
		use std::os::unix::fs::PermissionsExt;

		let temp = tempfile::tempdir().unwrap();
		std::fs::write(
			temp.path().join("SKILL.md"),
			"---\nname: mode-test\ndescription: test\n---\nbody",
		)
		.unwrap();
		let script_dir = temp.path().join("scripts");
		std::fs::create_dir_all(&script_dir).unwrap();
		let script = script_dir.join("run.sh");
		std::fs::write(&script, "#!/bin/sh\n").unwrap();
		std::fs::set_permissions(
			&script,
			std::fs::Permissions::from_mode(0o755),
		)
		.unwrap();

		let snapshot = SkillImportSnapshot::capture(temp.path()).unwrap();
		let mode = std::fs::metadata(snapshot.path().join("scripts/run.sh"))
			.unwrap()
			.permissions()
			.mode();
		assert_eq!(mode & 0o111, 0o111);
	}
}
