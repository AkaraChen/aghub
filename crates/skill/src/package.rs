//! Package operations for .skill/.zip files.
//!
//! This module provides functionality to pack skill directories into .skill files
//! and unpack .skill files to directories.

use crate::error::{Result, SkillError};
use crate::{
	is_repository_metadata_dir, MAX_SKILL_CONTENT_BYTES,
	MAX_SKILL_CONTENT_DEPTH, MAX_SKILL_CONTENT_FILES,
};
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use unicode_normalization::UnicodeNormalization;
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

/// Directories to exclude at any level.
const EXCLUDE_DIRS: &[&str] =
	&["__pycache__", "node_modules", ".git", ".svn", ".hg"];

/// File globs/patterns to exclude.
const EXCLUDE_PATTERNS: &[&str] =
	&["*.pyc", "*.pyo", "*.class", "*.o", "*.obj"];

/// Specific files to exclude.
const EXCLUDE_FILES: &[&str] = &[".DS_Store", "Thumbs.db", "desktop.ini"];

/// Directories to exclude only at the skill root.
const ROOT_EXCLUDE_DIRS: &[&str] = &["evals", "tests", "test"];

const UNIX_FILE_TYPE_MASK: u32 = 0o170000;
const UNIX_REGULAR_FILE: u32 = 0o100000;
const UNIX_DIRECTORY: u32 = 0o040000;
const UNIX_SYMLINK: u32 = 0o120000;
// Win32 reserves ASCII 1-9 and ISO-8859-1 superscript 1-3 for COM/LPT names.
const WINDOWS_RESERVED_PORT_SUFFIXES: [&str; 12] =
	["1", "2", "3", "4", "5", "6", "7", "8", "9", "¹", "²", "³"];
// Allows the 32 MiB content ceiling plus per-entry ZIP headers and metadata.
const MAX_SKILL_PACKAGE_BYTES: u64 = 128 * 1024 * 1024;

#[derive(Clone, Debug)]
pub(crate) struct SkillArchiveEntry {
	pub(crate) index: usize,
	pub(crate) path: String,
	pub(crate) is_dir: bool,
}

#[derive(Debug)]
pub(crate) struct SkillArchive {
	archive: ZipArchive<File>,
	entries: Vec<SkillArchiveEntry>,
	skill_md_index: usize,
	skill_md_path: String,
}

impl SkillArchive {
	pub(crate) fn read_skill_md(&mut self) -> Result<String> {
		let bytes =
			self.read_entry(self.skill_md_index, MAX_SKILL_CONTENT_BYTES)?;
		String::from_utf8(bytes).map_err(|error| {
			SkillError::InvalidFormat(format!(
				"SKILL.md is not valid UTF-8: {error}"
			))
		})
	}

	pub(crate) fn read_entry(
		&mut self,
		index: usize,
		max_bytes: usize,
	) -> Result<Vec<u8>> {
		let entry = self.archive.by_index(index)?;
		let mut content = Vec::with_capacity(
			usize::try_from(entry.size())
				.unwrap_or(max_bytes)
				.min(max_bytes),
		);
		entry.take(max_bytes as u64 + 1).read_to_end(&mut content)?;
		if content.len() > max_bytes {
			return Err(byte_limit_error());
		}
		Ok(content)
	}

	pub(crate) fn skill_files(&self) -> Vec<(usize, String)> {
		let root = self
			.skill_md_path
			.rsplit_once('/')
			.map(|(root, _)| root)
			.unwrap_or_default();
		let prefix = if root.is_empty() {
			String::new()
		} else {
			format!("{root}/")
		};

		self.entries
			.iter()
			.filter(|entry| {
				!entry.is_dir
					&& entry.index != self.skill_md_index
					&& entry.path.starts_with(&prefix)
					&& !is_repository_metadata_path(&entry.path)
			})
			.filter_map(|entry| {
				let relative = &entry.path[prefix.len()..];
				(!relative.is_empty())
					.then(|| (entry.index, relative.to_string()))
			})
			.collect()
	}

	fn entries(&self) -> Vec<SkillArchiveEntry> {
		self.entries.clone()
	}

	fn selected_entries(&self) -> Vec<SkillArchiveEntry> {
		let root = self.skill_root();
		if root.is_empty() {
			return self.entries();
		}
		let prefix = format!("{root}/");
		self.entries
			.iter()
			.filter(|entry| {
				entry.path == root || entry.path.starts_with(&prefix)
			})
			.cloned()
			.collect()
	}

	fn skill_root(&self) -> &str {
		self.skill_md_path
			.rsplit_once('/')
			.map(|(root, _)| root)
			.unwrap_or_default()
	}
}

#[derive(Default)]
struct PortablePathIndex {
	explicit_paths: HashSet<String>,
	directory_spellings: HashMap<String, String>,
	file_paths: HashSet<String>,
}

impl PortablePathIndex {
	fn insert(
		&mut self,
		archive_path: &Path,
		entry_name: &str,
		normalized_path: &str,
		is_directory: bool,
	) -> Result<()> {
		let components = normalized_path.split('/').collect::<Vec<_>>();
		let keys = components
			.iter()
			.map(|component| portable_component_key(component))
			.collect::<Vec<_>>();
		let directory_count = if is_directory {
			components.len()
		} else {
			components.len().saturating_sub(1)
		};
		let mut path_prefix = String::new();
		let mut key_prefix = String::new();

		for index in 0..directory_count {
			if index > 0 {
				path_prefix.push('/');
				key_prefix.push('/');
			}
			path_prefix.push_str(components[index]);
			key_prefix.push_str(&keys[index]);

			if self.file_paths.contains(&key_prefix) {
				return Err(rejected_archive_entry(
					archive_path,
					entry_name,
					"file and directory paths overlap",
				));
			}
			if let Some(existing) = self.directory_spellings.get(&key_prefix) {
				if existing != &path_prefix {
					return Err(rejected_archive_entry(
						archive_path,
						entry_name,
						"directory path differs only by case or Unicode normalization",
					));
				}
			} else {
				self.directory_spellings
					.insert(key_prefix.clone(), path_prefix.clone());
			}
		}

		let full_key = keys.join("/");
		if self.explicit_paths.contains(&full_key) {
			return Err(rejected_archive_entry(
				archive_path,
				entry_name,
				"duplicate archive entry (portable path collision)",
			));
		}

		if is_directory {
			if self.file_paths.contains(&full_key) {
				return Err(rejected_archive_entry(
					archive_path,
					entry_name,
					"file and directory paths overlap",
				));
			}
		} else {
			if self.directory_spellings.contains_key(&full_key) {
				return Err(rejected_archive_entry(
					archive_path,
					entry_name,
					"file and directory paths overlap",
				));
			}
			self.file_paths.insert(full_key.clone());
		}

		self.explicit_paths.insert(full_key);
		Ok(())
	}
}

fn portable_component_key(component: &str) -> String {
	component
		.nfc()
		.collect::<String>()
		.to_lowercase()
		.chars()
		.flat_map(char::to_uppercase)
		.collect::<String>()
		.nfc()
		.collect()
}

