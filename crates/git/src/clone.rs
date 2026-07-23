//! Git clone operations with bounded child-process execution.

use std::{
	ffi::OsStr, path::Path, process::Stdio, sync::atomic::AtomicBool,
	time::Duration,
};

use tempfile::TempDir;

use crate::{
	command::{command_failed, git_command, spawn_git, wait_for_git},
	credentials::Credentials,
	error::{GitError, Result},
	remote::{validated_remote_url, RemoteOptions},
};

const DEFAULT_CLONE_TIMEOUT: Duration = Duration::from_secs(300);
const DEFAULT_CLONE_ENTRIES: usize = 200_000;
const DEFAULT_CLONE_BYTES: u64 = 512 * 1024 * 1024;
const CLONE_INSPECTION_INTERVAL: Duration = Duration::from_millis(250);

/// Runtime and output bounds for a clone operation.
#[derive(Debug, Clone, Copy)]
pub struct CloneLimits {
	/// Maximum wall-clock time for the Git child.
	pub timeout: Duration,
	/// Maximum entries allowed in the destination while cloning.
	pub max_entries: usize,
	/// Maximum logical file bytes allowed in the destination while cloning.
	pub max_bytes: u64,
}

struct CloneInvocation<'a> {
	url: &'a str,
	dest: &'a Path,
	branch: Option<&'a str>,
	depth: Option<std::num::NonZeroU32>,
	credentials: Option<&'a Credentials>,
	limits: CloneLimits,
}

impl CloneLimits {
	/// Create explicit clone bounds.
	pub fn new(timeout: Duration, max_entries: usize, max_bytes: u64) -> Self {
		Self {
			timeout,
			max_entries,
			max_bytes,
		}
	}
}

impl Default for CloneLimits {
	fn default() -> Self {
		Self::new(
			DEFAULT_CLONE_TIMEOUT,
			DEFAULT_CLONE_ENTRIES,
			DEFAULT_CLONE_BYTES,
		)
	}
}

/// Options for clone operations.
#[derive(Debug, Clone)]
pub struct CloneOptions<'a> {
	/// Shared remote options.
	pub remote: RemoteOptions<'a>,
	/// Optional branch to check out.
	pub branch: Option<&'a str>,
	/// Optional shallow clone depth.
	pub depth: Option<std::num::NonZeroU32>,
}

impl<'a> CloneOptions<'a> {
	/// Create clone options for a repository URL.
	pub fn new(url: &'a str) -> Self {
		Self {
			remote: RemoteOptions::new(url),
			branch: None,
			depth: None,
		}
	}

	/// Check out a specific branch after cloning.
	pub fn with_branch(mut self, branch: &'a str) -> Self {
		self.branch = Some(branch);
		self
	}

	/// Limit fetched history to the given non-zero commit depth.
	pub fn with_depth(mut self, depth: std::num::NonZeroU32) -> Self {
		self.depth = Some(depth);
		self
	}

	/// Attach explicit credentials to the clone.
	pub fn with_credentials(
		mut self,
		username: impl Into<String>,
		password: impl Into<String>,
	) -> Self {
		self.remote = self.remote.with_credentials(username, password);
		self
	}

	/// Attach an existing credentials value to the clone.
	pub fn with_auth(mut self, credentials: Credentials) -> Self {
		self.remote = self.remote.with_auth(credentials);
		self
	}
}

/// Clone a repository into a temporary directory.
///
/// Uses only explicit credentials from [`CloneOptions`].
///
/// ```rust,no_run
/// use aghub_git::{clone_to_temp, CloneOptions};
///
/// let temp_dir = clone_to_temp(
///     CloneOptions::new("https://github.com/user/repo.git")
///         .with_branch("main")
/// ).unwrap();
///
/// println!("Cloned to: {}", temp_dir.path().display());
/// ```
pub fn clone_to_temp(options: CloneOptions<'_>) -> Result<TempDir> {
	let should_interrupt = AtomicBool::new(false);
	clone_to_temp_bounded(options, CloneLimits::default(), &should_interrupt)
}

/// Clone into a temporary directory with a caller-owned cancellation flag.
pub fn clone_to_temp_with_interrupt(
	options: CloneOptions<'_>,
	should_interrupt: &AtomicBool,
) -> Result<TempDir> {
	clone_to_temp_bounded(options, CloneLimits::default(), should_interrupt)
}

/// Clone into a temporary directory with explicit runtime and disk bounds.
pub fn clone_to_temp_bounded(
	options: CloneOptions<'_>,
	limits: CloneLimits,
	should_interrupt: &AtomicBool,
) -> Result<TempDir> {
	let url = validated_remote_url(&options.remote)?;
	let temp_dir =
		TempDir::new().map_err(|e| GitError::TempDirFailed(e.to_string()))?;
	run_clone(
		OsStr::new("git"),
		CloneInvocation {
			url: &url,
			dest: temp_dir.path(),
			branch: options.branch,
			depth: options.depth,
			credentials: options.remote.credentials.as_ref(),
			limits,
		},
		should_interrupt,
	)?;
	Ok(temp_dir)
}

