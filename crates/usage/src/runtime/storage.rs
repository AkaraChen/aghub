use super::{
	CcusageRuntimeError, CcusageRuntimePreference, CcusageRuntimeSource,
};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use tempfile::{Builder, TempDir};

const RUNTIME_CONFIG_VERSION: u32 = 1;

#[derive(Deserialize, Serialize)]
struct PersistedRuntime {
	version: u32,
	preference: CcusageRuntimePreference,
}

pub(super) fn load_preference(
	root: &Path,
) -> Result<Option<CcusageRuntimePreference>, CcusageRuntimeError> {
	let path = root.join("runtime.json");
	let bytes = match fs::read(&path) {
		Ok(bytes) => bytes,
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			return Ok(None);
		}
		Err(error) => return Err(error.into()),
	};
	let persisted: PersistedRuntime = serde_json::from_slice(&bytes)?;
	if persisted.version != RUNTIME_CONFIG_VERSION {
		return Err(CcusageRuntimeError::InvalidRuntimeConfig(format!(
			"unsupported ccusage runtime config version {}",
			persisted.version
		)));
	}
	Ok(Some(persisted.preference))
}

pub(super) fn save_preference(
	root: &Path,
	preference: &CcusageRuntimePreference,
) -> Result<(), CcusageRuntimeError> {
	fs::create_dir_all(root)?;
	let mut temp = Builder::new().prefix("runtime-").tempfile_in(root)?;
	serde_json::to_writer_pretty(
		&mut temp,
		&PersistedRuntime {
			version: RUNTIME_CONFIG_VERSION,
			preference: preference.clone(),
		},
	)?;
	temp.write_all(b"\n")?;
	temp.as_file().sync_all()?;
	temp.persist(root.join("runtime.json"))
		.map_err(|error| CcusageRuntimeError::Io(error.error))?;
	Ok(())
}

pub(super) fn create_stage(
	root: &Path,
) -> Result<TempDir, CcusageRuntimeError> {
	let staging = root.join("staging");
	fs::create_dir_all(&staging)?;
	Builder::new()
		.prefix("install-")
		.tempdir_in(staging)
		.map_err(Into::into)
}

pub(super) fn installation_path(
	root: &Path,
	source: CcusageRuntimeSource,
	version: &Version,
) -> Result<PathBuf, CcusageRuntimeError> {
	let source_dir = installation_source_dir(root, source)?;
	Ok(source_dir
		.join(version.to_string())
		.join(executable_file_name()))
}

pub(super) fn commit_binary(
	root: &Path,
	source: CcusageRuntimeSource,
	version: &Version,
	staged_binary: &Path,
) -> Result<PathBuf, CcusageRuntimeError> {
	let destination = installation_path(root, source, version)?;
	let version_dir = destination.parent().ok_or_else(|| {
		CcusageRuntimeError::InvalidRuntimeConfig(
			"ccusage installation path has no parent".to_string(),
		)
	})?;
	if destination.is_file() {
		let staged_digest = file_digest(staged_binary)?;
		if file_digest(&destination)
			.ok()
			.is_some_and(|digest| digest == staged_digest)
		{
			set_executable(&destination)?;
			save_current_installation(version_dir, &destination)?;
			return Ok(destination);
		}
		if let Some(current) = current_installation(version_dir) {
			if file_digest(&current)
				.ok()
				.is_some_and(|digest| digest == staged_digest)
			{
				set_executable(&current)?;
				save_current_installation(version_dir, &current)?;
				return Ok(current);
			}
		}
		let revisions = version_dir.join("revisions");
		fs::create_dir_all(&revisions)?;
		let digest = staged_digest
			.iter()
			.map(|byte| format!("{byte:02x}"))
			.collect::<String>();
		let revision_path = revisions
			.join(format!("ccusage-{digest}{}", std::env::consts::EXE_SUFFIX));
		if revision_path.is_file()
			&& file_digest(&revision_path)
				.ok()
				.is_some_and(|digest| digest == staged_digest)
		{
			set_executable(&revision_path)?;
			save_current_installation(version_dir, &revision_path)?;
			return Ok(revision_path);
		}
		match fs::OpenOptions::new()
			.write(true)
			.create_new(true)
			.open(&revision_path)
		{
			Ok(mut revision) => {
				io::copy(&mut fs::File::open(staged_binary)?, &mut revision)?;
				revision.sync_all()?;
				set_executable(&revision_path)?;
				save_current_installation(version_dir, &revision_path)?;
				return Ok(revision_path);
			}
			Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
			}
			Err(error) => return Err(error.into()),
		}
		let mut revision = Builder::new()
			.prefix("ccusage-")
			.suffix(std::env::consts::EXE_SUFFIX)
			.tempfile_in(revisions)?;
		io::copy(&mut fs::File::open(staged_binary)?, &mut revision)?;
		revision.as_file().sync_all()?;
		let (_, path) = revision
			.keep()
			.map_err(|error| CcusageRuntimeError::Io(error.error))?;
		set_executable(&path)?;
		save_current_installation(version_dir, &path)?;
		return Ok(path);
	}
	fs::create_dir_all(version_dir)?;
	fs::rename(staged_binary, &destination)?;
	set_executable(&destination)?;
	save_current_installation(version_dir, &destination)?;
	Ok(destination)
}

