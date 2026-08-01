use crate::{
	lock::{global, local},
	parser, scan, SkillLockEntry,
};
use chrono::Utc;
use std::path::{Path, PathBuf};
use thiserror::Error;

pub const EMPTY_SKILLS_LOCK_DIGEST: &str =
	"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoDiscoveredSkill {
	pub name: String,
	pub full_path: PathBuf,
	pub relative_dir: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallLockSource {
	pub source: String,
	pub source_type: String,
	pub source_url: String,
	pub ref_name: Option<String>,
}

/// One installed skill to record in a lock-file batch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallLockUpdate {
	/// Parsed skill name used as the lock entry key.
	pub name: String,
	/// Source-relative `SKILL.md` path, when the lock format supports it.
	pub skill_path: Option<String>,
	/// Digest of the installed skill directory.
	pub skill_folder_hash: String,
}

#[derive(Debug, Error)]
pub enum RepoDiscoveryError {
	#[error("No skills found in source repository")]
	NoSkillsFound,
	#[error(
		"Requested skills not found: {missing}. Available skills: {available}"
	)]
	SkillsNotFound { missing: String, available: String },
	#[error("Failed to scan repository for skills: {0:?}")]
	Scan(#[from] scan::ScanError),
	#[error(
		"Failed to determine repo-relative skill path '{path}' from '{root}'"
	)]
	RelativePath { path: PathBuf, root: PathBuf },
}

fn normalize_relative_repo_dir(
	repo_root: &Path,
	skill_path: &Path,
) -> Result<String, RepoDiscoveryError> {
	let relative = skill_path.strip_prefix(repo_root).map_err(|_| {
		RepoDiscoveryError::RelativePath {
			path: skill_path.to_path_buf(),
			root: repo_root.to_path_buf(),
		}
	})?;
	let value = relative.to_string_lossy().replace('\\', "/");
	if value == "." {
		Ok(String::new())
	} else {
		Ok(value)
	}
}

pub fn lock_skill_file_path(relative_dir: &str) -> String {
	if relative_dir.is_empty() {
		"SKILL.md".to_string()
	} else {
		format!("{relative_dir}/SKILL.md")
	}
}

pub fn discover_repo_skills(
	repo_root: &Path,
	requested_skills: &[String],
	install_all: bool,
) -> Result<Vec<RepoDiscoveredSkill>, RepoDiscoveryError> {
	discover_repo_skills_inner(repo_root, requested_skills, install_all, None)
}

pub fn discover_repo_skills_with_limit(
	repo_root: &Path,
	requested_skills: &[String],
	install_all: bool,
	max_results: usize,
) -> Result<Vec<RepoDiscoveredSkill>, RepoDiscoveryError> {
	discover_repo_skills_inner(
		repo_root,
		requested_skills,
		install_all,
		Some(max_results),
	)
}

fn discover_repo_skills_inner(
	repo_root: &Path,
	requested_skills: &[String],
	install_all: bool,
	max_results: Option<usize>,
) -> Result<Vec<RepoDiscoveredSkill>, RepoDiscoveryError> {
	let scan_options = scan::ScanOptions {
		max_depth: 10,
		full_depth: true,
		respect_gitignore: true,
	};
	let paths = match max_results {
		Some(limit) => scan::scan_skills_with_limit(
			repo_root,
			scan_options,
			vec![],
			limit,
		)?,
		None => scan::scan_skills(repo_root, scan_options, vec![])?,
	};

	let mut discovered = Vec::new();
	for path in paths {
		let parsed = match parser::parse(&path) {
			Ok(parsed) => parsed,
			Err(_) => continue,
		};
		discovered.push(RepoDiscoveredSkill {
			name: parsed.name,
			relative_dir: normalize_relative_repo_dir(repo_root, &path)?,
			full_path: path,
		});
	}

	if discovered.is_empty() {
		return Err(RepoDiscoveryError::NoSkillsFound);
	}

	if install_all || requested_skills.is_empty() {
		return Ok(discovered);
	}

	let mut selected = Vec::new();
	let mut missing = Vec::new();
	let mut selected_paths = std::collections::HashSet::new();

	for requested in requested_skills {
		let requested_lower = requested.to_lowercase();
		match discovered
			.iter()
			.find(|skill| skill.name.to_lowercase() == requested_lower)
		{
			Some(skill) if selected_paths.insert(skill.full_path.clone()) => {
				selected.push(skill.clone());
			}
			Some(_) => {}
			None => missing.push(requested.clone()),
		}
	}

	if !missing.is_empty() {
		let available = discovered
			.iter()
			.map(|skill| skill.name.clone())
			.collect::<Vec<_>>()
			.join(", ");
		return Err(RepoDiscoveryError::SkillsNotFound {
			missing: missing.join(", "),
			available,
		});
	}

	Ok(selected)
}