/// Clone a repository to a specific path.
pub fn clone_to_path(dest: &Path, options: CloneOptions<'_>) -> Result<()> {
	let should_interrupt = AtomicBool::new(false);
	clone_to_path_bounded(
		dest,
		options,
		CloneLimits::default(),
		&should_interrupt,
	)
}

/// Clone to a specific path with explicit runtime and disk bounds.
pub fn clone_to_path_bounded(
	dest: &Path,
	options: CloneOptions<'_>,
	limits: CloneLimits,
	should_interrupt: &AtomicBool,
) -> Result<()> {
	let url = validated_remote_url(&options.remote)?;
	run_clone(
		OsStr::new("git"),
		CloneInvocation {
			url: &url,
			dest,
			branch: options.branch,
			depth: options.depth,
			credentials: options.remote.credentials.as_ref(),
			limits,
		},
		should_interrupt,
	)
}

fn run_clone(
	program: &OsStr,
	invocation: CloneInvocation<'_>,
	should_interrupt: &AtomicBool,
) -> Result<()> {
	if should_interrupt.load(std::sync::atomic::Ordering::Acquire) {
		return Err(GitError::Cancelled);
	}

	let command_dir = TempDir::new()
		.map_err(|error| GitError::TempDirFailed(error.to_string()))?;
	let mut command =
		git_command(program, invocation.url, invocation.credentials);
	command.current_dir(command_dir.path()).arg("clone");
	if let Some(depth) = invocation.depth {
		command
			.arg("--depth")
			.arg(depth.get().to_string())
			.arg("--single-branch");
	}
	if let Some(branch) = invocation.branch {
		command.arg("--branch").arg(branch);
	}
	command
		.arg("--")
		.arg(invocation.url)
		.arg(invocation.dest)
		.stdout(Stdio::null())
		.stderr(Stdio::null());

	let mut child = spawn_git(&mut command).map_err(|error| {
		GitError::destination_error(
			invocation.dest,
			format!("Failed to start Git: {error}"),
		)
	})?;
	let mut last_inspection = None;
	let status = wait_for_git(
		&mut child,
		invocation.limits.timeout,
		should_interrupt,
		|| {
			if last_inspection.is_some_and(|last: std::time::Instant| {
				last.elapsed() < CLONE_INSPECTION_INTERVAL
			}) {
				return Ok(true);
			}
			last_inspection = Some(std::time::Instant::now());
			ensure_clone_tree_within(invocation.dest, invocation.limits)?;
			Ok(true)
		},
	)?;
	ensure_clone_tree_within(invocation.dest, invocation.limits)?;
	if !status.success() {
		return Err(command_failed("clone", status));
	}
	Ok(())
}

