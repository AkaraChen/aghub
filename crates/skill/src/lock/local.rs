use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const LOCAL_LOCK_FILE: &str = "skills-lock.json";
const CURRENT_VERSION: u32 = 1;

/// Represents a single skill entry in the local (project) lock file.
///
/// Intentionally minimal and timestamp-free to minimize merge conflicts.
/// Two branches adding different skills produce non-overlapping JSON keys
/// that git can auto-merge cleanly.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LocalSkillLockEntry {
	/// Where the skill came from: npm package name, owner/repo, local path, etc.
	pub source: String,
	/// The provider/source type (e.g., "github", "node_modules", "local")
	#[serde(rename = "sourceType")]
	pub source_type: String,
	/// SHA-256 hash computed from all files in the skill folder.
	/// Unlike the global lock which uses GitHub tree SHA, the local lock
	/// computes the hash from actual file contents on disk.
	#[serde(rename = "computedHash")]
	pub computed_hash: String,
}

/// The structure of the local (project-scoped) skill lock file.
/// This file is meant to be checked into version control.
///
/// Skills are sorted alphabetically by name when written to produce
/// deterministic output and minimize merge conflicts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalSkillLockFile {
	/// Schema version for future migrations
	pub version: u32,
	/// Map of skill name to its lock entry (sorted alphabetically)
	pub skills: BTreeMap<String, LocalSkillLockEntry>,
}

impl Default for LocalSkillLockFile {
	fn default() -> Self {
		Self {
			version: CURRENT_VERSION,
			skills: BTreeMap::new(),
		}
	}
}

impl LocalSkillLockFile {
	/// Create a new empty lock file.
	pub fn new() -> Self {
		Self::default()
	}
}

/// Get the path to the local skill lock file for a project.
pub fn get_local_lock_path(cwd: Option<&Path>) -> PathBuf {
	let dir = cwd
		.map(|p| p.to_path_buf())
		.or_else(|| std::env::current_dir().ok())
		.unwrap_or_else(|| PathBuf::from("."));
	dir.join(LOCAL_LOCK_FILE)
}

/// Read the local skill lock file.
/// Returns an empty lock file structure if the file doesn't exist
/// or is corrupted (e.g., merge conflict markers).
pub fn read_local_lock(cwd: Option<&Path>) -> LocalSkillLockFile {
	let lock_path = get_local_lock_path(cwd);

	match std::fs::read_to_string(&lock_path) {
		Ok(content) => {
			// Try to parse, return empty on any error
			match serde_json::from_str::<LocalSkillLockFile>(&content) {
				Ok(lock) => {
					// Check version
					if lock.version < CURRENT_VERSION {
						LocalSkillLockFile::new()
					} else {
						lock
					}
				}
				Err(_) => {
					// Corrupted JSON (merge conflict markers, etc.)
					LocalSkillLockFile::new()
				}
			}
		}
		Err(_) => {
			// File doesn't exist
			LocalSkillLockFile::new()
		}
	}
}

/// Write the local skill lock file.
/// Skills are sorted alphabetically by name for deterministic output.
pub fn write_local_lock(
	lock: &LocalSkillLockFile,
	cwd: Option<&Path>,
) -> std::io::Result<()> {
	let lock_path = get_local_lock_path(cwd);

	// BTreeMap is already sorted by key
	let content = serde_json::to_string_pretty(lock)? + "\n";
	std::fs::write(lock_path, content)
}

/// Add or update a skill entry in the local lock file.
pub fn add_skill_to_local_lock(
	skill_name: &str,
	entry: LocalSkillLockEntry,
	cwd: Option<&Path>,
) -> std::io::Result<()> {
	let mut lock = read_local_lock(cwd);
	lock.skills.insert(skill_name.to_string(), entry);
	write_local_lock(&lock, cwd)
}

