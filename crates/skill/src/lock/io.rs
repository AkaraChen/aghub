use super::{mutation_guard, types::SkillLockFile};
use serde::{de::DeserializeOwned, Serialize};
use std::{
	fs::{File, OpenOptions},
	io::{Error, ErrorKind, Read, Write},
	path::{Path, PathBuf},
};

const SIDECAR_SUFFIX: &str = ".lock";
const MAX_SKILL_LOCK_BYTES: u64 = 16 * 1024 * 1024;

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

	match read_json::<SkillLockFile>(&lock_path) {
		Ok(lock) => {
			// If old version, wipe and start fresh (backwards incompatible change)
			// v3 adds skillFolderHash - we want fresh installs to populate it
			if lock.version < SkillLockFile::current_version() {
				SkillLockFile::new()
			} else {
				lock
			}
		}
		Err(_) => SkillLockFile::new(),
	}
}

pub(crate) fn read_skill_lock_for_update(
	path: &Path,
) -> std::io::Result<SkillLockFile> {
	let lock: SkillLockFile = read_json_for_update(path)?;
	if lock.version < SkillLockFile::current_version() {
		return Ok(SkillLockFile::new());
	}
	if lock.version > SkillLockFile::current_version() {
		return Err(Error::new(
			ErrorKind::InvalidData,
			format!("Unsupported global skill lock version {}", lock.version),
		));
	}
	Ok(lock)
}

/// Write the skill lock file.
/// Creates the directory if it doesn't exist.
pub fn write_skill_lock(lock: &SkillLockFile) -> std::io::Result<()> {
	let lock_path = get_skill_lock_path();
	let _guard = mutation_guard(&lock_path)?;
	write_json_atomic(&lock_path, lock)
}

pub(crate) fn lock_sidecar(target: &Path) -> std::io::Result<File> {
	validate_lock_target(target)?;
	let parent = target.parent().ok_or_else(|| {
		Error::new(
			ErrorKind::InvalidInput,
			format!("Skill lock '{}' has no parent", target.display()),
		)
	})?;
	std::fs::create_dir_all(parent)?;

	let sidecar = sidecar_lock_path(target)?;
	validate_sidecar_path(&sidecar)?;
	let file = open_sidecar(&sidecar)?;
	validate_open_sidecar(&sidecar, &file)?;
	file.lock()?;
	validate_open_sidecar(&sidecar, &file)?;
	Ok(file)
}

pub(crate) fn lock_skill_path_sidecar(target: &Path) -> std::io::Result<File> {
	let parent = target.parent().ok_or_else(|| {
		Error::new(
			ErrorKind::InvalidInput,
			format!("Skill path '{}' has no parent", target.display()),
		)
	})?;
	std::fs::create_dir_all(parent)?;

	let file_name = target.file_name().ok_or_else(|| {
		Error::new(
			ErrorKind::InvalidInput,
			format!("Skill path '{}' has no file name", target.display()),
		)
	})?;
	let mut sidecar_name = std::ffi::OsString::from(".");
	sidecar_name.push(file_name);
	sidecar_name.push(".aghub-skill-transaction.lock");
	let sidecar = target.with_file_name(sidecar_name);
	validate_sidecar_path(&sidecar)?;
	let file = open_sidecar(&sidecar)?;
	validate_open_sidecar(&sidecar, &file)?;
	file.lock()?;
	validate_open_sidecar(&sidecar, &file)?;
	Ok(file)
}

pub(crate) fn sidecar_lock_path(target: &Path) -> std::io::Result<PathBuf> {
	let file_name = target.file_name().ok_or_else(|| {
		Error::new(
			ErrorKind::InvalidInput,
			format!("Skill lock '{}' has no file name", target.display()),
		)
	})?;
	let mut sidecar_name = file_name.to_os_string();
	sidecar_name.push(SIDECAR_SUFFIX);
	Ok(target.with_file_name(sidecar_name))
}

fn validate_lock_target(target: &Path) -> std::io::Result<()> {
	match std::fs::symlink_metadata(target) {
		Ok(metadata) if metadata.file_type().is_file() => Ok(()),
		Ok(_) => Err(Error::new(
			ErrorKind::InvalidData,
			format!("Skill lock '{}' is not a regular file", target.display()),
		)),
		Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
		Err(error) => Err(error),
	}
}

fn validate_sidecar_path(sidecar: &Path) -> std::io::Result<()> {
	match std::fs::symlink_metadata(sidecar) {
		Ok(metadata) if metadata.file_type().is_file() => Ok(()),
		Ok(_) => Err(Error::new(
			ErrorKind::InvalidData,
			format!(
				"Skill lock sidecar '{}' is not a regular file",
				sidecar.display()
			),
		)),
		Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
		Err(error) => Err(error),
	}
}