fn save_current_installation(
	version_dir: &Path,
	path: &Path,
) -> Result<(), CcusageRuntimeError> {
	let value = if path == version_dir.join(executable_file_name()) {
		"canonical".to_string()
	} else {
		let file_name = path
			.file_name()
			.and_then(|name| name.to_str())
			.ok_or_else(|| {
				CcusageRuntimeError::InvalidRuntimeConfig(
					"ccusage revision has no file name".to_string(),
				)
			})?;
		format!("revision:{file_name}")
	};
	let mut current =
		Builder::new().prefix("current-").tempfile_in(version_dir)?;
	current.write_all(value.as_bytes())?;
	current.write_all(b"\n")?;
	current.as_file().sync_all()?;
	current
		.persist(version_dir.join("current"))
		.map_err(|error| CcusageRuntimeError::Io(error.error))?;
	Ok(())
}

fn current_installation(version_dir: &Path) -> Option<PathBuf> {
	let value = fs::read_to_string(version_dir.join("current")).ok()?;
	let value = value.trim();
	let path = if value == "canonical" {
		version_dir.join(executable_file_name())
	} else {
		let file_name = value.strip_prefix("revision:")?;
		let relative = Path::new(file_name);
		if relative.file_name()?.to_str()? != file_name {
			return None;
		}
		version_dir.join("revisions").join(relative)
	};
	path.is_file().then_some(path)
}

fn file_digest(path: &Path) -> Result<[u8; 32], CcusageRuntimeError> {
	let mut file = fs::File::open(path)?;
	let mut digest = Sha256::new();
	let mut buffer = [0_u8; 8192];
	loop {
		let read = file.read(&mut buffer)?;
		if read == 0 {
			break;
		}
		digest.update(&buffer[..read]);
	}
	Ok(digest.finalize().into())
}

#[cfg(test)]
pub(super) fn latest_installation(
	root: &Path,
	source: CcusageRuntimeSource,
) -> Result<Option<(Version, PathBuf)>, CcusageRuntimeError> {
	Ok(installations(root, source)?.into_iter().next())
}

pub(super) fn installations(
	root: &Path,
	source: CcusageRuntimeSource,
) -> Result<Vec<(Version, PathBuf)>, CcusageRuntimeError> {
	let source_dir = installation_source_dir(root, source)?;
	let entries = match fs::read_dir(source_dir) {
		Ok(entries) => entries,
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			return Ok(Vec::new());
		}
		Err(error) => return Err(error.into()),
	};
	let mut versions = entries
		.filter_map(Result::ok)
		.flat_map(|entry| {
			let Some(version) = entry
				.file_name()
				.to_str()
				.and_then(|name| name.parse::<Version>().ok())
			else {
				return Vec::new();
			};
			let version_dir = entry.path();
			let current = current_installation(&version_dir);
			let mut paths = Vec::new();
			if let Some(path) = current.as_ref() {
				paths.push((version.clone(), path.clone()));
			}
			if let Ok(revisions) = fs::read_dir(version_dir.join("revisions")) {
				paths.extend(
					revisions
						.filter_map(Result::ok)
						.map(|revision| revision.path())
						.filter(|path| {
							path.is_file() && current.as_ref() != Some(path)
						})
						.map(|path| (version.clone(), path)),
				);
			}
			let executable = version_dir.join(executable_file_name());
			if executable.is_file() && current.as_ref() != Some(&executable) {
				paths.push((version.clone(), executable));
			}
			paths
		})
		.collect::<Vec<_>>();
	versions.sort_by(|left, right| right.0.cmp(&left.0));
	Ok(versions)
}