/// Remove a skill from the local lock file.
/// Returns true if the skill was removed, false if it didn't exist.
pub fn remove_skill_from_local_lock(
	skill_name: &str,
	cwd: Option<&Path>,
) -> std::io::Result<bool> {
	let mut lock = read_local_lock(cwd);

	if lock.skills.remove(skill_name).is_some() {
		write_local_lock(&lock, cwd)?;
		Ok(true)
	} else {
		Ok(false)
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::fs;
	use tempfile::TempDir;

	#[test]
	fn test_get_local_lock_path_with_cwd() {
		let result = get_local_lock_path(Some(Path::new("/some/project")));
		assert_eq!(result, PathBuf::from("/some/project/skills-lock.json"));
	}

	#[test]
	fn test_get_local_lock_path_without_cwd() {
		let result = get_local_lock_path(None);
		assert!(result.ends_with("skills-lock.json"));
	}

	#[test]
	fn test_read_local_lock_missing_file() {
		let dir = TempDir::new().unwrap();
		let lock = read_local_lock(Some(dir.path()));
		assert_eq!(lock.version, 1);
		assert!(lock.skills.is_empty());
	}

	#[test]
	fn test_read_local_lock_valid_file() {
		let dir = TempDir::new().unwrap();
		let content = r#"{
  "version": 1,
  "skills": {
    "my-skill": {
      "source": "vercel-labs/skills",
      "sourceType": "github",
      "computedHash": "abc123"
    }
  }
}"#;
		fs::write(dir.path().join("skills-lock.json"), content).unwrap();

		let lock = read_local_lock(Some(dir.path()));
		assert_eq!(lock.version, 1);
		assert!(lock.skills.contains_key("my-skill"));
		let entry = lock.skills.get("my-skill").unwrap();
		assert_eq!(entry.source, "vercel-labs/skills");
		assert_eq!(entry.source_type, "github");
		assert_eq!(entry.computed_hash, "abc123");
	}

	#[test]
	fn test_read_local_lock_corrupted_json_merge_conflict() {
		let dir = TempDir::new().unwrap();
		let conflicted = [
			r#"{"#,
			r#"  "version": 1,"#,
			r#"  "skills": {"#,
			"<<<<<<< HEAD",
			r#"    "skill-a": { "source": "org/repo-a", "sourceType": "github", "computedHash": "aaa" }"#,
			"=======",
			r#"    "skill-b": { "source": "org/repo-b", "sourceType": "github", "computedHash": "bbb" }"#,
			">>>>>>> feature-branch",
			r#"  }"#,
			r#"}"#,
		]
		.join("\n");
		fs::write(dir.path().join("skills-lock.json"), conflicted).unwrap();

		let lock = read_local_lock(Some(dir.path()));
		assert_eq!(lock.version, 1);
		assert!(lock.skills.is_empty());
	}

	#[test]
	fn test_read_local_lock_invalid_structure() {
		let dir = TempDir::new().unwrap();
		fs::write(dir.path().join("skills-lock.json"), r#"{"version": 1}"#)
			.unwrap();

		let lock = read_local_lock(Some(dir.path()));
		assert_eq!(lock.version, 1);
		assert!(lock.skills.is_empty());
	}

	#[test]
	fn test_write_local_lock_sorted_with_newline() {
		let dir = TempDir::new().unwrap();
		let mut lock = LocalSkillLockFile::new();
		lock.skills.insert(
			"zebra-skill".to_string(),
			LocalSkillLockEntry {
				source: "org/z".to_string(),
				source_type: "github".to_string(),
				computed_hash: "zzz".to_string(),
			},
		);
		lock.skills.insert(
			"alpha-skill".to_string(),
			LocalSkillLockEntry {
				source: "org/a".to_string(),
				source_type: "github".to_string(),
				computed_hash: "aaa".to_string(),
			},
		);
		lock.skills.insert(
			"middle-skill".to_string(),
			LocalSkillLockEntry {
				source: "org/m".to_string(),
				source_type: "github".to_string(),
				computed_hash: "mmm".to_string(),
			},
		);

		write_local_lock(&lock, Some(dir.path())).unwrap();

		let raw =
			fs::read_to_string(dir.path().join("skills-lock.json")).unwrap();
		assert!(raw.ends_with('\n'));

		let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
		let keys: Vec<_> =
			parsed["skills"].as_object().unwrap().keys().collect();
		assert_eq!(keys, vec!["alpha-skill", "middle-skill", "zebra-skill"]);
	}

	#[test]
	fn test_add_skill_to_local_lock_new() {
		let dir = TempDir::new().unwrap();
		add_skill_to_local_lock(
			"new-skill",
			LocalSkillLockEntry {
				source: "org/repo".to_string(),
				source_type: "github".to_string(),
				computed_hash: "hash123".to_string(),
			},
			Some(dir.path()),
		)
		.unwrap();

		let lock = read_local_lock(Some(dir.path()));
		assert!(lock.skills.contains_key("new-skill"));
		let entry = lock.skills.get("new-skill").unwrap();
		assert_eq!(entry.computed_hash, "hash123");
	}

	#[test]
	fn test_add_skill_to_local_lock_update_hash() {
		let dir = TempDir::new().unwrap();
		add_skill_to_local_lock(
			"my-skill",
			LocalSkillLockEntry {
				source: "org/repo".to_string(),
				source_type: "github".to_string(),
				computed_hash: "old-hash".to_string(),
			},
			Some(dir.path()),
		)
		.unwrap();

		add_skill_to_local_lock(
			"my-skill",
			LocalSkillLockEntry {
				source: "org/repo".to_string(),
				source_type: "github".to_string(),
				computed_hash: "new-hash".to_string(),
			},
			Some(dir.path()),
		)
		.unwrap();

		let lock = read_local_lock(Some(dir.path()));
		assert_eq!(
			lock.skills.get("my-skill").unwrap().computed_hash,
			"new-hash"
		);
	}

	#[test]
	fn test_add_skill_to_local_lock_preserves_others() {
		let dir = TempDir::new().unwrap();
		add_skill_to_local_lock(
			"skill-a",
			LocalSkillLockEntry {
				source: "org/a".to_string(),
				source_type: "github".to_string(),
				computed_hash: "aaa".to_string(),
			},
			Some(dir.path()),
		)
		.unwrap();

		add_skill_to_local_lock(
			"skill-b",
			LocalSkillLockEntry {
				source: "org/b".to_string(),
				source_type: "github".to_string(),
				computed_hash: "bbb".to_string(),
			},
			Some(dir.path()),
		)
		.unwrap();

		let lock = read_local_lock(Some(dir.path()));
		assert_eq!(lock.skills.len(), 2);
		assert_eq!(lock.skills.get("skill-a").unwrap().computed_hash, "aaa");
		assert_eq!(lock.skills.get("skill-b").unwrap().computed_hash, "bbb");
	}

	#[test]
	fn test_remove_skill_from_local_lock_existing() {
		let dir = TempDir::new().unwrap();
		add_skill_to_local_lock(
			"my-skill",
			LocalSkillLockEntry {
				source: "org/repo".to_string(),
				source_type: "github".to_string(),
				computed_hash: "hash".to_string(),
			},
			Some(dir.path()),
		)
		.unwrap();

		let removed =
			remove_skill_from_local_lock("my-skill", Some(dir.path())).unwrap();
		assert!(removed);

		let lock = read_local_lock(Some(dir.path()));
		assert!(!lock.skills.contains_key("my-skill"));
	}

	#[test]
	fn test_remove_skill_from_local_lock_nonexistent() {
		let dir = TempDir::new().unwrap();
		let removed =
			remove_skill_from_local_lock("no-such-skill", Some(dir.path()))
				.unwrap();
		assert!(!removed);
	}

	#[test]
	fn test_merge_conflict_friendliness() {
		let dir = TempDir::new().unwrap();

		// Simulate branch A adding skill-a
		add_skill_to_local_lock(
			"skill-a",
			LocalSkillLockEntry {
				source: "org/a".to_string(),
				source_type: "github".to_string(),
				computed_hash: "aaa".to_string(),
			},
			Some(dir.path()),
		)
		.unwrap();
		let branch_a =
			fs::read_to_string(dir.path().join("skills-lock.json")).unwrap();

		// Reset to empty
		fs::remove_file(dir.path().join("skills-lock.json")).unwrap();

		// Simulate branch B adding skill-b
		add_skill_to_local_lock(
			"skill-b",
			LocalSkillLockEntry {
				source: "org/b".to_string(),
				source_type: "github".to_string(),
				computed_hash: "bbb".to_string(),
			},
			Some(dir.path()),
		)
		.unwrap();
		let branch_b =
			fs::read_to_string(dir.path().join("skills-lock.json")).unwrap();

		// Both branches produce valid JSON with no timestamps to conflict on
		let parsed_a: serde_json::Value =
			serde_json::from_str(&branch_a).unwrap();
		let parsed_b: serde_json::Value =
			serde_json::from_str(&branch_b).unwrap();

		assert!(parsed_a["skills"]["skill-a"].is_object());
		assert!(parsed_a["skills"]["skill-a"]["computedHash"].is_string());
		assert!(parsed_b["skills"]["skill-b"].is_object());
		assert!(parsed_b["skills"]["skill-b"]["computedHash"].is_string());

		// No timestamps present
		assert!(parsed_a["skills"]["skill-a"]["installedAt"].is_null());
		assert!(parsed_a["skills"]["skill-a"]["updatedAt"].is_null());
	}
}
