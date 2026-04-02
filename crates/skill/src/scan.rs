//! Skill discovery and scanning operations.
//!
//! This module provides functionality to scan directories for skills containing
//! SKILL.md files, with gitignore support, priority directory scanning, and
//! name-based deduplication.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use thiserror::Error;

/// Options for skill scanning
#[derive(Debug, Clone)]
pub struct ScanOptions {
	/// Maximum depth for recursive search (default: 5)
	pub max_depth: usize,

	/// Search all subdirectories even when skills found in priority dirs
	pub full_depth: bool,

	/// Use gitignore filtering (default: true)
	pub respect_gitignore: bool,
}

impl Default for ScanOptions {
	fn default() -> Self {
		Self {
			max_depth: 5,
			full_depth: false,
			respect_gitignore: true,
		}
	}
}

/// Errors that can occur during skill scanning
#[derive(Debug, Error)]
pub enum ScanError {
	#[error("Path not found: {0}")]
	PathNotFound(PathBuf),

	#[error("Permission denied: {0}")]
	PermissionDenied(PathBuf),
}

/// Scan for skill directories containing SKILL.md files.
///
/// # Arguments
/// * `base_path` - Base path to search for skills
/// * `options` - Scan options controlling behavior
/// * `priority_dirs` - Priority directories to scan first (e.g., agent-specific skill dirs)
///
/// # Returns
/// * `Ok(Vec<PathBuf>)` - Paths to directories containing SKILL.md (deduplicated by skill name)
/// * `Err(ScanError)` - If scanning fails due to path not found or permission denied
///
/// # Algorithm
/// 1. Check if base_path itself contains SKILL.md (return early unless full_depth)
/// 2. Scan priority directories first (agent-specific + common paths)
/// 3. If no skills found or full_depth=true, fall back to recursive search
/// 4. Deduplicate by skill name (parsed from frontmatter)
/// 5. Skip invalid/unparseable skills silently
pub fn scan_skills(
	base_path: &Path,
	options: ScanOptions,
	priority_dirs: Vec<PathBuf>,
) -> Result<Vec<PathBuf>, ScanError> {
	if !base_path.exists() {
		return Err(ScanError::PathNotFound(base_path.to_path_buf()));
	}

	let mut skill_dirs = Vec::new();
	let mut seen_names = HashSet::new();

	// 1. Check if base_path itself is a skill
	if has_skill_md(base_path) {
		if let Some(name) = extract_skill_name(base_path) {
			skill_dirs.push(base_path.to_path_buf());
			seen_names.insert(name);

			// Return early if not full_depth
			if !options.full_depth {
				return Ok(skill_dirs);
			}
		}
	}

	// 2. Scan priority directories
	for dir in priority_dirs {
		if dir.exists() && dir.is_dir() {
			scan_priority_dir(&dir, &mut skill_dirs, &mut seen_names)?;
		}
	}

	// 3. Fallback to recursive search if nothing found or full_depth requested
	if skill_dirs.is_empty() || options.full_depth {
		let recursive_dirs = if options.respect_gitignore {
			scan_with_gitignore(base_path, options.max_depth)
		} else {
			scan_recursive_basic(base_path, options.max_depth)
		};

		for dir in recursive_dirs {
			if let Some(name) = extract_skill_name(&dir) {
				if !seen_names.contains(&name) {
					seen_names.insert(name);
					skill_dirs.push(dir);
				}
			}
		}
	}

	Ok(skill_dirs)
}

/// Check if a directory contains a SKILL.md file.
fn has_skill_md(dir: &Path) -> bool {
	skills_ref::parser::find_skill_md(dir).is_some()
}

/// Extract skill name from SKILL.md frontmatter for deduplication.
///
/// Returns None if:
/// - SKILL.md not found
/// - File cannot be read
/// - Frontmatter cannot be parsed
/// - Name field is missing or not a string
fn extract_skill_name(dir: &Path) -> Option<String> {
	let skill_md = skills_ref::parser::find_skill_md(dir)?;

	let content = std::fs::read_to_string(&skill_md).ok()?;

	let (metadata, _) = skills_ref::parser::parse_frontmatter(&content).ok()?;

	metadata
		.get("name")
		.and_then(|v| v.as_str())
		.map(String::from)
}

