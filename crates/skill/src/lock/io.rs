use super::types::SkillLockFile;
use std::path::PathBuf;

/// Get the path to the global skill lock file.
/// Use $XDG_STATE_HOME/skills/.skill-lock.json if set.
/// otherwise fall back to ~/.agents/.skill-lock.json
pub fn get_skill_lock_path() -> PathBuf {
	if let Ok(xdg_state_home) = std::env::var("XDG_STATE_HOME") {
		PathBuf::from(xdg_state_home)
			.join("skills")
			.join(".skill-lock.json")
	} else {
		dirs::home_dir()
			.unwrap_or_else(|| PathBuf::from("."))
			.join(".agents")
			.join(".skill-lock.json")
	}
}

/// Read the skill lock file.
/// Returns an empty lock file structure if the file doesn't exist.
/// Wipes the lock file if it's an old format (version < CURRENT_VERSION).
pub fn read_skill_lock() -> SkillLockFile {
	let lock_path = get_skill_lock_path();

	match std::fs::read_to_string(&lock_path) {
		Ok(content) => {
			match serde_json::from_str::<SkillLockFile>(&content) {
				Ok(lock) => {
					// If old version, wipe and start fresh (backwards incompatible change)
					// v3 adds skillFolderHash - we want fresh installs to populate it
					if lock.version < SkillLockFile::current_version() {
						SkillLockFile::new()
					} else {
						lock
					}
				}
				Err(_) => {
					// File doesn't exist or is invalid - return empty
					SkillLockFile::new()
				}
			}
		}
		Err(_) => SkillLockFile::new(),
	}
}

/// Write the skill lock file.
/// Creates the directory if it doesn't exist.
pub fn write_skill_lock(lock: &SkillLockFile) -> std::io::Result<()> {
	let lock_path = get_skill_lock_path();

	// Ensure directory exists
	if let Some(parent) = lock_path.parent() {
		std::fs::create_dir_all(parent)?;
	}

	let content = serde_json::to_string_pretty(lock)? + "\n";
	std::fs::write(lock_path, content)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::lock::test_utils::TestLockGuard;

	#[test]
	fn test_get_skill_lock_path_with_xdg() {
		let _guard = TestLockGuard::new();
		let path = get_skill_lock_path();
		assert!(path.ends_with(".skill-lock.json"));
	}

	#[test]
	fn test_get_skill_lock_path_without_xdg() {
		let _guard = TestLockGuard::new();
		let old_xdg = std::env::var("XDG_STATE_HOME").ok();
		std::env::remove_var("XDG_STATE_HOME");

		let path = get_skill_lock_path();
		assert!(path.ends_with(".skill-lock.json"));
		assert!(path.to_string_lossy().contains(".agents"));

		if let Some(old) = old_xdg {
			std::env::set_var("XDG_STATE_HOME", old);
		}
	}

	#[test]
	fn test_read_skill_lock_missing_file() {
		let _guard = TestLockGuard::new();
		let lock = read_skill_lock();
		assert_eq!(lock.version, 3);
		assert!(lock.skills.is_empty());
	}

	#[test]
	fn test_read_skill_lock_old_version_wipes() {
		let _guard = TestLockGuard::new();
		let old_lock = r#"{
  "version": 2,
  "skills": {
    "old-skill": {
      "source": "org/repo",
      "sourceType": "github",
      "sourceUrl": "https://github.com/org/repo",
      "skillFolderHash": "old",
      "installedAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  }
}"#;

		let lock_path = get_skill_lock_path();
		std::fs::create_dir_all(lock_path.parent().unwrap()).unwrap();
		std::fs::write(&lock_path, old_lock).unwrap();

		let lock = read_skill_lock();
		assert_eq!(lock.version, 3);
		assert!(lock.skills.is_empty()); // Old version should be wiped
	}

	#[test]
	fn test_write_skill_lock_creates_directory() {
		let _guard = TestLockGuard::new();
		let lock = SkillLockFile::new();
		write_skill_lock(&lock).unwrap();

		let lock_path = get_skill_lock_path();
		assert!(lock_path.exists());
	}
}