fn validate_open_sidecar(sidecar: &Path, file: &File) -> std::io::Result<()> {
	let open_metadata = file.metadata()?;
	let path_metadata = std::fs::symlink_metadata(sidecar)?;
	if !open_metadata.file_type().is_file()
		|| !path_metadata.file_type().is_file()
	{
		return Err(Error::new(
			ErrorKind::InvalidData,
			format!(
				"Skill lock sidecar '{}' is not a regular file",
				sidecar.display()
			),
		));
	}

	#[cfg(unix)]
	{
		use std::os::unix::fs::MetadataExt;
		if open_metadata.dev() != path_metadata.dev()
			|| open_metadata.ino() != path_metadata.ino()
		{
			return Err(Error::new(
				ErrorKind::InvalidData,
				format!(
					"Skill lock sidecar '{}' changed while opening",
					sidecar.display()
				),
			));
		}
	}

	Ok(())
}

#[cfg(unix)]
fn open_sidecar(sidecar: &Path) -> std::io::Result<File> {
	use std::os::unix::fs::OpenOptionsExt;

	let mut options = OpenOptions::new();
	options
		.read(true)
		.write(true)
		.create(true)
		.custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK);
	options.open(sidecar)
}

#[cfg(windows)]
fn open_sidecar(sidecar: &Path) -> std::io::Result<File> {
	use std::os::windows::fs::OpenOptionsExt;

	// Values are FILE_SHARE_* and FILE_FLAG_OPEN_REPARSE_POINT from Win32.
	const SHARE_READ_WRITE: u32 = 0x0000_0001 | 0x0000_0002;
	const OPEN_REPARSE_POINT: u32 = 0x0020_0000;

	let mut options = OpenOptions::new();
	options
		.read(true)
		.write(true)
		.create(true)
		.share_mode(SHARE_READ_WRITE)
		.custom_flags(OPEN_REPARSE_POINT);
	options.open(sidecar)
}

#[cfg(not(any(unix, windows)))]
fn open_sidecar(sidecar: &Path) -> std::io::Result<File> {
	OpenOptions::new()
		.read(true)
		.write(true)
		.create(true)
		.open(sidecar)
}

pub(crate) fn read_json_for_update<T>(path: &Path) -> std::io::Result<T>
where
	T: DeserializeOwned + Default,
{
	match read_json(path) {
		Ok(value) => Ok(value),
		Err(error) if error.kind() == ErrorKind::NotFound => Ok(T::default()),
		Err(error) => Err(error),
	}
}

pub(crate) fn read_json<T>(path: &Path) -> std::io::Result<T>
where
	T: DeserializeOwned,
{
	let file = open_lock_for_read(path)?;
	let metadata = file.metadata()?;
	if !metadata.file_type().is_file() {
		return Err(Error::new(
			ErrorKind::InvalidData,
			format!("Skill lock '{}' is not a regular file", path.display()),
		));
	}
	if metadata.len() > MAX_SKILL_LOCK_BYTES {
		return Err(lock_size_error(path));
	}
	let mut content = Vec::with_capacity(metadata.len() as usize);
	file.take(MAX_SKILL_LOCK_BYTES + 1)
		.read_to_end(&mut content)?;
	if content.len() as u64 > MAX_SKILL_LOCK_BYTES {
		return Err(lock_size_error(path));
	}
	serde_json::from_slice(&content).map_err(|error| {
		Error::new(
			ErrorKind::InvalidData,
			format!("Skill lock '{}' is invalid: {error}", path.display()),
		)
	})
}

fn lock_size_error(path: &Path) -> Error {
	Error::new(
		ErrorKind::InvalidData,
		format!(
			"Skill lock '{}' exceeds the {} byte limit",
			path.display(),
			MAX_SKILL_LOCK_BYTES
		),
	)
}

#[cfg(unix)]
fn open_lock_for_read(path: &Path) -> std::io::Result<File> {
	use std::os::unix::fs::OpenOptionsExt;

	OpenOptions::new()
		.read(true)
		.custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
		.open(path)
}

#[cfg(windows)]
fn open_lock_for_read(path: &Path) -> std::io::Result<File> {
	use std::os::windows::fs::OpenOptionsExt;

	const SHARE_READ_WRITE_DELETE: u32 =
		0x0000_0001 | 0x0000_0002 | 0x0000_0004;
	const OPEN_REPARSE_POINT: u32 = 0x0020_0000;

	OpenOptions::new()
		.read(true)
		.share_mode(SHARE_READ_WRITE_DELETE)
		.custom_flags(OPEN_REPARSE_POINT)
		.open(path)
}

#[cfg(not(any(unix, windows)))]
fn open_lock_for_read(path: &Path) -> std::io::Result<File> {
	File::open(path)
}