/// Scan a single priority directory for skills.
///
/// Lists subdirectories and checks each for SKILL.md presence.
/// Deduplicates by skill name using the provided HashSet.
fn scan_priority_dir(
	dir: &Path,
	skill_dirs: &mut Vec<PathBuf>,
	seen_names: &mut HashSet<String>,
) -> Result<(), ScanError> {
	let entries = std::fs::read_dir(dir).map_err(|e| {
		if e.kind() == std::io::ErrorKind::PermissionDenied {
			ScanError::PermissionDenied(dir.to_path_buf())
		} else {
			ScanError::PathNotFound(dir.to_path_buf())
		}
	})?;

	for entry in entries {
		let entry = entry.map_err(|e| {
			if e.kind() == std::io::ErrorKind::PermissionDenied {
				ScanError::PermissionDenied(dir.to_path_buf())
			} else {
				ScanError::PathNotFound(dir.to_path_buf())
			}
		})?;

		let path = entry.path();

		if path.is_dir() && has_skill_md(&path) {
			if let Some(name) = extract_skill_name(&path) {
				if !seen_names.contains(&name) {
					seen_names.insert(name);
					skill_dirs.push(path);
				}
			}
		}
	}

	Ok(())
}

/// Recursive directory scan with gitignore filtering.
///
/// Uses the `ignore` crate (ripgrep's gitignore library) to properly
/// respect .gitignore patterns, nested gitignore files, and global excludes.
fn scan_with_gitignore(base_path: &Path, max_depth: usize) -> Vec<PathBuf> {
	use ignore::WalkBuilder;

	let mut skill_dirs = Vec::new();

	let walker = WalkBuilder::new(base_path)
		.max_depth(Some(max_depth))
		.follow_links(false)
		.hidden(false) // Don't skip hidden dirs like .claude/skills
		.git_ignore(true) // Respect .gitignore files
		.git_global(true) // Respect global gitignore
		.git_exclude(true) // Respect .git/info/exclude
		.build();

	for entry in walker.flatten() {
		let path = entry.path();
		if path.is_dir() && has_skill_md(path) {
			skill_dirs.push(path.to_path_buf());
		}
	}

	skill_dirs
}

/// Basic recursive directory scan without gitignore filtering.
///
/// Used when gitignore filtering is disabled.
fn scan_recursive_basic(base_path: &Path, max_depth: usize) -> Vec<PathBuf> {
	use walkdir::WalkDir;

	let mut skill_dirs = Vec::new();

	for entry in WalkDir::new(base_path)
		.max_depth(max_depth)
		.into_iter()
		.filter_entry(|e| e.depth() <= max_depth)
		.flatten()
	{
		let path = entry.path();
		if path.is_dir() && has_skill_md(path) {
			skill_dirs.push(path.to_path_buf());
		}
	}

	skill_dirs
}

#[cfg(test)]
mod tests {
	use super::*;
	use tempfile::TempDir;

	fn create_test_skill(dir: &Path, name: &str) -> PathBuf {
		let skill_dir = dir.join(name);
		std::fs::create_dir_all(&skill_dir).unwrap();
		std::fs::write(
			skill_dir.join("SKILL.md"),
			format!(
				"---\nname: {}\ndescription: Test skill\n---\n# Instructions",
				name
			),
		)
		.unwrap();
		skill_dir
	}

