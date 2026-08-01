pub mod global;
mod io;
pub mod local;
mod types;

use std::{
	fs::File,
	path::{Path, PathBuf},
	sync::{Mutex, MutexGuard},
};

#[cfg(test)]
pub(crate) mod test_utils;

static LOCK_MUTATION_MUTEX: Mutex<()> = Mutex::new(());
static SKILL_PATH_TRANSACTION_MUTEX: Mutex<()> = Mutex::new(());

pub(crate) struct LockMutationGuard {
	_sidecar: File,
	_process: MutexGuard<'static, ()>,
}

pub(crate) fn mutation_guard(
	target: &Path,
) -> std::io::Result<LockMutationGuard> {
	let process = LOCK_MUTATION_MUTEX.lock().map_err(|_| {
		std::io::Error::other("skill lock mutation mutex poisoned")
	})?;
	let sidecar = io::lock_sidecar(target)?;
	Ok(LockMutationGuard {
		_sidecar: sidecar,
		_process: process,
	})
}

/// Locks skill paths in a stable order until the returned transaction drops.
pub struct SkillPathTransaction {
	_sidecars: Vec<File>,
	_process: MutexGuard<'static, ()>,
}

/// Begin a filesystem transaction spanning one or more skill paths.
pub fn lock_skill_paths<'a>(
	paths: impl IntoIterator<Item = &'a Path>,
) -> std::io::Result<SkillPathTransaction> {
	let process = SKILL_PATH_TRANSACTION_MUTEX.lock().map_err(|_| {
		std::io::Error::other("skill path transaction mutex poisoned")
	})?;
	let mut paths = paths
		.into_iter()
		.map(skill_path_lock_identity)
		.collect::<std::io::Result<Vec<_>>>()?;
	paths.sort();
	paths.dedup();
	let mut sidecars = Vec::with_capacity(paths.len());
	for path in paths {
		sidecars.push(io::lock_skill_path_sidecar(&path)?);
	}
	Ok(SkillPathTransaction {
		_sidecars: sidecars,
		_process: process,
	})
}

fn skill_path_lock_identity(path: &Path) -> std::io::Result<PathBuf> {
	let absolute = if path.is_absolute() {
		path.to_path_buf()
	} else {
		std::env::current_dir()?.join(path)
	};
	let file_name = absolute.file_name().ok_or_else(|| {
		std::io::Error::new(
			std::io::ErrorKind::InvalidInput,
			format!("Skill path '{}' has no file name", path.display()),
		)
	})?;
	let parent = absolute.parent().ok_or_else(|| {
		std::io::Error::new(
			std::io::ErrorKind::InvalidInput,
			format!("Skill path '{}' has no parent", path.display()),
		)
	})?;
	let mut unresolved = Vec::new();
	let mut existing = parent;
	let canonical_parent = loop {
		match std::fs::canonicalize(existing) {
			Ok(canonical) => break canonical,
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
				let component = existing.file_name().ok_or(error)?;
				unresolved.push(component.to_os_string());
				existing = existing.parent().ok_or_else(|| {
					std::io::Error::new(
						std::io::ErrorKind::NotFound,
						format!(
							"No existing parent for skill path '{}'",
							path.display()
						),
					)
				})?;
			}
			Err(error) => return Err(error),
		}
	};
	let mut identity = canonical_parent;
	for component in unresolved.iter().rev() {
		identity.push(component);
	}
	identity.push(file_name);
	Ok(identity)
}

/// Return the filesystem entry guarded for a parsed skill path.
pub fn skill_transaction_path(path: &Path) -> PathBuf {
	let is_instruction_file = path
		.file_name()
		.and_then(|name| name.to_str())
		.is_some_and(|name| name.eq_ignore_ascii_case("skill.md"));
	if is_instruction_file {
		path.parent().unwrap_or(path).to_path_buf()
	} else {
		path.to_path_buf()
	}
}