pub fn write_global_install_lock(
	skill_name: &str,
	source: &InstallLockSource,
	skill_path: Option<String>,
	skill_folder_hash: Option<String>,
) -> std::io::Result<()> {
	write_global_install_locks(
		source,
		&[InstallLockUpdate {
			name: skill_name.to_string(),
			skill_path,
			skill_folder_hash: skill_folder_hash
				.unwrap_or_else(|| EMPTY_SKILLS_LOCK_DIGEST.to_string()),
		}],
	)
}

/// Record a batch in the global lock with one read-modify-write operation.
pub fn write_global_install_locks(
	source: &InstallLockSource,
	updates: &[InstallLockUpdate],
) -> std::io::Result<()> {
	if updates.is_empty() {
		return Ok(());
	}
	let now = Utc::now().to_rfc3339();
	global::try_mutate_skill_lock(|lock| {
		for update in updates {
			if let Some(existing) = lock.skills.get(&update.name) {
				if existing.source != source.source
					|| existing.source_type != source.source_type
				{
					return Err(std::io::Error::new(
						std::io::ErrorKind::AlreadyExists,
						format!(
							"Skill '{}' is already tracked from '{}'",
							update.name, existing.source
						),
					));
				}
			}
			let installed_at = lock
				.skills
				.get(&update.name)
				.map(|entry| entry.installed_at.clone())
				.unwrap_or_else(|| now.clone());
			lock.skills.insert(
				update.name.clone(),
				SkillLockEntry {
					source: source.source.clone(),
					source_type: source.source_type.clone(),
					source_url: source.source_url.clone(),
					ref_name: source.ref_name.clone(),
					skill_path: update.skill_path.clone(),
					skill_folder_hash: update.skill_folder_hash.clone(),
					installed_at,
					updated_at: now.clone(),
					plugin_name: None,
				},
			);
		}
		Ok(())
	})
}

pub fn write_project_install_lock(
	skill_name: &str,
	source: &InstallLockSource,
	cwd: &Path,
) -> std::io::Result<()> {
	write_project_install_locks(
		source,
		&[InstallLockUpdate {
			name: skill_name.to_string(),
			skill_path: None,
			skill_folder_hash: EMPTY_SKILLS_LOCK_DIGEST.to_string(),
		}],
		cwd,
	)
}