	#[test]
	fn test_respect_gitignore_false() {
		let temp = TempDir::new().unwrap();

		std::process::Command::new("git")
			.arg("init")
			.current_dir(temp.path())
			.output()
			.expect("git init failed");

		std::fs::create_dir_all(temp.path().join("node_modules/skill1"))
			.unwrap();
		std::fs::write(
            temp.path().join("node_modules/skill1/SKILL.md"),
            "---\nname: normally-ignored-skill\ndescription: Should NOT be ignored\n---\n# Instructions",
        )
        .unwrap();

		std::fs::write(temp.path().join(".gitignore"), "node_modules/")
			.unwrap();

		let result = scan_skills(
			temp.path(),
			ScanOptions {
				respect_gitignore: false,
				full_depth: true,
				..Default::default()
			},
			vec![],
		)
		.unwrap();

		assert_eq!(result.len(), 1);
		assert!(result[0].ends_with("skill1"));
		let name = extract_skill_name(&result[0]);
		assert_eq!(name, Some("normally-ignored-skill".to_string()));
	}

	#[test]
	fn test_extract_skill_name() {
		let temp = TempDir::new().unwrap();
		let skill_dir = create_test_skill(temp.path(), "my-skill");

		let name = extract_skill_name(&skill_dir);
		assert_eq!(name, Some("my-skill".to_string()));
	}

	#[test]
	fn test_extract_skill_name_invalid() {
		let temp = TempDir::new().unwrap();
		let skill_dir = temp.path().join("invalid-skill");
		std::fs::create_dir_all(&skill_dir).unwrap();
		std::fs::write(skill_dir.join("SKILL.md"), "No frontmatter here")
			.unwrap();

		let name = extract_skill_name(&skill_dir);
		assert_eq!(name, None);
	}

	#[test]
	fn test_scan_base_path_is_skill() {
		let temp = TempDir::new().unwrap();
		// Create SKILL.md directly in the base path (not in a subdirectory)
		std::fs::write(
            temp.path().join("SKILL.md"),
            "---\nname: root-skill\ndescription: Test skill\n---\n# Instructions",
        )
        .unwrap();

		let result =
			scan_skills(temp.path(), ScanOptions::default(), vec![]).unwrap();

		assert_eq!(result.len(), 1);
		assert_eq!(result[0], temp.path());
	}

	#[test]
	fn test_scan_priority_first() {
		let temp = TempDir::new().unwrap();
		let base = temp.path();

		// Create skill in priority dir
		let priority_dir = base.join("skills");
		std::fs::create_dir_all(&priority_dir).unwrap();
		create_test_skill(&priority_dir, "priority-skill");

		// Create skill in non-priority location
		std::fs::create_dir_all(base.join("some/deep/path")).unwrap();
		create_test_skill(&base.join("some/deep/path"), "deep-skill");

		let result = scan_skills(
			base,
			ScanOptions::default(),
			vec![priority_dir.clone()],
		)
		.unwrap();

		// Should find priority-skill only (not deep-skill) unless full_depth
		assert_eq!(result.len(), 1);
		assert!(result[0].ends_with("priority-skill"));
	}

	#[test]
	fn test_scan_full_depth() {
		let temp = TempDir::new().unwrap();
		let base = temp.path();

		// Create skill in priority dir
		let priority_dir = base.join("skills");
		std::fs::create_dir_all(&priority_dir).unwrap();
		create_test_skill(&priority_dir, "priority-skill");

		// Create skill in non-priority location
		std::fs::create_dir_all(base.join("some/deep/path")).unwrap();
		create_test_skill(&base.join("some/deep/path"), "deep-skill");

		let result = scan_skills(
			base,
			ScanOptions {
				full_depth: true,
				..Default::default()
			},
			vec![priority_dir.clone()],
		)
		.unwrap();

		// Should find both skills with full_depth
		assert_eq!(result.len(), 2);
	}

	#[test]
	fn test_deduplication_by_name() {
		let temp = TempDir::new().unwrap();

		// Create two skills with same name in different locations
		std::fs::create_dir_all(temp.path().join("location1")).unwrap();
		create_test_skill(&temp.path().join("location1"), "same-name");

		std::fs::create_dir_all(temp.path().join("location2")).unwrap();
		create_test_skill(&temp.path().join("location2"), "same-name");

		let result = scan_skills(
			temp.path(),
			ScanOptions {
				full_depth: true,
				..Default::default()
			},
			vec![],
		)
		.unwrap();

		// Should deduplicate - only one skill returned
		assert_eq!(result.len(), 1);
	}