pub(crate) fn open_skill_archive(path: &Path) -> Result<SkillArchive> {
	let (file, metadata) = crate::content::open_skill_content_file(path)?;
	if metadata.len() > MAX_SKILL_PACKAGE_BYTES {
		return Err(limit_error(format!(
			"Skill package exceeds the {MAX_SKILL_PACKAGE_BYTES}-byte file limit"
		)));
	}

	let mut archive = ZipArchive::new(file)?;
	if archive.len() > MAX_SKILL_CONTENT_FILES {
		return Err(limit_error(format!(
			"Skill package exceeds the {MAX_SKILL_CONTENT_FILES}-entry limit"
		)));
	}

	let mut total_bytes = 0_u64;
	let mut path_index = PortablePathIndex::default();
	let mut entries = Vec::with_capacity(archive.len());
	let mut skill_md_entry = None;
	let mut candidate_depth = None;
	let mut candidate_count = 0;

	for index in 0..archive.len() {
		let entry = archive.by_index(index)?;
		total_bytes = total_bytes
			.checked_add(entry.size())
			.ok_or_else(byte_limit_error)?;
		if total_bytes > MAX_SKILL_CONTENT_BYTES as u64 {
			return Err(byte_limit_error());
		}

		let normalized_path = validate_archive_entry(path, &entry)?;
		let is_dir = entry.is_dir();
		path_index.insert(path, entry.name(), &normalized_path, is_dir)?;
		if !is_dir
			&& is_skill_md_path(&normalized_path)
			&& !is_repository_metadata_path(&normalized_path)
		{
			let depth = normalized_path.split('/').count();
			match candidate_depth {
				None => {
					candidate_depth = Some(depth);
					candidate_count = 1;
					skill_md_entry = Some((index, normalized_path.clone()));
				}
				Some(current_depth) if depth < current_depth => {
					candidate_depth = Some(depth);
					candidate_count = 1;
					skill_md_entry = Some((index, normalized_path.clone()));
				}
				Some(current_depth) if depth == current_depth => {
					candidate_count += 1;
				}
				Some(_) => {}
			}
		}

		entries.push(SkillArchiveEntry {
			index,
			path: normalized_path,
			is_dir,
		});
	}

	let Some((skill_md_index, skill_md_path)) = skill_md_entry else {
		return Err(SkillError::MissingSkillMd {
			path: path.to_path_buf(),
		});
	};
	if candidate_count != 1 {
		return Err(SkillError::InvalidFormat(format!(
			"Skill package contains {candidate_count} shallowest SKILL.md entries: {}",
			path.display()
		)));
	}
	validate_archive_depths(path, &entries, &skill_md_path)?;

	Ok(SkillArchive {
		archive,
		entries,
		skill_md_index,
		skill_md_path,
	})
}

fn is_skill_md_path(path: &str) -> bool {
	matches!(path.rsplit('/').next(), Some("SKILL.md" | "skill.md"))
}

fn is_repository_metadata_path(path: &str) -> bool {
	path.split('/').any(|component| {
		is_repository_metadata_dir(std::ffi::OsStr::new(component))
	})
}

fn validate_archive_entry(
	archive_path: &Path,
	entry: &zip::read::ZipFile<'_, File>,
) -> Result<String> {
	let path = validate_archive_path(archive_path, entry.name())?;
	validate_archive_file_type(
		archive_path,
		entry.name(),
		entry.unix_mode(),
		entry.is_dir(),
	)?;
	Ok(path)
}

fn validate_archive_file_type(
	archive_path: &Path,
	entry_name: &str,
	unix_mode: Option<u32>,
	is_directory: bool,
) -> Result<()> {
	if let Some(file_type) = unix_mode.map(|mode| mode & UNIX_FILE_TYPE_MASK) {
		match file_type {
			0 => {}
			UNIX_REGULAR_FILE if !is_directory => {}
			UNIX_DIRECTORY if is_directory => {}
			UNIX_SYMLINK => {
				return Err(rejected_archive_entry(
					archive_path,
					entry_name,
					"symbolic link",
				));
			}
			_ => {
				return Err(rejected_archive_entry(
					archive_path,
					entry_name,
					"special or inconsistent file type",
				));
			}
		}
	}
	Ok(())
}

fn validate_archive_path(
	archive_path: &Path,
	entry_name: &str,
) -> Result<String> {
	if entry_name.contains('\0') {
		return Err(rejected_archive_entry(
			archive_path,
			entry_name,
			"invalid path",
		));
	}

	let normalized = entry_name.replace('\\', "/");
	if normalized.starts_with('/') {
		return Err(rejected_archive_entry(
			archive_path,
			entry_name,
			"absolute path",
		));
	}
	let relative = normalized.strip_suffix('/').unwrap_or(&normalized);
	for component in relative.split('/') {
		if component.is_empty()
			|| component == "."
			|| component == ".."
			|| has_windows_forbidden_character(component)
			|| component.ends_with(['.', ' '])
			|| is_windows_device_name(component)
		{
			return Err(rejected_archive_entry(
				archive_path,
				entry_name,
				"invalid path",
			));
		}
	}
	Ok(relative.to_string())
}

fn has_windows_forbidden_character(component: &str) -> bool {
	component.chars().any(|character| {
		character <= '\u{1f}'
			|| matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*')
	})
}

fn validate_archive_depths(
	archive_path: &Path,
	entries: &[SkillArchiveEntry],
	skill_md_path: &str,
) -> Result<()> {
	let skill_root = skill_md_path
		.rsplit_once('/')
		.map(|(root, _)| root)
		.unwrap_or_default();
	let skill_prefix = if skill_root.is_empty() {
		String::new()
	} else {
		format!("{skill_root}/")
	};

	for entry in entries {
		let relative = if skill_root.is_empty() {
			entry.path.as_str()
		} else if entry.path == skill_root {
			""
		} else if let Some(relative) = entry.path.strip_prefix(&skill_prefix) {
			relative
		} else if entry.is_dir
			&& skill_root
				.strip_prefix(&entry.path)
				.is_some_and(|suffix| suffix.starts_with('/'))
		{
			continue;
		} else {
			entry.path.as_str()
		};
		validate_skill_relative_depth(
			archive_path,
			&entry.path,
			relative,
			entry.is_dir,
		)?;
	}

	Ok(())
}

fn validate_skill_relative_depth(
	archive_path: &Path,
	entry_name: &str,
	relative_path: &str,
	is_directory: bool,
) -> Result<()> {
	let component_count = if relative_path.is_empty() {
		0
	} else {
		relative_path.split('/').count()
	};
	let depth = if is_directory {
		component_count
	} else {
		component_count.saturating_sub(1)
	};
	if depth > MAX_SKILL_CONTENT_DEPTH {
		return Err(limit_error(format!(
			"Archive entry {entry_name:?} exceeds the \
			 {MAX_SKILL_CONTENT_DEPTH}-level limit: {}",
			archive_path.display()
		)));
	}
	Ok(())
}

fn is_windows_device_name(component: &str) -> bool {
	let stem = component
		.split('.')
		.next()
		.unwrap_or_default()
		.to_ascii_uppercase();
	if matches!(
		stem.as_str(),
		"CON" | "PRN" | "AUX" | "NUL" | "CLOCK$" | "CONIN$" | "CONOUT$"
	) {
		return true;
	}
	stem.strip_prefix("COM")
		.or_else(|| stem.strip_prefix("LPT"))
		.is_some_and(|suffix| WINDOWS_RESERVED_PORT_SUFFIXES.contains(&suffix))
}

fn byte_limit_error() -> SkillError {
	limit_error(format!(
		"Skill package exceeds the {MAX_SKILL_CONTENT_BYTES}-byte content limit"
	))
}

fn limit_error(message: String) -> SkillError {
	SkillError::InvalidFormat(message)
}

fn rejected_path(path: &Path, kind: &str) -> SkillError {
	SkillError::InvalidFormat(format!(
		"Skill package rejected {kind}: {}",
		path.display()
	))
}

fn rejected_archive_entry(
	archive_path: &Path,
	entry_name: &str,
	kind: &str,
) -> SkillError {
	SkillError::InvalidFormat(format!(
		"Skill package rejected {kind}: {}!{entry_name}",
		archive_path.display()
	))
}

/// Check if a file should be excluded based on name and location.
fn should_exclude_entry(
	path: &Path,
	skill_root: &Path,
	is_directory: bool,
) -> bool {
	let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
	if is_repository_metadata_dir(path.file_name().unwrap_or_default()) {
		return true;
	}

	// Check specific excluded files
	if EXCLUDE_FILES.contains(&file_name) {
		return true;
	}

	// Check excluded patterns
	for pattern in EXCLUDE_PATTERNS {
		if let Some(star_pos) = pattern.find('*') {
			let prefix = &pattern[..star_pos];
			let suffix = &pattern[star_pos + 1..];
			if file_name.starts_with(prefix) && file_name.ends_with(suffix) {
				return true;
			}
		} else if file_name == *pattern {
			return true;
		}
	}

	// Check if it's a directory and should be excluded
	if is_directory {
		// Always exclude certain directories at any level
		if EXCLUDE_DIRS.contains(&file_name) {
			return true;
		}

		// Exclude certain directories only at root level
		let is_root = path.parent() == Some(skill_root);
		if is_root && ROOT_EXCLUDE_DIRS.contains(&file_name) {
			return true;
		}
	}

	false
}