/// Record a batch in a project lock with one read-modify-write operation.
pub fn write_project_install_locks(
	source: &InstallLockSource,
	updates: &[InstallLockUpdate],
	cwd: &Path,
) -> std::io::Result<()> {
	if updates.is_empty() {
		return Ok(());
	}
	local::try_mutate_local_lock(Some(cwd), |lock| {
		for update in updates {
			if let Some(existing) = lock.skills.get(&update.name) {
				if existing.source != source.source
					|| existing.source_type != source.source_type
				{
					return Err(std::io::Error::new(
						std::io::ErrorKind::AlreadyExists,
						format!(
							"Skill '{}' is already tracked from '{}'",
							update.name, existing.source
						),
					));
				}
			}
			lock.skills.insert(
				update.name.clone(),
				local::LocalSkillLockEntry {
					source: source.source.clone(),
					ref_name: source.ref_name.clone(),
					source_type: source.source_type.clone(),
					computed_hash: update.skill_folder_hash.clone(),
				},
			);
		}
		Ok(())
	})
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::lock::test_utils::TestLockGuard;
	use std::sync::{Arc, Barrier};
	use tempfile::TempDir;

	fn source() -> InstallLockSource {
		InstallLockSource {
			source: "owner/repo".to_string(),
			source_type: "github".to_string(),
			source_url: "https://github.com/owner/repo.git".to_string(),
			ref_name: Some("main".to_string()),
		}
	}

	fn update(name: &str, hash: &str) -> InstallLockUpdate {
		InstallLockUpdate {
			name: name.to_string(),
			skill_path: Some(format!("skills/{name}/SKILL.md")),
			skill_folder_hash: hash.to_string(),
		}
	}

	fn write_test_skill(root: &Path, name: &str) {
		let skill_dir = root.join(name);
		std::fs::create_dir_all(&skill_dir).unwrap();
		std::fs::write(
			skill_dir.join("SKILL.md"),
			format!(
				"---\nname: {name}\ndescription: test skill\n---\n\nTest\n"
			),
		)
		.unwrap();
	}

	#[test]
	fn lock_skill_file_path_handles_root_skill() {
		assert_eq!(lock_skill_file_path(""), "SKILL.md");
		assert_eq!(
			lock_skill_file_path("skills/test-skill"),
			"skills/test-skill/SKILL.md"
		);
	}

	#[test]
	fn discover_repo_skills_stops_at_the_result_limit() {
		let dir = TempDir::new().unwrap();
		for name in ["one", "two", "three"] {
			write_test_skill(dir.path(), name);
		}

		let result = discover_repo_skills_with_limit(dir.path(), &[], true, 2);

		assert!(matches!(
			result,
			Err(RepoDiscoveryError::Scan(
				scan::ScanError::ResultLimitExceeded(2)
			))
		));
	}

	#[test]
	fn discover_repo_skills_deduplicates_requested_names() {
		let dir = TempDir::new().unwrap();
		write_test_skill(dir.path(), "one");
		let requested = vec!["one".to_string(); 100];

		let result =
			discover_repo_skills_with_limit(dir.path(), &requested, false, 2)
				.unwrap();

		assert_eq!(result.len(), 1);
		assert_eq!(result[0].name, "one");
	}

	#[test]
	fn write_project_install_lock_uses_placeholder_hash() {
		let dir = TempDir::new().unwrap();
		write_project_install_lock(
			"my-skill",
			&InstallLockSource {
				source: "owner/repo".to_string(),
				source_type: "github".to_string(),
				source_url: "https://github.com/owner/repo.git".to_string(),
				ref_name: Some("main".to_string()),
			},
			dir.path(),
		)
		.unwrap();

		let lock = local::read_local_lock(Some(dir.path()));
		assert_eq!(
			lock.skills.get("my-skill").unwrap().computed_hash,
			EMPTY_SKILLS_LOCK_DIGEST
		);
	}

	#[test]
	fn batch_global_install_lock_preserves_installed_at() {
		let _guard = TestLockGuard::new();
		let source = source();
		let installed_at = "2020-01-01T00:00:00Z".to_string();
		let mut initial = global::SkillLockFile::new();
		initial.skills.insert(
			"alpha".to_string(),
			SkillLockEntry {
				source: source.source.clone(),
				source_type: "github".to_string(),
				source_url: source.source_url.clone(),
				ref_name: None,
				skill_path: None,
				skill_folder_hash: "old-hash".to_string(),
				installed_at: installed_at.clone(),
				updated_at: installed_at.clone(),
				plugin_name: None,
			},
		);
		global::write_skill_lock(&initial).unwrap();

		write_global_install_locks(
			&source,
			&[update("alpha", "new-hash"), update("beta", "beta-hash")],
		)
		.unwrap();

		let lock = global::read_skill_lock();
		assert_eq!(lock.skills.len(), 2);
		assert_eq!(lock.skills["alpha"].installed_at, installed_at);
		assert_ne!(lock.skills["alpha"].updated_at, installed_at);
		assert_eq!(lock.skills["alpha"].skill_folder_hash, "new-hash");
		assert_eq!(lock.skills["beta"].skill_folder_hash, "beta-hash");
		assert_eq!(
			lock.skills["beta"].installed_at,
			lock.skills["beta"].updated_at
		);
	}

	#[test]
	fn global_lock_rejects_conflicting_provenance() {
		let _guard = TestLockGuard::new();
		write_global_install_locks(&source(), &[update("demo", "first-hash")])
			.unwrap();
		let conflicting = InstallLockSource {
			source: "other/repo".to_string(),
			source_type: "github".to_string(),
			source_url: "https://github.com/other/repo.git".to_string(),
			ref_name: Some("main".to_string()),
		};

		let error = write_global_install_locks(
			&conflicting,
			&[update("demo", "second-hash")],
		)
		.unwrap_err();

		assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
		let lock = global::read_skill_lock();
		assert_eq!(lock.skills["demo"].source, "owner/repo");
		assert_eq!(lock.skills["demo"].skill_folder_hash, "first-hash");
	}

	#[test]
	fn batch_project_install_lock_writes_all_updates() {
		let dir = TempDir::new().unwrap();
		let source = source();

		write_project_install_locks(
			&source,
			&[update("alpha", "alpha-hash"), update("beta", "beta-hash")],
			dir.path(),
		)
		.unwrap();

		let lock = local::read_local_lock(Some(dir.path()));
		assert_eq!(lock.skills.len(), 2);
		assert_eq!(lock.skills["alpha"].computed_hash, "alpha-hash");
		assert_eq!(lock.skills["beta"].computed_hash, "beta-hash");
	}

	#[test]
	fn project_lock_rejects_conflicting_provenance() {
		let dir = TempDir::new().unwrap();
		write_project_install_locks(
			&source(),
			&[update("demo", "first-hash")],
			dir.path(),
		)
		.unwrap();
		let conflicting = InstallLockSource {
			source: "other/repo".to_string(),
			source_type: "github".to_string(),
			source_url: "https://github.com/other/repo.git".to_string(),
			ref_name: Some("main".to_string()),
		};

		let error = write_project_install_locks(
			&conflicting,
			&[update("demo", "second-hash")],
			dir.path(),
		)
		.unwrap_err();

		assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
		let lock = local::read_local_lock(Some(dir.path()));
		assert_eq!(lock.skills["demo"].source, "owner/repo");
		assert_eq!(lock.skills["demo"].computed_hash, "first-hash");
	}

	#[test]
	fn concurrent_global_batches_do_not_lose_entries() {
		const UPDATE_COUNT: usize = 16;
		let _guard = TestLockGuard::new();
		let source = Arc::new(source());
		let barrier = Arc::new(Barrier::new(UPDATE_COUNT + 1));

		std::thread::scope(|scope| {
			for index in 0..UPDATE_COUNT {
				let source = Arc::clone(&source);
				let barrier = Arc::clone(&barrier);
				scope.spawn(move || {
					let name = format!("skill-{index}");
					barrier.wait();
					write_global_install_locks(
						&source,
						&[update(&name, &format!("{name}-hash"))],
					)
					.unwrap();
				});
			}
			barrier.wait();
		});

		let lock = global::read_skill_lock();
		assert_eq!(lock.skills.len(), UPDATE_COUNT);
		for index in 0..UPDATE_COUNT {
			assert!(lock.skills.contains_key(&format!("skill-{index}")));
		}
	}

	#[test]
	fn corrupt_global_lock_is_not_overwritten() {
		let _guard = TestLockGuard::new();
		let path = global::get_skill_lock_path();
		std::fs::create_dir_all(path.parent().unwrap()).unwrap();
		std::fs::write(&path, "not json").unwrap();

		let error = write_global_install_locks(
			&source(),
			&[update("alpha", "alpha-hash")],
		)
		.unwrap_err();

		assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
		assert_eq!(std::fs::read_to_string(path).unwrap(), "not json");
	}

	#[test]
	fn non_file_project_lock_is_not_replaced() {
		let dir = TempDir::new().unwrap();
		let path = local::get_local_lock_path(Some(dir.path()));
		std::fs::create_dir(&path).unwrap();

		let error = write_project_install_locks(
			&source(),
			&[update("alpha", "alpha-hash")],
			dir.path(),
		)
		.unwrap_err();

		assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
		assert!(path.is_dir());
	}
}