	#[test]
	fn test_gitignore_filtering() {
		let temp = TempDir::new().unwrap();

		// Initialize a git repository so .gitignore is respected
		std::process::Command::new("git")
			.arg("init")
			.current_dir(temp.path())
			.output()
			.expect("git init failed");

		// Create skill that should be ignored
		std::fs::create_dir_all(temp.path().join("node_modules/skill1"))
			.unwrap();
		std::fs::write(
			temp.path().join("node_modules/skill1/SKILL.md"),
			"---\nname: ignored-skill\ndescription: Should be ignored\n---",
		)
		.unwrap();

		// Create .gitignore
		std::fs::write(temp.path().join(".gitignore"), "node_modules/")
			.unwrap();

		// Create a valid skill outside ignored dir
		create_test_skill(temp.path(), "valid-skill");

		let result = scan_skills(
			temp.path(),
			ScanOptions {
				respect_gitignore: true,
				full_depth: true,
				..Default::default()
			},
			vec![],
		)
		.unwrap();

		// Should find valid-skill, not ignored-skill
		assert_eq!(result.len(), 1);
		assert!(result[0].ends_with("valid-skill"));
	}

	#[test]
	fn test_max_depth_limit() {
		let temp = TempDir::new().unwrap();

		// Create skill beyond max_depth
		std::fs::create_dir_all(temp.path().join("a/b/c/d/e/f")).unwrap();
		create_test_skill(&temp.path().join("a/b/c/d/e/f"), "deep-skill");

		let result = scan_skills(
			temp.path(),
			ScanOptions {
				max_depth: 3,
				full_depth: true,
				..Default::default()
			},
			vec![],
		)
		.unwrap();

		// Should not find skill beyond depth 3
		assert!(result.is_empty());
	}

	#[test]
	fn test_scan_error_path_not_found() {
		let non_existent = PathBuf::from("/non/existent/path/12345");

		let result = scan_skills(&non_existent, ScanOptions::default(), vec![]);

		assert!(matches!(result, Err(ScanError::PathNotFound(_))));
	}

	#[test]
	fn test_extract_skill_name_missing_name_field() {
		let temp = TempDir::new().unwrap();
		let skill_dir = temp.path().join("no-name-skill");
		std::fs::create_dir_all(&skill_dir).unwrap();
		std::fs::write(
			skill_dir.join("SKILL.md"),
			"---\ndescription: Missing name field\n---\n# Instructions",
		)
		.unwrap();

		let name = extract_skill_name(&skill_dir);
		assert_eq!(name, None);
	}

	#[test]
	fn test_extract_skill_name_non_string_name() {
		let temp = TempDir::new().unwrap();
		let skill_dir = temp.path().join("non-string-name-skill");
		std::fs::create_dir_all(&skill_dir).unwrap();
		std::fs::write(
			skill_dir.join("SKILL.md"),
			"---\nname: 123\ndescription: Non-string name\n---\n# Instructions",
		)
		.unwrap();

		let name = extract_skill_name(&skill_dir);
		assert_eq!(name, None);
	}

	#[test]
	fn test_extract_skill_name_missing_skill_md() {
		let temp = TempDir::new().unwrap();
		let skill_dir = temp.path().join("empty-skill");
		std::fs::create_dir_all(&skill_dir).unwrap();

		let name = extract_skill_name(&skill_dir);
		assert_eq!(name, None);
	}

	#[test]
	fn test_empty_directory() {
		let temp = TempDir::new().unwrap();

		let result =
			scan_skills(temp.path(), ScanOptions::default(), vec![]).unwrap();

		assert!(result.is_empty());
	}