fn ensure_clone_tree_within(root: &Path, limits: CloneLimits) -> Result<()> {
	let mut pending = vec![root.to_path_buf()];
	let mut entries = 0_usize;
	let mut bytes = 0_u64;
	while let Some(dir) = pending.pop() {
		let children = match std::fs::read_dir(&dir) {
			Ok(children) => children,
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
				continue
			}
			Err(error) => return Err(error.into()),
		};
		for entry in children {
			let entry = match entry {
				Ok(entry) => entry,
				Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
					continue
				}
				Err(error) => return Err(error.into()),
			};
			entries =
				entries.checked_add(1).ok_or(GitError::CloneEntryLimit {
					limit: limits.max_entries,
				})?;
			if entries > limits.max_entries {
				return Err(GitError::CloneEntryLimit {
					limit: limits.max_entries,
				});
			}
			let metadata = match std::fs::symlink_metadata(entry.path()) {
				Ok(metadata) => metadata,
				Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
					continue
				}
				Err(error) => return Err(error.into()),
			};
			if metadata.is_dir() {
				pending.push(entry.path());
			} else if metadata.is_file() {
				bytes = bytes.checked_add(metadata.len()).ok_or(
					GitError::CloneByteLimit {
						limit: limits.max_bytes,
					},
				)?;
				if bytes > limits.max_bytes {
					return Err(GitError::CloneByteLimit {
						limit: limits.max_bytes,
					});
				}
			}
		}
	}
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::{process::Command, sync::atomic::AtomicBool, time::Duration};

	#[cfg(unix)]
	use std::{
		os::unix::fs::PermissionsExt,
		path::PathBuf,
		sync::{atomic::Ordering, Arc},
		thread,
		time::Instant,
	};

	// Process startup can stall while multi-target CI builds share a runner.
	#[cfg(unix)]
	const TEST_PROCESS_START_TIMEOUT: Duration = Duration::from_secs(10);

	#[cfg(unix)]
	fn write_script(root: &Path, body: &str) -> PathBuf {
		let path = root.join("git");
		std::fs::write(&path, format!("#!/bin/sh\nset -eu\n{body}\n")).unwrap();
		let mut permissions = std::fs::metadata(&path).unwrap().permissions();
		permissions.set_mode(0o700);
		std::fs::set_permissions(&path, permissions).unwrap();
		path
	}

	#[cfg(unix)]
	fn wait_for_pid(path: &Path) -> i32 {
		let started = Instant::now();
		loop {
			if let Ok(value) = std::fs::read_to_string(path) {
				return value.trim().parse().unwrap();
			}
			assert!(
				started.elapsed() < TEST_PROCESS_START_TIMEOUT,
				"fake Git did not publish its worker pid within {TEST_PROCESS_START_TIMEOUT:?}"
			);
			thread::sleep(Duration::from_millis(10));
		}
	}

	#[cfg(unix)]
	fn assert_process_gone(pid: i32) {
		let result = unsafe { libc::kill(pid, 0) };
		assert_eq!(result, -1);
		assert_eq!(
			std::io::Error::last_os_error().raw_os_error(),
			Some(libc::ESRCH),
		);
	}

	#[cfg(unix)]
	#[test]
	fn fake_git_receives_shallow_args_and_header_outside_argv() {
		let root = tempfile::TempDir::new().unwrap();
		let script = write_script(
			root.path(),
			r#"
root=$(dirname "$0")
printf '%s\n' "$@" > "$root/args"
printf '%s|%s\n' "${GIT_USERNAME-unset}" \
  "${GIT_PASSWORD-unset}" > "$root/ambient"
index=0
while [ "$index" -lt "$GIT_CONFIG_COUNT" ]; do
  key=$(printenv "GIT_CONFIG_KEY_$index")
  value=$(printenv "GIT_CONFIG_VALUE_$index")
  if [ "$key" = \
    "http.https://github.com/owner/repo.git.extraHeader" ]; then
    printf '%s=%s\n' "$key" "$value" > "$root/header"
  fi
  index=$((index + 1))
done
for argument in "$@"; do destination=$argument; done
mkdir -p "$destination"
"#,
		);
		let destination = root.path().join("clone");
		let credentials = Credentials::new("git-user", "secret-token");
		let cancelled = AtomicBool::new(false);

		run_clone(
			script.as_os_str(),
			CloneInvocation {
				url: "https://github.com/owner/repo.git",
				dest: &destination,
				branch: Some("main"),
				depth: std::num::NonZeroU32::new(1),
				credentials: Some(&credentials),
				limits: CloneLimits::new(Duration::from_secs(2), 100, 1024),
			},
			&cancelled,
		)
		.unwrap();

		let args = std::fs::read_to_string(root.path().join("args")).unwrap();
		assert!(args.contains("--depth\n1\n"));
		assert!(args.contains("--single-branch\n"));
		assert!(args.contains("--branch\nmain\n"));
		assert!(!args.contains("secret-token"));
		assert_eq!(
			std::fs::read_to_string(root.path().join("ambient")).unwrap(),
			"unset|unset\n",
		);
		let header =
			std::fs::read_to_string(root.path().join("header")).unwrap();
		assert_eq!(
			header,
			"http.https://github.com/owner/repo.git.extraHeader=\
			Authorization: Basic Z2l0LXVzZXI6c2VjcmV0LXRva2Vu\n",
		);
	}

	#[cfg(unix)]
	#[test]
	fn fake_git_preserves_full_clone_when_depth_is_absent() {
		let root = tempfile::TempDir::new().unwrap();
		let script = write_script(
			root.path(),
			r#"
root=$(dirname "$0")
printf '%s\n' "$@" > "$root/args"
for argument in "$@"; do destination=$argument; done
mkdir -p "$destination"
"#,
		);
		let destination = root.path().join("clone");
		let cancelled = AtomicBool::new(false);

		run_clone(
			script.as_os_str(),
			CloneInvocation {
				url: "https://github.com/owner/repo.git",
				dest: &destination,
				branch: None,
				depth: None,
				credentials: None,
				limits: CloneLimits::new(Duration::from_secs(2), 100, 1024),
			},
			&cancelled,
		)
		.unwrap();

		let args = std::fs::read_to_string(root.path().join("args")).unwrap();
		assert!(!args.contains("--depth\n"));
		assert!(!args.contains("--single-branch\n"));
	}

	#[cfg(unix)]
	#[test]
	fn cancellation_kills_and_waits_for_fake_git() {
		let root = tempfile::TempDir::new().unwrap();
		let script = write_script(
			root.path(),
			r#"
root=$(dirname "$0")
printf '%s' "$$" > "$root/pid"
for argument in "$@"; do destination=$argument; done
mkdir -p "$destination"
while :; do sleep 1; done
"#,
		);
		let destination = root.path().join("clone");
		let cancelled = Arc::new(AtomicBool::new(false));
		let task_cancelled = Arc::clone(&cancelled);
		let task = thread::spawn(move || {
			run_clone(
				script.as_os_str(),
				CloneInvocation {
					url: "https://github.com/owner/repo.git",
					dest: &destination,
					branch: None,
					depth: None,
					credentials: None,
					limits: CloneLimits::new(Duration::from_secs(2), 100, 1024),
				},
				&task_cancelled,
			)
		});
		let pid = wait_for_pid(&root.path().join("pid"));
		cancelled.store(true, Ordering::Release);

		assert!(matches!(task.join().unwrap(), Err(GitError::Cancelled)));
		assert_process_gone(pid);
	}

	#[cfg(unix)]
	#[test]
	fn clone_byte_cap_kills_and_waits_for_fake_git() {
		let root = tempfile::TempDir::new().unwrap();
		let script = write_script(
			root.path(),
			r#"
root=$(dirname "$0")
printf '%s' "$$" > "$root/pid"
for argument in "$@"; do destination=$argument; done
mkdir -p "$destination"
dd if=/dev/zero of="$destination/blob" bs=1024 count=32 2>/dev/null
while :; do sleep 1; done
"#,
		);
		let destination = root.path().join("clone");
		let cancelled = AtomicBool::new(false);
		let error = run_clone(
			script.as_os_str(),
			CloneInvocation {
				url: "https://github.com/owner/repo.git",
				dest: &destination,
				branch: None,
				depth: None,
				credentials: None,
				limits: CloneLimits::new(Duration::from_secs(2), 100, 1024),
			},
			&cancelled,
		)
		.unwrap_err();
		let pid = wait_for_pid(&root.path().join("pid"));

		assert!(matches!(error, GitError::CloneByteLimit { limit: 1024 }));
		assert_process_gone(pid);
	}

	#[cfg(unix)]
	#[test]
	fn clone_entry_cap_kills_and_waits_for_fake_git() {
		let root = tempfile::TempDir::new().unwrap();
		let script = write_script(
			root.path(),
			r#"
root=$(dirname "$0")
printf '%s' "$$" > "$root/pid"
for argument in "$@"; do destination=$argument; done
mkdir -p "$destination"
touch "$destination/one" "$destination/two" "$destination/three"
while :; do sleep 1; done
"#,
		);
		let destination = root.path().join("clone");
		let cancelled = AtomicBool::new(false);
		let error = run_clone(
			script.as_os_str(),
			CloneInvocation {
				url: "https://github.com/owner/repo.git",
				dest: &destination,
				branch: None,
				depth: None,
				credentials: None,
				limits: CloneLimits::new(Duration::from_secs(2), 2, 1024),
			},
			&cancelled,
		)
		.unwrap_err();
		let pid = wait_for_pid(&root.path().join("pid"));

		assert!(matches!(error, GitError::CloneEntryLimit { limit: 2 }));
		assert_process_gone(pid);
	}

	#[test]
	fn controlled_git_clones_a_local_repository() {
		let root = tempfile::TempDir::new().unwrap();
		let source = root.path().join("source");
		let destination = root.path().join("clone");
		std::fs::create_dir(&source).unwrap();
		assert!(Command::new("git")
			.args(["init", "--initial-branch", "main"])
			.current_dir(&source)
			.status()
			.unwrap()
			.success());
		std::fs::write(source.join("README.md"), "local fixture\n").unwrap();
		assert!(Command::new("git")
			.args(["add", "README.md"])
			.current_dir(&source)
			.status()
			.unwrap()
			.success());
		assert!(Command::new("git")
			.args([
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@example.com",
				"commit",
				"-m",
				"fixture",
			])
			.current_dir(&source)
			.status()
			.unwrap()
			.success());
		let cancelled = AtomicBool::new(false);

		run_clone(
			OsStr::new("git"),
			CloneInvocation {
				url: source.to_str().unwrap(),
				dest: &destination,
				branch: Some("main"),
				depth: None,
				credentials: None,
				limits: CloneLimits::new(
					Duration::from_secs(5),
					100,
					1024 * 1024,
				),
			},
			&cancelled,
		)
		.unwrap();

		assert_eq!(
			std::fs::read_to_string(destination.join("README.md")).unwrap(),
			"local fixture\n",
		);
	}
}