fn installation_source_dir(
	root: &Path,
	source: CcusageRuntimeSource,
) -> Result<PathBuf, CcusageRuntimeError> {
	let name = match source {
		CcusageRuntimeSource::Bun => "bun",
		CcusageRuntimeSource::Npm => "npm",
		CcusageRuntimeSource::Download => "download",
		_ => return Err(CcusageRuntimeError::SourceCannotInstall(source)),
	};
	Ok(root.join("installations").join(name))
}

pub(super) fn executable_file_name() -> String {
	format!("ccusage{}", std::env::consts::EXE_SUFFIX)
}

pub(super) fn prepare_staged_binary(
	path: &Path,
) -> Result<(), CcusageRuntimeError> {
	let metadata = fs::symlink_metadata(path)?;
	if !metadata.file_type().is_file() {
		return Err(CcusageRuntimeError::InvalidBinary(format!(
			"{} is not a regular file",
			path.display()
		)));
	}
	set_executable(path)
}

#[cfg(unix)]
fn set_executable(path: &Path) -> Result<(), CcusageRuntimeError> {
	use std::os::unix::fs::PermissionsExt;
	fs::set_permissions(path, fs::Permissions::from_mode(0o755))?;
	Ok(())
}

#[cfg(not(unix))]
fn set_executable(_path: &Path) -> Result<(), CcusageRuntimeError> {
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn preference_round_trips() {
		let root = tempfile::tempdir().unwrap();
		let preference = CcusageRuntimePreference::Manual(PathBuf::from(
			"/tmp/custom ccusage",
		));
		save_preference(root.path(), &preference).unwrap();
		assert_eq!(load_preference(root.path()).unwrap(), Some(preference));
	}

	#[test]
	fn latest_installation_uses_semver_order() {
		let root = tempfile::tempdir().unwrap();
		for version in ["20.0.9", "20.0.10"] {
			let path = root.path().join("installations/download").join(version);
			fs::create_dir_all(&path).unwrap();
			fs::write(path.join(executable_file_name()), b"fixture").unwrap();
		}
		let (version, _) =
			latest_installation(root.path(), CcusageRuntimeSource::Download)
				.unwrap()
				.unwrap();
		assert_eq!(version, Version::new(20, 0, 10));
	}

	#[test]
	fn same_version_install_uses_a_revision_path() {
		let root = tempfile::tempdir().unwrap();
		let stage = tempfile::tempdir_in(root.path()).unwrap();
		let version = Version::new(20, 0, 10);
		let first_stage = stage.path().join("first");
		let second_stage = stage.path().join("second");
		let repeated_stage = stage.path().join("repeated");
		fs::write(&first_stage, b"first").unwrap();
		fs::write(&second_stage, b"second").unwrap();
		fs::write(&repeated_stage, b"second").unwrap();
		let first = commit_binary(
			root.path(),
			CcusageRuntimeSource::Download,
			&version,
			&first_stage,
		)
		.unwrap();
		let second = commit_binary(
			root.path(),
			CcusageRuntimeSource::Download,
			&version,
			&second_stage,
		)
		.unwrap();
		let repeated = commit_binary(
			root.path(),
			CcusageRuntimeSource::Download,
			&version,
			&repeated_stage,
		)
		.unwrap();
		assert_ne!(first, second);
		assert_eq!(second, repeated);
		assert_eq!(
			latest_installation(root.path(), CcusageRuntimeSource::Download)
				.unwrap()
				.unwrap()
				.1,
			second
		);
		assert_eq!(fs::read(first).unwrap(), b"first");
		assert_eq!(fs::read(second).unwrap(), b"second");
	}

	#[cfg(unix)]
	#[test]
	fn matching_install_repairs_executable_permissions() {
		use std::os::unix::fs::PermissionsExt;

		let root = tempfile::tempdir().unwrap();
		let stage = tempfile::tempdir_in(root.path()).unwrap();
		let version = Version::new(20, 0, 10);
		let first_stage = stage.path().join("first");
		let repeated_stage = stage.path().join("repeated");
		fs::write(&first_stage, b"same").unwrap();
		fs::write(&repeated_stage, b"same").unwrap();
		let first = commit_binary(
			root.path(),
			CcusageRuntimeSource::Download,
			&version,
			&first_stage,
		)
		.unwrap();
		fs::set_permissions(&first, fs::Permissions::from_mode(0o644)).unwrap();

		let repeated = commit_binary(
			root.path(),
			CcusageRuntimeSource::Download,
			&version,
			&repeated_stage,
		)
		.unwrap();

		assert_eq!(repeated, first);
		assert_ne!(
			fs::metadata(repeated).unwrap().permissions().mode() & 0o111,
			0
		);
	}
}
