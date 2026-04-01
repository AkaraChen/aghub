//! Package operations for .skill/.zip files.
//!
//! This module provides functionality to pack skill directories into .skill files
//! and unpack .skill files to directories.

use crate::error::{Result, SkillError};
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
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

/// Check if a file should be excluded based on name and location.
fn should_exclude(path: &Path, skill_root: &Path) -> bool {
	let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

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
	if path.is_dir() {
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

/// Get the relative path from the skill root for archive entry names.
fn get_archive_name(path: &Path, skill_root: &Path) -> Option<String> {
	path.strip_prefix(skill_root.parent().unwrap_or(skill_root))
		.ok()
		.map(|p| p.to_string_lossy().replace('\\', "/"))
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
	// Verify input directory exists
	if !skill_dir.exists() {
		return Err(SkillError::NotFound(format!(
			"Skill directory not found: {}",
			skill_dir.display()
		)));
	}

	if !skill_dir.is_dir() {
		return Err(SkillError::InvalidFormat(format!(
			"Not a directory: {}",
			skill_dir.display()
		)));
	}

	// Verify SKILL.md exists
	let skill_md = skill_dir.join("SKILL.md");
	if !skill_md.exists() {
		return Err(SkillError::MissingSkillMd {
			path: skill_dir.to_path_buf(),
		});
	}

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

	// Walk the directory and add files to zip
	for entry in WalkDir::new(skill_dir)
		.follow_links(false)
		.into_iter()
		.filter_map(|e| e.ok())
	{
		let path = entry.path();

		// Skip the root directory itself
		if path == skill_dir {
			continue;
		}

		// Skip excluded files/directories
		if should_exclude(path, skill_dir) {
			continue;
		}

		let name = match get_archive_name(path, skill_dir) {
			Some(n) => n,
			None => continue,
		};

		if path.is_file() {
			zip.start_file(name, options)?;
			let mut f = File::open(path)?;
			let mut buffer = Vec::new();
			f.read_to_end(&mut buffer)?;
			zip.write_all(&buffer)?;
		} else if path.is_dir() {
			// Add directory entry
			let dir_name = if name.ends_with('/') {
				name
			} else {
				format!("{name}/")
			};
			zip.add_directory(dir_name, options)?;
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
	if !skill_file.exists() {
		return Err(SkillError::NotFound(format!(
			"Skill file not found: {}",
			skill_file.display()
		)));
	}

	// Create output directory
	std::fs::create_dir_all(output_dir)?;

	// Open zip file
	let file = File::open(skill_file)?;
	let mut archive = ZipArchive::new(file)?;

	// Extract all files
	for i in 0..archive.len() {
		let mut file = archive.by_index(i)?;
		let outpath = output_dir.join(file.mangled_name());

		if file.name().ends_with('/') {
			std::fs::create_dir_all(&outpath)?;
		} else {
			if let Some(p) = outpath.parent() {
				if !p.exists() {
					std::fs::create_dir_all(p)?;
				}
			}
			let mut outfile = File::create(&outpath)?;
			std::io::copy(&mut file, &mut outfile)?;
		}
	}

	Ok(())
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
	if !skill_file.exists() {
		return Err(SkillError::NotFound(format!(
			"Skill file not found: {}",
			skill_file.display()
		)));
	}

	let file = File::open(skill_file)?;
	let mut archive = ZipArchive::new(file)?;

	for i in 0..archive.len() {
		let mut file = archive.by_index(i)?;
		let name = file.name().to_string();
		if name.ends_with("SKILL.md") || name.ends_with("skill.md") {
			let mut content = String::new();
			file.read_to_string(&mut content)?;
			return Ok(content);
		}
	}

	Err(SkillError::MissingSkillMd {
		path: skill_file.to_path_buf(),
	})
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::path::PathBuf;
	use tempfile::TempDir;

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

		// Test non-excluded - create them
		std::fs::write(root.join("SKILL.md"), "").unwrap();
		assert!(!should_exclude(&root.join("SKILL.md"), root));

		std::fs::write(root.join("script.sh"), "").unwrap();
		assert!(!should_exclude(&root.join("script.sh"), root));
	}
}