#[cfg(test)]
fn should_exclude(path: &Path, skill_root: &Path) -> bool {
	let is_directory =
		std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_dir());
	should_exclude_entry(path, skill_root, is_directory)
}

/// Get the relative path from the skill root for archive entry names.
fn get_archive_name(path: &Path, skill_root: &Path) -> Result<String> {
	let relative =
		path.strip_prefix(skill_root.parent().unwrap_or(skill_root))?;
	let name = relative.to_str().ok_or_else(|| {
		SkillError::InvalidFormat(format!(
			"Skill package rejected non-UTF-8 path: {}",
			path.display()
		))
	})?;
	Ok(name.replace('\\', "/"))
}

struct PackEntry {
	archive_path: String,
	content: Option<Vec<u8>>,
}

fn preflight_pack(
	skill_dir: &Path,
	output_path: &Path,
) -> Result<Vec<PackEntry>> {
	let root_metadata = match std::fs::symlink_metadata(skill_dir) {
		Ok(metadata) => metadata,
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			return Err(SkillError::NotFound(format!(
				"Skill directory not found: {}",
				skill_dir.display()
			)));
		}
		Err(error) => return Err(error.into()),
	};
	if root_metadata.file_type().is_symlink() {
		return Err(rejected_path(skill_dir, "symbolic link source directory"));
	}
	if !root_metadata.is_dir() {
		return Err(rejected_path(skill_dir, "non-directory source"));
	}
	let skill_dir = std::fs::canonicalize(skill_dir)?;
	let skill_dir = skill_dir.as_path();
	reject_pack_output_inside_source(skill_dir, output_path)?;

	let skill_md = skill_dir.join("SKILL.md");
	match std::fs::symlink_metadata(&skill_md) {
		Ok(metadata) if metadata.file_type().is_symlink() => {
			return Err(rejected_path(&skill_md, "symbolic link"));
		}
		Ok(metadata) if !metadata.is_file() => {
			return Err(rejected_path(&skill_md, "non-regular file"));
		}
		Ok(_) => {}
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			return Err(SkillError::MissingSkillMd {
				path: skill_dir.to_path_buf(),
			});
		}
		Err(error) => return Err(error.into()),
	}

	let mut entries = Vec::new();
	let mut total_bytes = 0_usize;
	let mut path_index = PortablePathIndex::default();
	let walker = WalkDir::new(skill_dir)
		.follow_links(false)
		.into_iter()
		.filter_entry(|entry| {
			entry.depth() == 0
				|| entry.file_type().is_symlink()
				|| !entry.file_type().is_dir()
				|| !should_exclude_entry(
					entry.path(),
					skill_dir,
					entry.file_type().is_dir(),
				)
		});

	for entry in walker {
		let entry = entry
			.map_err(|error| SkillError::Io(std::io::Error::other(error)))?;
		if entry.depth() == 0 {
			continue;
		}
		let file_type = entry.file_type();
		if file_type.is_symlink() {
			return Err(rejected_path(entry.path(), "symbolic link"));
		}
		if should_exclude_entry(entry.path(), skill_dir, file_type.is_dir()) {
			continue;
		}
		if !file_type.is_dir() && !file_type.is_file() {
			return Err(rejected_path(entry.path(), "special file"));
		}
		if entries.len() >= MAX_SKILL_CONTENT_FILES {
			return Err(limit_error(format!(
				"Skill package exceeds the {MAX_SKILL_CONTENT_FILES}-entry limit"
			)));
		}

		let archive_name = get_archive_name(entry.path(), skill_dir)?;
		let archive_path = validate_archive_path(output_path, &archive_name)?;
		let relative_path = entry.path().strip_prefix(skill_dir)?;
		let relative_name = relative_path
			.to_str()
			.ok_or_else(|| {
				SkillError::InvalidFormat(format!(
					"Skill package rejected non-UTF-8 path: {}",
					entry.path().display()
				))
			})?
			.replace('\\', "/");
		validate_skill_relative_depth(
			output_path,
			&archive_name,
			&relative_name,
			file_type.is_dir(),
		)?;
		path_index.insert(
			output_path,
			&archive_name,
			&archive_path,
			file_type.is_dir(),
		)?;

		let content = if file_type.is_file() {
			let remaining = MAX_SKILL_CONTENT_BYTES.saturating_sub(total_bytes);
			let content = read_pack_file(entry.path(), remaining)?;
			total_bytes = total_bytes
				.checked_add(content.len())
				.ok_or_else(byte_limit_error)?;
			Some(content)
		} else {
			None
		};
		entries.push(PackEntry {
			archive_path,
			content,
		});
	}

	if !entries.iter().any(|entry| {
		entry.content.is_some()
			&& is_skill_md_path(&entry.archive_path)
			&& !is_repository_metadata_path(&entry.archive_path)
	}) {
		return Err(SkillError::MissingSkillMd {
			path: skill_dir.to_path_buf(),
		});
	}
	Ok(entries)
}

fn read_pack_file(path: &Path, max_bytes: usize) -> Result<Vec<u8>> {
	let (file, metadata) = crate::content::open_skill_content_file(path)?;
	if metadata.len() > max_bytes as u64 {
		return Err(byte_limit_error());
	}
	let mut content = Vec::with_capacity(metadata.len() as usize);
	file.take(max_bytes as u64 + 1).read_to_end(&mut content)?;
	if content.len() > max_bytes {
		return Err(byte_limit_error());
	}
	Ok(content)
}

fn reject_pack_output_inside_source(
	skill_dir: &Path,
	output_path: &Path,
) -> Result<()> {
	if std::fs::symlink_metadata(output_path)
		.is_ok_and(|metadata| metadata.file_type().is_symlink())
	{
		return Err(rejected_path(output_path, "symbolic link output"));
	}
	let source = std::fs::canonicalize(skill_dir)?;
	let output = resolve_candidate_path(output_path)?;
	if output.starts_with(&source) {
		return Err(rejected_path(
			output_path,
			"output inside source directory",
		));
	}
	Ok(())
}

fn resolve_candidate_path(path: &Path) -> Result<PathBuf> {
	let mut existing = if path.is_absolute() {
		path.to_path_buf()
	} else {
		std::env::current_dir()?.join(path)
	};
	let mut missing = Vec::<OsString>::new();
	loop {
		match std::fs::symlink_metadata(&existing) {
			Ok(_) => {
				let mut resolved = std::fs::canonicalize(&existing)?;
				for component in missing.iter().rev() {
					resolved.push(component);
				}
				return Ok(resolved);
			}
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
				let component = existing.file_name().ok_or_else(|| {
					rejected_path(path, "unresolvable output path")
				})?;
				if component == "." || component == ".." {
					return Err(rejected_path(path, "invalid output path"));
				}
				missing.push(component.to_os_string());
				if !existing.pop() {
					return Err(rejected_path(
						path,
						"unresolvable output path",
					));
				}
			}
			Err(error) => return Err(error.into()),
		}
	}
}