	#[test]
	fn test_multiple_priority_directories() {
		let temp = TempDir::new().unwrap();
		let base = temp.path();

		let priority_dir1 = base.join("skills1");
		let priority_dir2 = base.join("skills2");
		std::fs::create_dir_all(&priority_dir1).unwrap();
		std::fs::create_dir_all(&priority_dir2).unwrap();

		create_test_skill(&priority_dir1, "skill-from-dir1");
		create_test_skill(&priority_dir2, "skill-from-dir2");

		let result = scan_skills(
			base,
			ScanOptions::default(),
			vec![priority_dir1, priority_dir2],
		)
		.unwrap();

		assert_eq!(result.len(), 2);
	}

	#[test]
	fn test_priority_directory_not_exists() {
		let temp = TempDir::new().unwrap();

		let non_existent_priority = temp.path().join("does-not-exist");
		let result = scan_skills(
			temp.path(),
			ScanOptions::default(),
			vec![non_existent_priority],
		)
		.unwrap();

		assert!(result.is_empty());
	}

	#[test]
	fn test_priority_path_is_file() {
		let temp = TempDir::new().unwrap();
		let base = temp.path();

		let file_path = base.join("not-a-dir");
		std::fs::write(&file_path, "I am a file, not a directory").unwrap();

		let result =
			scan_skills(base, ScanOptions::default(), vec![file_path]).unwrap();

		assert!(result.is_empty());
	}

	#[test]
	fn test_deduplication_priority_vs_recursive() {
		let temp = TempDir::new().unwrap();
		let base = temp.path();

		let priority_dir = base.join("skills");
		std::fs::create_dir_all(&priority_dir).unwrap();
		create_test_skill(&priority_dir, "duplicate-name");

		std::fs::create_dir_all(base.join("other/location")).unwrap();
		create_test_skill(&base.join("other/location"), "duplicate-name");

		let result = scan_skills(
			base,
			ScanOptions {
				full_depth: true,
				..Default::default()
			},
			vec![priority_dir],
		)
		.unwrap();

		assert_eq!(result.len(), 1);
	}

	#[test]
	fn test_max_depth_zero() {
		let temp = TempDir::new().unwrap();

		std::fs::create_dir_all(temp.path().join("subdir")).unwrap();
		create_test_skill(&temp.path().join("subdir"), "nested-skill");

		let result = scan_skills(
			temp.path(),
			ScanOptions {
				max_depth: 0,
				full_depth: true,
				..Default::default()
			},
			vec![],
		)
		.unwrap();

		assert!(result.is_empty());
	}

	#[test]
	fn test_max_depth_one() {
		let temp = TempDir::new().unwrap();

		create_test_skill(temp.path(), "shallow-skill");

		std::fs::create_dir_all(temp.path().join("subdir")).unwrap();
		create_test_skill(&temp.path().join("subdir"), "nested-skill");

		let result = scan_skills(
			temp.path(),
			ScanOptions {
				max_depth: 1,
				full_depth: true,
				..Default::default()
			},
			vec![],
		)
		.unwrap();

		assert_eq!(result.len(), 1);
		assert!(result[0].ends_with("shallow-skill"));
	}

	#[test]
	fn test_skill_with_special_characters_in_name() {
		let temp = TempDir::new().unwrap();

		let skill_dir = temp.path().join("special-skill");
		std::fs::create_dir_all(&skill_dir).unwrap();
		std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: skill-with-hyphens-and_underscores\ndescription: Special chars\n---\n# Instructions",
        )
        .unwrap();

		let result = scan_skills(
			temp.path(),
			ScanOptions {
				full_depth: true,
				..Default::default()
			},
			vec![],
		)
		.unwrap();