pub(crate) fn write_json_atomic<T>(
	path: &Path,
	value: &T,
) -> std::io::Result<()>
where
	T: Serialize,
{
	let parent = path.parent().ok_or_else(|| {
		Error::new(
			ErrorKind::InvalidInput,
			format!("Skill lock '{}' has no parent", path.display()),
		)
	})?;
	let permissions = match std::fs::symlink_metadata(path) {
		Ok(metadata) if metadata.file_type().is_file() => {
			Some(metadata.permissions())
		}
		Ok(_) => {
			return Err(Error::new(
				ErrorKind::InvalidData,
				format!(
					"Skill lock '{}' is not a regular file",
					path.display()
				),
			))
		}
		Err(error) if error.kind() == ErrorKind::NotFound => None,
		Err(error) => return Err(error),
	};

	let mut temporary = tempfile::Builder::new()
		.prefix(".aghub-skill-lock-")
		.tempfile_in(parent)?;
	if let Some(permissions) = permissions {
		std::fs::set_permissions(temporary.path(), permissions)?;
	}
	serde_json::to_writer_pretty(temporary.as_file_mut(), value)?;
	temporary.as_file_mut().write_all(b"\n")?;
	temporary.as_file_mut().flush()?;
	temporary.as_file().sync_all()?;
	temporary.persist(path).map_err(|error| error.error)?;
	sync_lock_directory(parent)
}

#[cfg(unix)]
fn sync_lock_directory(parent: &Path) -> std::io::Result<()> {
	File::open(parent)?.sync_all()
}

#[cfg(not(unix))]
fn sync_lock_directory(_parent: &Path) -> std::io::Result<()> {
	Ok(())
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

	#[test]
	fn write_skill_lock_rejects_non_file_target() {
		let _guard = TestLockGuard::new();
		let target = get_skill_lock_path();
		std::fs::create_dir_all(&target).unwrap();

		let error = write_skill_lock(&SkillLockFile::new()).unwrap_err();

		assert_eq!(error.kind(), ErrorKind::InvalidData);
		assert!(target.is_dir());
	}

	#[test]
	fn write_skill_lock_rejects_non_file_sidecar() {
		let _guard = TestLockGuard::new();
		let target = get_skill_lock_path();
		std::fs::create_dir_all(target.parent().unwrap()).unwrap();
		let sidecar = sidecar_lock_path(&target).unwrap();
		std::fs::create_dir(&sidecar).unwrap();

		let error = write_skill_lock(&SkillLockFile::new()).unwrap_err();

		assert_eq!(error.kind(), ErrorKind::InvalidData);
		assert!(sidecar.is_dir());
		assert!(!target.exists());
	}

	#[cfg(unix)]
	#[test]
	fn write_skill_lock_rejects_symlink_target() {
		use std::os::unix::fs::symlink;

		let _guard = TestLockGuard::new();
		let target = get_skill_lock_path();
		std::fs::create_dir_all(target.parent().unwrap()).unwrap();
		let destination = target.with_file_name("actual-lock.json");
		std::fs::write(&destination, "unchanged").unwrap();
		symlink(&destination, &target).unwrap();

		let error = write_skill_lock(&SkillLockFile::new()).unwrap_err();

		assert_eq!(error.kind(), ErrorKind::InvalidData);
		assert!(target.is_symlink());
		assert_eq!(std::fs::read_to_string(destination).unwrap(), "unchanged");
		assert!(!sidecar_lock_path(&target).unwrap().exists());
	}

	#[cfg(unix)]
	#[test]
	fn write_skill_lock_rejects_symlink_sidecar() {
		use std::os::unix::fs::symlink;

		let _guard = TestLockGuard::new();
		let target = get_skill_lock_path();
		std::fs::create_dir_all(target.parent().unwrap()).unwrap();
		let destination = target.with_file_name("actual-sidecar");
		std::fs::write(&destination, "unchanged").unwrap();
		let sidecar = sidecar_lock_path(&target).unwrap();
		symlink(&destination, &sidecar).unwrap();

		let error = write_skill_lock(&SkillLockFile::new()).unwrap_err();

		assert_eq!(error.kind(), ErrorKind::InvalidData);
		assert!(sidecar.is_symlink());
		assert_eq!(std::fs::read_to_string(destination).unwrap(), "unchanged");
		assert!(!target.exists());
	}

	#[test]
	fn lock_reader_rejects_oversized_files_before_reading() {
		let temp_dir = tempfile::TempDir::new().unwrap();
		let path = temp_dir.path().join("skills-lock.json");
		let file = File::create(&path).unwrap();
		file.set_len(MAX_SKILL_LOCK_BYTES + 1).unwrap();

		let error =
			read_json_for_update::<serde_json::Value>(&path).unwrap_err();

		assert_eq!(error.kind(), ErrorKind::InvalidData);
		assert!(error.to_string().contains("byte limit"));
	}

	#[cfg(unix)]
	#[test]
	fn lock_reader_rejects_symlinks() {
		use std::os::unix::fs::symlink;

		let temp_dir = tempfile::TempDir::new().unwrap();
		let target = temp_dir.path().join("target.json");
		let linked = temp_dir.path().join("skills-lock.json");
		std::fs::write(&target, "{}").unwrap();
		symlink(&target, &linked).unwrap();

		assert!(read_json_for_update::<serde_json::Value>(&linked).is_err());
	}
}