// Re-export public API
pub use global::{
	add_skill_to_lock, dismiss_prompt, get_all_locked_skills,
	get_last_selected_agents, get_skill_from_lock, get_skills_by_source,
	is_prompt_dismissed, remove_skill_from_lock, save_selected_agents,
};
pub use io::{get_skill_lock_path, read_skill_lock, write_skill_lock};
pub use types::{DismissedPrompts, SkillLockEntry, SkillLockFile};

#[cfg(test)]
mod tests {
	use super::{
		global, local, lock_skill_paths, skill_path_lock_identity,
		skill_transaction_path, SkillLockEntry,
	};
	use crate::lock::test_utils::TestLockGuard;
	use std::{
		path::{Path, PathBuf},
		process::{Child, Command},
		thread,
		time::{Duration, Instant},
	};
	use tempfile::TempDir;

	const CHILD_COUNT: usize = 6;
	const CHILD_MODE: &str = "AGHUB_LOCK_TEST_CHILD_MODE";
	const CHILD_ROOT: &str = "AGHUB_LOCK_TEST_ROOT";
	const CHILD_ENTRY: &str = "AGHUB_LOCK_TEST_ENTRY";
	const CHILD_READY: &str = "AGHUB_LOCK_TEST_READY";
	const CHILD_RELEASE: &str = "AGHUB_LOCK_TEST_RELEASE";
	const CHILD_TEST: &str = "lock::tests::cross_process_lock_mutation_child";

	#[test]
	fn instruction_file_uses_its_skill_directory_transaction() {
		assert_eq!(
			skill_transaction_path(Path::new("skills/demo/SKILL.md")),
			Path::new("skills/demo")
		);
		assert_eq!(
			skill_transaction_path(Path::new("skills/demo/skill.md")),
			Path::new("skills/demo")
		);
		assert_eq!(
			skill_transaction_path(Path::new("skills/demo.md")),
			Path::new("skills/demo.md")
		);
	}

	#[cfg(unix)]
	#[test]
	fn transaction_identity_resolves_symlinked_parent_directories() {
		let root = TempDir::new().unwrap();
		let physical = root.path().join("physical");
		let alias = root.path().join("alias");
		std::fs::create_dir(&physical).unwrap();
		std::os::unix::fs::symlink(&physical, &alias).unwrap();

		assert_eq!(
			skill_path_lock_identity(&alias.join("demo")).unwrap(),
			skill_path_lock_identity(&physical.join("demo")).unwrap()
		);
	}

	fn global_entry() -> SkillLockEntry {
		SkillLockEntry {
			source: "owner/repo".to_string(),
			source_type: "github".to_string(),
			source_url: "https://github.com/owner/repo".to_string(),
			ref_name: None,
			skill_path: None,
			skill_folder_hash: "hash".to_string(),
			installed_at: "2026-01-01T00:00:00Z".to_string(),
			updated_at: "2026-01-01T00:00:00Z".to_string(),
			plugin_name: None,
		}
	}

	fn local_entry() -> local::LocalSkillLockEntry {
		local::LocalSkillLockEntry {
			source: "owner/repo".to_string(),
			ref_name: None,
			source_type: "github".to_string(),
			computed_hash: "hash".to_string(),
		}
	}

	fn child_barrier(entry: &str) {
		let ready = PathBuf::from(std::env::var_os(CHILD_READY).unwrap());
		let release = PathBuf::from(std::env::var_os(CHILD_RELEASE).unwrap());
		std::fs::write(ready.join(entry), []).unwrap();
		let deadline = Instant::now() + Duration::from_secs(10);
		while !release.exists() {
			assert!(Instant::now() < deadline, "parent did not release child");
			thread::sleep(Duration::from_millis(5));
		}
	}