		assert_eq!(result.len(), 1);
		let name = extract_skill_name(&result[0]);
		assert_eq!(
			name,
			Some("skill-with-hyphens-and_underscores".to_string())
		);
	}

	#[test]
	fn test_nested_skill_directories() {
		let temp = TempDir::new().unwrap();

		create_test_skill(temp.path(), "root-level-skill");
		std::fs::create_dir_all(temp.path().join("nested/deep/path")).unwrap();
		create_test_skill(
			&temp.path().join("nested/deep/path"),
			"deeply-nested-skill",
		);

		let result = scan_skills(
			temp.path(),
			ScanOptions {
				full_depth: true,
				max_depth: 10,
				..Default::default()
			},
			vec![],
		)
		.unwrap();

		assert_eq!(result.len(), 2);
	}

	#[test]
	fn test_empty_skill_name_in_frontmatter() {
		let temp = TempDir::new().unwrap();
		let skill_dir = temp.path().join("empty-name-skill");
		std::fs::create_dir_all(&skill_dir).unwrap();
		std::fs::write(
			skill_dir.join("SKILL.md"),
			"---\nname: ''\ndescription: Empty name\n---\n# Instructions",
		)
		.unwrap();

		let name = extract_skill_name(&skill_dir);
		assert_eq!(name, Some("".to_string()));
	}

	#[test]
	fn test_skill_name_with_unicode() {
		let temp = TempDir::new().unwrap();

		let skill_dir = temp.path().join("unicode-skill");
		std::fs::create_dir_all(&skill_dir).unwrap();
		std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: 中文技能-ñ-emoji\ndescription: Unicode name\n---\n# Instructions",
        )
        .unwrap();

		let result = scan_skills(
			temp.path(),
			ScanOptions {
				full_depth: true,
				..Default::default()
			},
			vec![],
		)
		.unwrap();

		assert_eq!(result.len(), 1);
		let name = extract_skill_name(&result[0]);
		assert_eq!(name, Some("中文技能-ñ-emoji".to_string()));
	}

	#[test]
	fn test_multiple_skills_in_priority_dir() {
		let temp = TempDir::new().unwrap();
		let base = temp.path();

		let priority_dir = base.join("skills");
		std::fs::create_dir_all(&priority_dir).unwrap();

		create_test_skill(&priority_dir, "skill-one");
		create_test_skill(&priority_dir, "skill-two");
		create_test_skill(&priority_dir, "skill-three");

		let result =
			scan_skills(base, ScanOptions::default(), vec![priority_dir])
				.unwrap();

		assert_eq!(result.len(), 3);
	}

	#[test]
	fn test_base_path_is_skill_with_full_depth() {
		let temp = TempDir::new().unwrap();

		std::fs::write(
            temp.path().join("SKILL.md"),
            "---\nname: root-skill\ndescription: Test skill\n---\n# Instructions",
        )
        .unwrap();

		std::fs::create_dir_all(temp.path().join("nested")).unwrap();
		create_test_skill(&temp.path().join("nested"), "nested-skill");

		let result = scan_skills(
			temp.path(),
			ScanOptions {
				full_depth: true,
				..Default::default()
			},
			vec![],
		)
		.unwrap();

		assert_eq!(result.len(), 2);
	}

	#[test]
	fn test_default_scan_options() {
		let options = ScanOptions::default();

		assert_eq!(options.max_depth, 5);
		assert!(!options.full_depth);
		assert!(options.respect_gitignore);
	}

	#[test]
	fn test_scan_options_clone() {
		let options = ScanOptions {
			max_depth: 10,
			full_depth: true,
			respect_gitignore: false,
		};
		let cloned = options.clone();

		assert_eq!(cloned.max_depth, 10);
		assert!(cloned.full_depth);
		assert!(!cloned.respect_gitignore);
	}

	#[test]
	fn test_scan_error_display() {
		let path = PathBuf::from("/some/path");
		let error1 = ScanError::PathNotFound(path.clone());
		let error2 = ScanError::PermissionDenied(path);

		assert!(format!("{}", error1).contains("/some/path"));
		assert!(format!("{}", error2).contains("/some/path"));
	}

	#[test]
	fn test_skill_found_in_priority_not_in_base_recursive() {
		let temp = TempDir::new().unwrap();
		let base = temp.path();

		let priority_dir = base.join("priority");
		std::fs::create_dir_all(&priority_dir).unwrap();
		create_test_skill(&priority_dir, "priority-only-skill");

		let result =
			scan_skills(base, ScanOptions::default(), vec![priority_dir])
				.unwrap();

		assert_eq!(result.len(), 1);
		assert!(result[0].ends_with("priority-only-skill"));
	}
}