/// Pack a skill directory into a .skill/.zip file.
///
/// # Arguments
/// * `skill_dir` - Path to the skill directory
/// * `output_path` - Path for the output .skill file
///
/// # Returns
/// * `Ok(())` - If packing succeeds
///
/// # Errors
/// * `SkillError::Io` - If file operations fail
/// * `SkillError::MissingSkillMd` - If SKILL.md is missing
/// * `SkillError::Validation` - If skill validation fails
pub fn pack(skill_dir: &Path, output_path: &Path) -> Result<()> {
	let entries = preflight_pack(skill_dir, output_path)?;

	// Create output directory if needed
	if let Some(parent) = output_path.parent() {
		std::fs::create_dir_all(parent)?;
	}

	// Create zip file
	let file = File::create(output_path)?;
	let mut zip = ZipWriter::new(file);

	let options = SimpleFileOptions::default()
		.compression_method(CompressionMethod::Deflated)
		.compression_level(Some(6));

	for entry in entries {
		if let Some(content) = entry.content {
			zip.start_file(entry.archive_path, options)?;
			zip.write_all(&content)?;
		} else {
			zip.add_directory(format!("{}/", entry.archive_path), options)?;
		}
	}

	zip.finish()?;
	Ok(())
}

/// Unpack a .skill/.zip file to a directory.
///
/// # Arguments
/// * `skill_file` - Path to the .skill or .zip file
/// * `output_dir` - Directory to extract to
///
/// # Returns
/// * `Ok(())` - If unpacking succeeds
///
/// # Errors
/// * `SkillError::Io` - If file operations fail
/// * `SkillError::Zip` - If zip extraction fails
pub fn unpack(skill_file: &Path, output_dir: &Path) -> Result<()> {
	let mut package = open_skill_archive(skill_file)?;
	let entries = package.entries();
	let entries = read_unpack_entries(&mut package, entries)?;
	let resolved_output = preflight_unpack_output(output_dir, &entries)?;
	write_unpack_entries(&resolved_output, entries)
}

/// Unpack only the selected skill root and return its materialized directory.
pub fn unpack_skill_root(
	skill_file: &Path,
	output_dir: &Path,
) -> Result<PathBuf> {
	let mut package = open_skill_archive(skill_file)?;
	let root = package.skill_root().to_string();
	let entries = package.selected_entries();
	let entries = read_unpack_entries(&mut package, entries)?;
	let resolved_output = preflight_unpack_output(output_dir, &entries)?;
	write_unpack_entries(&resolved_output, entries)?;
	Ok(if root.is_empty() {
		output_dir.to_path_buf()
	} else {
		output_dir.join(root)
	})
}

struct UnpackEntry {
	path: String,
	content: Option<Vec<u8>>,
}

fn read_unpack_entries(
	package: &mut SkillArchive,
	entries: Vec<SkillArchiveEntry>,
) -> Result<Vec<UnpackEntry>> {
	let mut remaining_bytes = MAX_SKILL_CONTENT_BYTES;
	let mut unpack_entries = Vec::with_capacity(entries.len());
	for entry in entries {
		if is_repository_metadata_path(&entry.path) {
			continue;
		}
		let content = if entry.is_dir {
			None
		} else {
			let content = package.read_entry(entry.index, remaining_bytes)?;
			remaining_bytes = remaining_bytes.saturating_sub(content.len());
			Some(content)
		};
		unpack_entries.push(UnpackEntry {
			path: entry.path,
			content,
		});
	}
	Ok(unpack_entries)
}

fn preflight_unpack_output(
	output_dir: &Path,
	entries: &[UnpackEntry],
) -> Result<PathBuf> {
	let resolved_output = resolve_output_ancestors(output_dir)?;
	for entry in entries {
		preflight_unpack_target(&resolved_output, entry)?;
	}
	Ok(resolved_output)
}

fn resolve_output_ancestors(output_dir: &Path) -> Result<PathBuf> {
	let absolute = if output_dir.is_absolute() {
		output_dir.to_path_buf()
	} else {
		std::env::current_dir()?.join(output_dir)
	};
	let mut current = PathBuf::new();
	let mut missing = false;
	for component in absolute.components() {
		current.push(component.as_os_str());
		if missing {
			continue;
		}
		match std::fs::symlink_metadata(&current) {
			Ok(metadata) if metadata.file_type().is_symlink() => {
				let is_root_alias = current
					.parent()
					.is_some_and(|parent| parent.parent().is_none());
				if is_root_alias {
					current = std::fs::canonicalize(&current)?;
					continue;
				}
				return Err(rejected_path(
					&current,
					"symbolic link output ancestor",
				));
			}
			Ok(metadata) if !metadata.is_dir() => {
				return Err(rejected_path(
					&current,
					"non-directory output ancestor",
				));
			}
			Ok(_) => {}
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
				missing = true;
			}
			Err(error) => return Err(error.into()),
		}
	}
	Ok(current)
}

fn preflight_unpack_target(
	output_dir: &Path,
	entry: &UnpackEntry,
) -> Result<()> {
	let components = entry.path.split('/').collect::<Vec<_>>();
	let mut current = output_dir.to_path_buf();
	for (index, component) in components.iter().enumerate() {
		current.push(component);
		let expects_directory =
			index + 1 < components.len() || entry.content.is_none();
		match std::fs::symlink_metadata(&current) {
			Ok(metadata) if metadata.file_type().is_symlink() => {
				return Err(rejected_path(
					&current,
					"symbolic link output path",
				));
			}
			Ok(metadata) if expects_directory && !metadata.is_dir() => {
				return Err(rejected_path(
					&current,
					"file in output directory path",
				));
			}
			Ok(metadata) if !expects_directory && !metadata.is_file() => {
				return Err(rejected_path(&current, "non-regular output file"));
			}
			Ok(_) if !expects_directory => {
				return Err(rejected_path(&current, "existing output file"));
			}
			Ok(_) => {}
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
			Err(error) => return Err(error.into()),
		}
	}
	Ok(())
}

fn write_unpack_entries(
	output_dir: &Path,
	entries: Vec<UnpackEntry>,
) -> Result<()> {
	#[cfg(unix)]
	{
		let output = UnixUnpackDirectory::open(output_dir)?;
		for entry in entries {
			if let Some(content) = entry.content {
				output.write_file(&entry.path, &content)?;
			} else {
				output.create_directory(&entry.path)?;
			}
		}
		Ok(())
	}

	#[cfg(not(unix))]
	{
		std::fs::create_dir_all(output_dir)?;
		for entry in entries {
			let output_path = output_dir.join(&entry.path);
			if let Some(content) = entry.content {
				if let Some(parent) = output_path.parent() {
					std::fs::create_dir_all(parent)?;
				}
				OpenOptions::new()
					.write(true)
					.create_new(true)
					.open(output_path)?
					.write_all(&content)?;
			} else {
				std::fs::create_dir_all(output_path)?;
			}
		}
		Ok(())
	}
}

#[cfg(unix)]
struct UnixUnpackDirectory {
	directory: File,
}

#[cfg(unix)]
impl UnixUnpackDirectory {
	fn open(path: &Path) -> Result<Self> {
		use std::path::Component;

		let mut directory = open_directory(Path::new("/"))?;
		for component in path.components() {
			match component {
				Component::RootDir | Component::CurDir => {}
				Component::Normal(name) => {
					directory = open_or_create_directory_at(&directory, name)?;
				}
				Component::ParentDir | Component::Prefix(_) => {
					return Err(rejected_path(path, "invalid output path"));
				}
			}
		}
		Ok(Self { directory })
	}

	fn create_directory(&self, path: &str) -> Result<()> {
		self.open_parent(path, true).map(|_| ())
	}

	fn write_file(&self, path: &str, content: &[u8]) -> Result<()> {
		use rustix::fs::{openat, Mode, OFlags};

		let (parent, file_name) = self.open_parent(path, false)?;
		let flags = OFlags::WRONLY
			| OFlags::CREATE
			| OFlags::EXCL
			| OFlags::CLOEXEC
			| OFlags::NOFOLLOW;
		let descriptor =
			openat(&parent, file_name, flags, Mode::from_raw_mode(0o600))
				.map_err(rustix_io_error)?;
		let mut file = File::from(descriptor);
		file.write_all(content)?;
		Ok(())
	}