	#[test]
	fn cross_process_lock_mutation_child() {
		let Some(mode) = std::env::var_os(CHILD_MODE) else {
			return;
		};
		let root = PathBuf::from(std::env::var_os(CHILD_ROOT).unwrap());
		let entry = std::env::var(CHILD_ENTRY).unwrap();
		match mode.to_str().unwrap() {
			"global" => {
				std::env::set_var("XDG_STATE_HOME", &root);
				global::mutate_skill_lock(|lock| {
					child_barrier(&entry);
					lock.skills.insert(entry, global_entry());
				})
				.unwrap();
			}
			"project" => {
				local::mutate_local_lock(Some(&root), |lock| {
					child_barrier(&entry);
					lock.skills.insert(entry, local_entry());
				})
				.unwrap();
			}
			"path" => {
				let target = root.join("skill");
				let _transaction =
					lock_skill_paths([target.as_path()]).unwrap();
				child_barrier(&entry);
			}
			other => panic!("unexpected child mode: {other}"),
		}
	}

	fn spawn_mutation_children(
		mode: &str,
		root: &Path,
		barrier: &Path,
	) -> Vec<Child> {
		let ready = barrier.join("ready");
		let release = barrier.join("release");
		std::fs::create_dir(&ready).unwrap();
		(0..CHILD_COUNT)
			.map(|index| {
				Command::new(std::env::current_exe().unwrap())
					.args(["--exact", CHILD_TEST])
					.env(CHILD_MODE, mode)
					.env(CHILD_ROOT, root)
					.env(CHILD_ENTRY, format!("skill-{index}"))
					.env(CHILD_READY, &ready)
					.env(CHILD_RELEASE, &release)
					.spawn()
					.unwrap()
			})
			.collect()
	}

	fn release_children(barrier: &Path) {
		let ready = barrier.join("ready");
		let first_ready_deadline = Instant::now() + Duration::from_secs(10);
		while ready.read_dir().unwrap().next().is_none() {
			assert!(
				Instant::now() < first_ready_deadline,
				"no mutation child reached the barrier"
			);
			thread::sleep(Duration::from_millis(5));
		}
		thread::sleep(Duration::from_millis(500));
		assert_eq!(ready.read_dir().unwrap().count(), 1);
		std::fs::write(barrier.join("release"), []).unwrap();
	}

	fn wait_for_children(mut children: Vec<Child>) {
		let deadline = Instant::now() + Duration::from_secs(10);
		let mut complete = vec![false; children.len()];
		while complete.iter().any(|done| !done) {
			for (child, done) in children.iter_mut().zip(&mut complete) {
				if *done {
					continue;
				}
				if let Some(status) = child.try_wait().unwrap() {
					assert!(
						status.success(),
						"mutation child failed: {status}"
					);
					*done = true;
				}
			}
			if Instant::now() >= deadline {
				for (child, done) in children.iter_mut().zip(&complete) {
					if !done {
						let _ = child.kill();
						let _ = child.wait();
					}
				}
				panic!("mutation children did not exit");
			}
			thread::sleep(Duration::from_millis(5));
		}
	}

	fn run_mutation_children(mode: &str, root: &Path) {
		let barrier = TempDir::new().unwrap();
		let children = spawn_mutation_children(mode, root, barrier.path());
		release_children(barrier.path());
		wait_for_children(children);
	}

	#[test]
	fn cross_process_global_mutations_do_not_lose_entries() {
		let _guard = TestLockGuard::new();
		let root = PathBuf::from(std::env::var_os("XDG_STATE_HOME").unwrap());

		run_mutation_children("global", &root);

		assert_eq!(global::read_skill_lock().skills.len(), CHILD_COUNT);
	}

	#[test]
	fn cross_process_project_mutations_do_not_lose_entries() {
		let root = TempDir::new().unwrap();

		run_mutation_children("project", root.path());

		assert_eq!(
			local::read_local_lock(Some(root.path())).skills.len(),
			CHILD_COUNT
		);
	}

	#[test]
	fn cross_process_skill_path_transactions_are_serialized() {
		let root = TempDir::new().unwrap();

		run_mutation_children("path", root.path());
	}
}