	fn open_parent<'a>(
		&self,
		path: &'a str,
		include_last: bool,
	) -> Result<(File, &'a std::ffi::OsStr)> {
		use std::ffi::OsStr;

		let mut components = path.split('/').peekable();
		let mut directory = self.directory.try_clone()?;
		let mut last = OsStr::new("");
		while let Some(component) = components.next() {
			last = OsStr::new(component);
			if include_last || components.peek().is_some() {
				directory = open_or_create_directory_at(&directory, last)?;
			}
		}
		if last.is_empty() {
			return Err(SkillError::InvalidFormat(
				"empty archive output path".to_string(),
			));
		}
		Ok((directory, last))
	}
}

#[cfg(unix)]
fn open_directory(path: &Path) -> Result<File> {
	use std::os::unix::fs::OpenOptionsExt;

	Ok(OpenOptions::new()
		.read(true)
		.custom_flags(libc::O_CLOEXEC | libc::O_DIRECTORY | libc::O_NOFOLLOW)
		.open(path)?)
}

#[cfg(unix)]
fn open_or_create_directory_at(
	parent: &File,
	name: &std::ffi::OsStr,
) -> Result<File> {
	use rustix::fs::{mkdirat, openat, Mode, OFlags};

	let flags =
		OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC | OFlags::NOFOLLOW;
	match openat(parent, name, flags, Mode::empty()) {
		Ok(descriptor) => return Ok(File::from(descriptor)),
		Err(rustix::io::Errno::NOENT) => {}
		Err(error) => return Err(rustix_io_error(error).into()),
	}
	match mkdirat(parent, name, Mode::from_raw_mode(0o755)) {
		Ok(()) | Err(rustix::io::Errno::EXIST) => {}
		Err(error) => return Err(rustix_io_error(error).into()),
	}
	openat(parent, name, flags, Mode::empty())
		.map(File::from)
		.map_err(|error| rustix_io_error(error).into())
}

#[cfg(unix)]
fn rustix_io_error(error: rustix::io::Errno) -> std::io::Error {
	std::io::Error::from(error)
}

/// Read SKILL.md content directly from a .skill/.zip file without extracting.
///
/// # Arguments
/// * `skill_file` - Path to the .skill or .zip file
///
/// # Returns
/// * `Ok(String)` - Content of SKILL.md
///
/// # Errors
/// * `SkillError::MissingSkillMd` - If SKILL.md is not found in archive
/// * `SkillError::Zip` - If zip reading fails
pub fn read_skill_md(skill_file: &Path) -> Result<String> {
	open_skill_archive(skill_file)?.read_skill_md()
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::io::Write;
	use std::path::PathBuf;
	use tempfile::TempDir;
	use zip::write::SimpleFileOptions;

	const TEST_SKILL_MD: &str =
		"---\nname: test-skill\ndescription: test skill\n---\n";

	fn write_archive(path: &Path, entries: &[(&str, &str)]) {
		let file = File::create(path).unwrap();
		let mut archive = ZipWriter::new(file);

		for (name, content) in entries {
			archive
				.start_file(*name, SimpleFileOptions::default())
				.unwrap();
			archive.write_all(content.as_bytes()).unwrap();
		}

		archive.finish().unwrap();
	}

	fn write_package(
		path: &Path,
		write_entries: impl FnOnce(&mut ZipWriter<File>),
	) {
		let file = File::create(path).unwrap();
		let mut archive = ZipWriter::new(file);
		archive
			.start_file("packed-skill/SKILL.md", SimpleFileOptions::default())
			.unwrap();
		archive.write_all(TEST_SKILL_MD.as_bytes()).unwrap();
		write_entries(&mut archive);
		archive.finish().unwrap();
	}

	fn create_test_skill_dir(dir: &Path) -> PathBuf {
		let skill_dir = dir.join("test-skill");
		std::fs::create_dir(&skill_dir).unwrap();

		// Create SKILL.md
		std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: test-skill\ndescription: A test skill\n---\n\n# Instructions\n",
        )
        .unwrap();

		// Create scripts directory with a file
		let scripts_dir = skill_dir.join("scripts");
		std::fs::create_dir(&scripts_dir).unwrap();
		std::fs::write(scripts_dir.join("test.sh"), "#!/bin/bash\necho hello")
			.unwrap();

		skill_dir
	}

	#[test]
	fn test_pack_and_unpack() {
		let temp_dir = TempDir::new().unwrap();
		let skill_dir = create_test_skill_dir(temp_dir.path());
		let output_file = temp_dir.path().join("test-skill.skill");
		let unpack_dir = temp_dir.path().join("unpacked");

		// Pack
		pack(&skill_dir, &output_file).unwrap();
		assert!(output_file.exists());

		// Unpack
		unpack(&output_file, &unpack_dir).unwrap();
		assert!(unpack_dir.join("test-skill/SKILL.md").exists());
		assert!(unpack_dir.join("test-skill/scripts/test.sh").exists());
	}

	#[test]
	fn pack_accepts_dot_source() {
		const CHILD_PROCESS: &str = "AGHUB_TEST_PACK_DOT_SOURCE";
		const OUTPUT_PATH: &str = "AGHUB_TEST_PACK_DOT_OUTPUT";

		if std::env::var_os(CHILD_PROCESS).is_some() {
			let output = PathBuf::from(std::env::var_os(OUTPUT_PATH).unwrap());
			pack(Path::new("."), &output).unwrap();
			return;
		}

		let temp_dir = TempDir::new().unwrap();
		let skill_dir = create_test_skill_dir(temp_dir.path());
		let output_file = temp_dir.path().join("dot-source.skill");
		let status =
			std::process::Command::new(std::env::current_exe().unwrap())
				.args(["--exact", "package::tests::pack_accepts_dot_source"])
				.env(CHILD_PROCESS, "1")
				.env(OUTPUT_PATH, &output_file)
				.current_dir(skill_dir)
				.status()
				.unwrap();

		assert!(status.success());
		assert!(read_skill_md(&output_file)
			.unwrap()
			.contains("name: test-skill"));
	}

	#[test]
	fn archive_file_size_is_bounded_before_zip_parsing() {
		let temp_dir = TempDir::new().unwrap();
		let package = temp_dir.path().join("oversized.skill");
		File::create(&package)
			.unwrap()
			.set_len(MAX_SKILL_PACKAGE_BYTES + 1)
			.unwrap();

		let error = read_skill_md(&package).unwrap_err();
		assert!(error.to_string().contains("file limit"));
	}

	#[test]
	fn pack_rejects_a_package_that_would_exceed_the_entry_limit() {
		let temp_dir = TempDir::new().unwrap();
		let skill_dir = create_test_skill_dir(temp_dir.path());
		for index in 0..MAX_SKILL_CONTENT_FILES {
			std::fs::write(skill_dir.join(format!("resource-{index}")), "")
				.unwrap();
		}
		let output_file = temp_dir.path().join("too-many.skill");

		assert!(matches!(
			pack(&skill_dir, &output_file),
			Err(SkillError::InvalidFormat(_))
		));
	}

	#[test]
	fn pack_rejects_content_that_would_exceed_the_byte_limit() {
		let temp_dir = TempDir::new().unwrap();
		let skill_dir = create_test_skill_dir(temp_dir.path());
		let payload = File::create(skill_dir.join("payload.bin")).unwrap();
		payload.set_len(MAX_SKILL_CONTENT_BYTES as u64 + 1).unwrap();
		let output_file = temp_dir.path().join("too-large.skill");

		assert!(matches!(
			pack(&skill_dir, &output_file),
			Err(SkillError::InvalidFormat(_))
		));
		assert!(!output_file.exists());
	}

	#[test]
	fn pack_rejects_content_that_would_exceed_the_depth_limit() {
		let temp_dir = TempDir::new().unwrap();
		let skill_dir = create_test_skill_dir(temp_dir.path());
		let mut nested = skill_dir.clone();
		for _ in 0..=MAX_SKILL_CONTENT_DEPTH {
			nested.push("nested");
			std::fs::create_dir(&nested).unwrap();
		}
		std::fs::write(nested.join("payload.txt"), "payload").unwrap();
		let output_file = temp_dir.path().join("too-deep.skill");

		assert!(matches!(
			pack(&skill_dir, &output_file),
			Err(SkillError::InvalidFormat(_))
		));
		assert!(!output_file.exists());
	}

	#[test]
	fn pack_rejects_an_output_inside_the_source_tree() {
		let temp_dir = TempDir::new().unwrap();
		let skill_dir = create_test_skill_dir(temp_dir.path());
		let output_file = skill_dir.join("nested.skill");

		assert!(matches!(
			pack(&skill_dir, &output_file),
			Err(SkillError::InvalidFormat(_))
		));
		assert!(!output_file.exists());
	}

	#[cfg(unix)]
	#[test]
	fn pack_rejects_symbolic_link_sources() {
		use std::os::unix::fs::symlink;

		let temp_dir = TempDir::new().unwrap();
		let skill_dir = create_test_skill_dir(temp_dir.path());
		let linked_root = temp_dir.path().join("linked-root");
		let outside = temp_dir.path().join("outside.txt");
		std::fs::write(&outside, "outside").unwrap();
		symlink(&skill_dir, &linked_root).unwrap();

		assert!(
			pack(&linked_root, &temp_dir.path().join("linked-root.skill"))
				.is_err()
		);

		symlink(&outside, skill_dir.join("linked.txt")).unwrap();
		let output = temp_dir.path().join("linked-entry.skill");
		std::fs::write(&output, "keep").unwrap();
		assert!(pack(&skill_dir, &output).is_err());
		assert_eq!(std::fs::read_to_string(output).unwrap(), "keep");
	}

	#[test]
	fn test_read_skill_md_from_zip() {
		let temp_dir = TempDir::new().unwrap();
		let skill_dir = create_test_skill_dir(temp_dir.path());
		let output_file = temp_dir.path().join("test-skill.skill");

		pack(&skill_dir, &output_file).unwrap();

		let content = read_skill_md(&output_file).unwrap();
		assert!(content.contains("name: test-skill"));
		assert!(content.contains("description: A test skill"));
	}

	#[test]
	fn package_entry_preflight_is_shared_before_unpack_writes() {
		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("malicious.skill");
		let output_dir = temp_dir.path().join("unpacked");
		write_archive(
			&skill_file,
			&[
				(
					"skill/SKILL.md",
					"---\nname: malicious\ndescription: test skill\n---\n",
				),
				("skill/../../outside.txt", "outside"),
			],
		);

		assert!(matches!(
			read_skill_md(&skill_file),
			Err(SkillError::InvalidFormat(_))
		));
		assert!(matches!(
			crate::parser::parse_skill_file(&skill_file),
			Err(SkillError::InvalidFormat(_))
		));
		assert!(matches!(
			unpack(&skill_file, &output_dir),
			Err(SkillError::InvalidFormat(_))
		));
		assert!(!output_dir.exists());
	}

	#[test]
	fn skill_md_entry_requires_an_exact_basename() {
		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("exact.skill");
		write_archive(
			&skill_file,
			&[
				("EVILSKILL.md", "wrong"),
				("actual/SKILL.md", TEST_SKILL_MD),
			],
		);

		assert_eq!(read_skill_md(&skill_file).unwrap(), TEST_SKILL_MD);
		assert_eq!(
			crate::parser::parse_skill_file(&skill_file).unwrap().name,
			"test-skill"
		);
	}

	#[test]
	fn multiple_shallow_skill_md_entries_are_rejected() {
		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("ambiguous.skill");
		write_archive(
			&skill_file,
			&[
				("first/SKILL.md", TEST_SKILL_MD),
				("second/skill.md", TEST_SKILL_MD),
			],
		);

		assert!(matches!(
			read_skill_md(&skill_file),
			Err(SkillError::InvalidFormat(_))
		));
	}

	#[test]
	fn repository_metadata_cannot_select_the_skill_root() {
		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("metadata-root.skill");
		write_archive(
			&skill_file,
			&[
				(".git/SKILL.md", TEST_SKILL_MD),
				(
					"packed/skill/SKILL.md",
					"---\nname: installed\ndescription: installed skill\n---\n",
				),
				("packed/skill/payload.sh", "payload"),
			],
		);

		let content = crate::content::read_skill_content(&skill_file).unwrap();

		assert!(content.skill_md.contains("name: installed"));
		assert_eq!(content.resources[0].path, "payload.sh");
	}

	#[test]
	fn archive_directory_prefixes_cannot_differ_only_by_case() {
		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("case-prefix.skill");
		write_archive(
			&skill_file,
			&[
				("Demo/SKILL.md", TEST_SKILL_MD),
				("demo/payload.sh", "payload"),
			],
		);

		assert!(open_skill_archive(&skill_file)
			.unwrap_err()
			.to_string()
			.contains("directory path differs only by case"));
	}

	#[test]
	fn archive_directory_prefixes_cannot_differ_by_unicode_normalization() {
		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("unicode-prefix.skill");
		write_archive(
			&skill_file,
			&[
				("Caf\u{e9}/SKILL.md", TEST_SKILL_MD),
				("Cafe\u{301}/payload.sh", "payload"),
			],
		);

		assert!(open_skill_archive(&skill_file).is_err());
	}

	#[test]
	fn archive_rejects_file_and_ancestor_conflicts() {
		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("ancestor.skill");
		write_archive(
			&skill_file,
			&[
				("skill/SKILL.md", TEST_SKILL_MD),
				("skill/scripts", "file"),
				("skill/scripts/run.sh", "payload"),
			],
		);

		assert!(open_skill_archive(&skill_file)
			.unwrap_err()
			.to_string()
			.contains("file and directory"));

		write_archive(
			&skill_file,
			&[
				("skill/SKILL.md", TEST_SKILL_MD),
				("skill/assets/icon.svg", "payload"),
				("skill/assets", "file"),
			],
		);
		assert!(open_skill_archive(&skill_file).is_err());
	}

	#[test]
	fn nested_skill_md_is_a_resource() {
		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("nested.skill");
		write_package(&skill_file, |archive| {
			archive
				.start_file(
					"packed-skill/scripts/SKILL.md",
					SimpleFileOptions::default(),
				)
				.unwrap();
			archive.write_all(b"nested instructions").unwrap();
		});

		let content = crate::content::read_skill_content(&skill_file).unwrap();
		let parsed = crate::parser::parse_skill_file(&skill_file).unwrap();

		assert_eq!(content.resources[0].path, "scripts/SKILL.md");
		assert!(parsed.scripts.contains(&"scripts/SKILL.md".to_string()));
	}

	#[test]
	fn normalized_duplicate_archive_entries_are_rejected() {
		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("duplicate.skill");
		write_package(&skill_file, |archive| {
			for name in [
				"packed-skill/scripts/run.sh",
				"packed-skill\\scripts\\run.sh",
			] {
				archive
					.start_file(name, SimpleFileOptions::default())
					.unwrap();
				archive.write_all(b"run").unwrap();
			}
		});

		assert!(open_skill_archive(&skill_file)
			.unwrap_err()
			.to_string()
			.contains("duplicate archive entry"));
	}

	#[test]
	fn case_only_duplicate_archive_entries_are_rejected() {
		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("duplicate.skill");
		write_package(&skill_file, |archive| {
			for name in
				["packed-skill/scripts/run.sh", "packed-skill/scripts/RUN.SH"]
			{
				archive
					.start_file(name, SimpleFileOptions::default())
					.unwrap();
				archive.write_all(b"run").unwrap();
			}
		});

		assert!(open_skill_archive(&skill_file)
			.unwrap_err()
			.to_string()
			.contains("duplicate archive entry"));
	}

	#[test]
	fn non_ascii_case_duplicate_archive_entries_are_rejected() {
		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("duplicate.skill");
		write_package(&skill_file, |archive| {
			for name in
				["packed-skill/scripts/Ä.sh", "packed-skill/scripts/ä.sh"]
			{
				archive
					.start_file(name, SimpleFileOptions::default())
					.unwrap();
				archive.write_all(b"run").unwrap();
			}
		});

		assert!(open_skill_archive(&skill_file)
			.unwrap_err()
			.to_string()
			.contains("duplicate archive entry"));
	}

	#[test]
	fn unicode_casefold_duplicate_archive_entries_are_rejected() {
		let temp_dir = TempDir::new().unwrap();
		for (index, (left, right)) in [("σ.sh", "ς.sh"), ("ß.sh", "SS.sh")]
			.into_iter()
			.enumerate()
		{
			let skill_file =
				temp_dir.path().join(format!("duplicate-{index}.skill"));
			write_package(&skill_file, |archive| {
				for name in [left, right] {
					archive
						.start_file(
							format!("packed-skill/scripts/{name}"),
							SimpleFileOptions::default(),
						)
						.unwrap();
					archive.write_all(b"run").unwrap();
				}
			});

			assert!(open_skill_archive(&skill_file)
				.unwrap_err()
				.to_string()
				.contains("duplicate archive entry"));
		}
	}

	#[cfg(unix)]
	#[test]
	fn symbolic_link_archive_entry_is_rejected() {
		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("symlink.skill");
		write_package(&skill_file, |archive| {
			archive
				.add_symlink(
					"packed-skill/linked.txt",
					"../outside.txt",
					SimpleFileOptions::default(),
				)
				.unwrap();
		});

		assert!(open_skill_archive(&skill_file)
			.unwrap_err()
			.to_string()
			.contains("symbolic link"));
	}

	#[test]
	fn archive_path_validation_rejects_unsafe_forms() {
		let archive_path = Path::new("test.skill");
		for entry_name in [
			"/absolute.txt",
			"C:/absolute.txt",
			"skill/payload.txt:stream",
			"skill/less<than.txt",
			"skill/greater>than.txt",
			"skill/quote\".txt",
			"skill/pipe|.txt",
			"skill/question?.txt",
			"skill/star*.txt",
			"skill/control\u{1f}.txt",
			"skill/../outside.txt",
			"skill/./payload.txt",
			"skill//payload.txt",
			"skill/payload\0.txt",
			"skill/trailing.",
			"skill/trailing ",
			"skill/CON",
			"skill/com1.txt",
			"skill/LPT9",
			"skill/COM¹",
			"skill/COM².txt",
			"skill/LPT³",
		] {
			assert!(validate_archive_path(archive_path, entry_name).is_err());
		}
	}

	#[test]
	fn archive_file_type_validation_rejects_special_files() {
		let archive_path = Path::new("test.skill");

		assert!(validate_archive_file_type(
			archive_path,
			"skill/socket",
			Some(0o140777),
			false,
		)
		.is_err());
		assert!(validate_archive_file_type(
			archive_path,
			"skill/link",
			Some(UNIX_SYMLINK | 0o777),
			false,
		)
		.is_err());
		assert!(validate_archive_file_type(
			archive_path,
			"skill/file",
			Some(UNIX_DIRECTORY | 0o755),
			false,
		)
		.is_err());
	}

	#[test]
	fn archive_entry_limit_is_checked_during_preflight() {
		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("entries.skill");
		write_package(&skill_file, |archive| {
			for index in 0..MAX_SKILL_CONTENT_FILES {
				archive
					.start_file(
						format!("packed-skill/{index}.txt"),
						SimpleFileOptions::default(),
					)
					.unwrap();
			}
		});

		assert!(open_skill_archive(&skill_file)
			.unwrap_err()
			.to_string()
			.contains("entry limit"));
	}

	#[test]
	fn package_content_accepts_entry_limit_boundary() {
		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("entries.skill");
		write_package(&skill_file, |archive| {
			for index in 0..MAX_SKILL_CONTENT_FILES - 1 {
				archive
					.start_file(
						format!("packed-skill/{index}.txt"),
						SimpleFileOptions::default(),
					)
					.unwrap();
			}
		});

		let content = crate::content::read_skill_content(&skill_file).unwrap();

		assert_eq!(content.resources.len(), MAX_SKILL_CONTENT_FILES - 1);
	}

	#[test]
	fn archive_byte_limit_is_checked_during_preflight() {
		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("bytes.skill");
		write_package(&skill_file, |archive| {
			archive
				.start_file(
					"packed-skill/payload.bin",
					SimpleFileOptions::default(),
				)
				.unwrap();
			let chunk = [0_u8; 8192];
			for _ in 0..MAX_SKILL_CONTENT_BYTES / chunk.len() {
				archive.write_all(&chunk).unwrap();
			}
		});

		assert!(open_skill_archive(&skill_file)
			.unwrap_err()
			.to_string()
			.contains("byte content limit"));
	}

	#[test]
	fn package_depth_is_relative_to_selected_skill_root() {
		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("selected-depth.skill");
		let nested = (0..MAX_SKILL_CONTENT_DEPTH)
			.map(|index| format!("level-{index}"))
			.collect::<Vec<_>>()
			.join("/");
		let payload_path = format!("vendor/packed-skill/{nested}/payload.txt");
		write_archive(
			&skill_file,
			&[
				("vendor/packed-skill/SKILL.md", TEST_SKILL_MD),
				(payload_path.as_str(), "payload"),
			],
		);

		let content = crate::content::read_skill_content(&skill_file).unwrap();

		assert_eq!(content.resources[0].path, format!("{nested}/payload.txt"));
	}

	#[test]
	fn package_rejects_selected_content_over_relative_depth_limit() {
		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("selected-depth.skill");
		let nested = (0..=MAX_SKILL_CONTENT_DEPTH)
			.map(|index| format!("level-{index}"))
			.collect::<Vec<_>>()
			.join("/");
		let payload_path = format!("vendor/packed-skill/{nested}/payload.txt");
		write_archive(
			&skill_file,
			&[
				("vendor/packed-skill/SKILL.md", TEST_SKILL_MD),
				(payload_path.as_str(), "payload"),
			],
		);

		assert!(open_skill_archive(&skill_file)
			.unwrap_err()
			.to_string()
			.contains("level limit"));
	}

	#[test]
	fn pack_accepts_maximum_skill_relative_depth() {
		let temp_dir = TempDir::new().unwrap();
		let skill_dir = create_test_skill_dir(temp_dir.path());
		let skill_file = temp_dir.path().join("depth.skill");
		let nested = (0..MAX_SKILL_CONTENT_DEPTH)
			.map(|index| format!("level-{index}"))
			.collect::<PathBuf>();
		let nested_dir = skill_dir.join(&nested);
		std::fs::create_dir_all(&nested_dir).unwrap();
		std::fs::write(nested_dir.join("payload.txt"), "payload").unwrap();

		crate::content::read_skill_directory_content(&skill_dir).unwrap();
		pack(&skill_dir, &skill_file).unwrap();
		let content = crate::content::read_skill_content(&skill_file).unwrap();

		assert!(content.resources.iter().any(|resource| {
			resource.path == format!("{}/payload.txt", nested.to_string_lossy())
		}));
	}

	#[test]
	fn archive_depth_limit_is_checked_during_preflight() {
		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("depth.skill");
		let nested = vec!["nested"; MAX_SKILL_CONTENT_DEPTH + 1].join("/");
		write_package(&skill_file, |archive| {
			archive
				.start_file(
					format!("{nested}/payload.txt"),
					SimpleFileOptions::default(),
				)
				.unwrap();
		});

		assert!(open_skill_archive(&skill_file)
			.unwrap_err()
			.to_string()
			.contains("level limit"));
	}

	#[test]
	fn package_content_and_unpack_skip_repository_metadata() {
		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("metadata.skill");
		let output_dir = temp_dir.path().join("unpacked");
		write_archive(
			&skill_file,
			&[
				("packed-skill/SKILL.md", TEST_SKILL_MD),
				("packed-skill/.GIT/config", "private"),
				("packed-skill/scripts/run.sh", "run"),
				("outside.txt", "outside"),
			],
		);

		let content = crate::content::read_skill_content(&skill_file).unwrap();
		unpack(&skill_file, &output_dir).unwrap();

		assert_eq!(content.resources.len(), 1);
		assert_eq!(content.resources[0].path, "scripts/run.sh");
		assert!(!output_dir.join("packed-skill/.GIT").exists());
		assert!(output_dir.join("outside.txt").exists());
	}

	#[test]
	fn unpack_preserves_compatible_existing_output() {
		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("existing.skill");
		let output_dir = temp_dir.path().join("unpacked");
		write_package(&skill_file, |archive| {
			archive
				.start_file(
					"packed-skill/scripts/run.sh",
					SimpleFileOptions::default(),
				)
				.unwrap();
			archive.write_all(b"run").unwrap();
		});
		std::fs::create_dir(&output_dir).unwrap();
		std::fs::write(output_dir.join("existing.txt"), "existing").unwrap();

		unpack(&skill_file, &output_dir).unwrap();

		assert_eq!(
			std::fs::read_to_string(output_dir.join("existing.txt")).unwrap(),
			"existing"
		);
		assert!(output_dir.join("packed-skill/SKILL.md").exists());
	}

	#[test]
	fn unpack_rejects_existing_file_ancestors_before_writing() {
		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("ancestor-output.skill");
		let output_dir = temp_dir.path().join("unpacked");
		write_package(&skill_file, |archive| {
			archive
				.start_file(
					"packed-skill/scripts/run.sh",
					SimpleFileOptions::default(),
				)
				.unwrap();
			archive.write_all(b"run").unwrap();
		});
		std::fs::create_dir_all(output_dir.join("packed-skill")).unwrap();
		std::fs::write(output_dir.join("packed-skill/scripts"), "conflict")
			.unwrap();

		assert!(unpack(&skill_file, &output_dir).is_err());
		assert!(!output_dir.join("packed-skill/SKILL.md").exists());
		assert_eq!(
			std::fs::read_to_string(output_dir.join("packed-skill/scripts"))
				.unwrap(),
			"conflict"
		);
	}

	#[test]
	fn unpack_skill_root_materializes_only_the_selected_skill() {
		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("selected.skill");
		let output_dir = temp_dir.path().join("unpacked");
		write_archive(
			&skill_file,
			&[
				("selected/SKILL.md", TEST_SKILL_MD),
				("selected/scripts/run.sh", "run"),
				("other/deeper/SKILL.md", "other"),
				("outside.txt", "outside"),
			],
		);

		let root = unpack_skill_root(&skill_file, &output_dir).unwrap();

		assert_eq!(root, output_dir.join("selected"));
		assert!(root.join("SKILL.md").exists());
		assert!(root.join("scripts/run.sh").exists());
		assert!(!output_dir.join("other").exists());
		assert!(!output_dir.join("outside.txt").exists());
	}

	#[cfg(unix)]
	#[test]
	fn unpack_rejects_a_symlinked_output_tree() {
		use std::os::unix::fs::symlink;

		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("symlink-output.skill");
		let output_dir = temp_dir.path().join("unpacked");
		let outside = temp_dir.path().join("outside");
		write_package(&skill_file, |archive| {
			archive
				.start_file(
					"packed-skill/scripts/run.sh",
					SimpleFileOptions::default(),
				)
				.unwrap();
			archive.write_all(b"run").unwrap();
		});
		std::fs::create_dir(&output_dir).unwrap();
		std::fs::create_dir(&outside).unwrap();
		symlink(&outside, output_dir.join("packed-skill")).unwrap();

		assert!(unpack(&skill_file, &output_dir).is_err());
		assert!(!outside.join("SKILL.md").exists());
		assert!(!outside.join("scripts/run.sh").exists());
	}

	#[cfg(unix)]
	#[test]
	fn unpack_rejects_an_existing_hard_link_target() {
		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("hard-link-output.skill");
		let output_dir = temp_dir.path().join("unpacked");
		let outside_file = temp_dir.path().join("outside.txt");
		write_package(&skill_file, |_| {});
		std::fs::write(&outside_file, "outside").unwrap();
		std::fs::create_dir_all(output_dir.join("packed-skill")).unwrap();
		std::fs::hard_link(
			&outside_file,
			output_dir.join("packed-skill/SKILL.md"),
		)
		.unwrap();

		assert!(unpack(&skill_file, &output_dir).is_err());
		assert_eq!(std::fs::read_to_string(&outside_file).unwrap(), "outside");
	}

	#[cfg(unix)]
	#[test]
	fn unpack_rejects_a_symlinked_output_ancestor() {
		use std::os::unix::fs::symlink;

		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("symlink-ancestor.skill");
		let outside = temp_dir.path().join("outside");
		let linked = temp_dir.path().join("linked");
		let output_dir = linked.join("unpacked");
		write_package(&skill_file, |_| {});
		std::fs::create_dir(&outside).unwrap();
		symlink(&outside, &linked).unwrap();

		assert!(unpack(&skill_file, &output_dir).is_err());
		assert!(!outside.join("unpacked").exists());
	}

	#[cfg(unix)]
	#[test]
	fn unpack_rejects_a_symlinked_output_ancestor_with_existing_descendant() {
		use std::os::unix::fs::symlink;

		let temp_dir = TempDir::new().unwrap();
		let skill_file = temp_dir.path().join("symlink-ancestor.skill");
		let outside = temp_dir.path().join("outside");
		let linked = temp_dir.path().join("linked");
		let output_dir = linked.join("existing/unpacked");
		write_package(&skill_file, |_| {});
		std::fs::create_dir_all(outside.join("existing")).unwrap();
		symlink(&outside, &linked).unwrap();

		assert!(unpack(&skill_file, &output_dir).is_err());
		assert!(!outside.join("existing/unpacked").exists());
	}

	#[cfg(unix)]
	#[test]
	fn unpack_writes_through_the_opened_output_directory() {
		use std::os::unix::fs::symlink;

		let temp_dir = TempDir::new().unwrap();
		let output_dir = temp_dir.path().join("unpacked");
		let moved_dir = temp_dir.path().join("moved");
		let outside = temp_dir.path().join("outside");
		std::fs::create_dir(&outside).unwrap();
		let resolved_output = resolve_output_ancestors(&output_dir).unwrap();
		let output = UnixUnpackDirectory::open(&resolved_output).unwrap();
		std::fs::rename(&output_dir, &moved_dir).unwrap();
		symlink(&outside, &output_dir).unwrap();

		output.write_file("SKILL.md", b"skill").unwrap();

		assert_eq!(
			std::fs::read_to_string(moved_dir.join("SKILL.md")).unwrap(),
			"skill"
		);
		assert!(!outside.join("SKILL.md").exists());
	}

	#[test]
	fn test_should_exclude() {
		let temp_dir = TempDir::new().unwrap();
		let root = temp_dir.path();

		// Test excluded files - create them first
		std::fs::write(root.join(".DS_Store"), "").unwrap();
		assert!(should_exclude(&root.join(".DS_Store"), root));

		std::fs::write(root.join("test.pyc"), "").unwrap();
		assert!(should_exclude(&root.join("test.pyc"), root));

		// Test excluded directories - create them
		std::fs::create_dir(root.join("__pycache__")).unwrap();
		assert!(should_exclude(&root.join("__pycache__"), root));

		std::fs::create_dir(root.join("node_modules")).unwrap();
		assert!(should_exclude(&root.join("node_modules"), root));

		std::fs::create_dir(root.join(".GIT")).unwrap();
		assert!(should_exclude(&root.join(".GIT"), root));

		std::fs::write(root.join(".Hg"), "metadata").unwrap();
		assert!(should_exclude(&root.join(".Hg"), root));

		// Test non-excluded - create them
		std::fs::write(root.join("SKILL.md"), "").unwrap();
		assert!(!should_exclude(&root.join("SKILL.md"), root));

		std::fs::write(root.join("script.sh"), "").unwrap();
		assert!(!should_exclude(&root.join("script.sh"), root));
	}
}
