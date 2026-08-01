//! Remote Git URL validation and bounded ref discovery.

use std::{
	ffi::OsStr,
	io::Read,
	process::Stdio,
	sync::{
		atomic::AtomicBool,
		mpsc::{self, TryRecvError},
	},
	thread,
	time::Duration,
};

use crate::{
	command::{
		command_failed, git_command, spawn_git, terminate_and_wait,
		wait_for_git,
	},
	credentials::Credentials,
	error::{GitError, Result},
};

const DEFAULT_REMOTE_TIMEOUT: Duration = Duration::from_secs(300);
const DEFAULT_REMOTE_OUTPUT_BYTES: usize = 1024 * 1024;
const DEFAULT_REMOTE_BRANCHES: usize = 2_048;

/// Runtime and output bounds for remote branch discovery.
#[derive(Debug, Clone, Copy)]
pub struct RemoteLimits {
	/// Maximum wall-clock time for the Git child.
	pub timeout: Duration,
	/// Maximum stdout bytes accepted from `git ls-remote`.
	pub max_output_bytes: usize,
	/// Maximum advertised branch refs accepted from the remote.
	pub max_branches: usize,
}

impl RemoteLimits {
	/// Create explicit remote discovery bounds.
	pub fn new(
		timeout: Duration,
		max_output_bytes: usize,
		max_branches: usize,
	) -> Self {
		Self {
			timeout,
			max_output_bytes,
			max_branches,
		}
	}
}

impl Default for RemoteLimits {
	fn default() -> Self {
		Self::new(
			DEFAULT_REMOTE_TIMEOUT,
			DEFAULT_REMOTE_OUTPUT_BYTES,
			DEFAULT_REMOTE_BRANCHES,
		)
	}
}

/// Options shared by remote Git operations.
#[derive(Debug, Clone)]
pub struct RemoteOptions<'a> {
	/// HTTPS URL of the Git repository.
	pub url: &'a str,
	/// Explicit credentials for the operation.
	pub credentials: Option<Credentials>,
}

impl<'a> RemoteOptions<'a> {
	/// Create options for a repository URL.
	pub fn new(url: &'a str) -> Self {
		Self {
			url,
			credentials: None,
		}
	}

	/// Attach explicit credentials to the operation.
	pub fn with_credentials(
		mut self,
		username: impl Into<String>,
		password: impl Into<String>,
	) -> Self {
		self.credentials = Some(Credentials::new(username, password));
		self
	}

	/// Attach an existing credentials value to the operation.
	pub fn with_auth(mut self, credentials: Credentials) -> Self {
		self.credentials = Some(credentials);
		self
	}
}

/// List remote branches with default runtime and output bounds.
pub fn list_remote_branches(options: RemoteOptions<'_>) -> Result<Vec<String>> {
	let cancelled = AtomicBool::new(false);
	list_remote_branches_bounded(options, RemoteLimits::default(), &cancelled)
}

/// List remote branches with caller-owned bounds and cancellation.
pub fn list_remote_branches_bounded(
	options: RemoteOptions<'_>,
	limits: RemoteLimits,
	cancelled: &AtomicBool,
) -> Result<Vec<String>> {
	let url = validated_remote_url(&options)?;
	list_remote_branches_with_program(
		OsStr::new("git"),
		&url,
		options.credentials.as_ref(),
		limits,
		cancelled,
	)
}

pub(crate) fn validated_remote_url(
	options: &RemoteOptions<'_>,
) -> Result<String> {
	let parsed = url::Url::parse(options.url).map_err(GitError::from)?;
	if parsed.scheme() != "https" {
		return Err(GitError::not_https(options.url));
	}
	if !parsed.username().is_empty() || parsed.password().is_some() {
		return Err(GitError::invalid_url(
			"remote URL must not include credentials",
		));
	}
	if parsed.query().is_some() || parsed.fragment().is_some() {
		return Err(GitError::invalid_url(
			"remote URL must not include query or fragment data",
		));
	}
	Ok(options.url.to_string())
}

fn list_remote_branches_with_program(
	program: &OsStr,
	url: &str,
	credentials: Option<&Credentials>,
	limits: RemoteLimits,
	cancelled: &AtomicBool,
) -> Result<Vec<String>> {
	if cancelled.load(std::sync::atomic::Ordering::Acquire) {
		return Err(GitError::Cancelled);
	}

	let command_dir = tempfile::TempDir::new()
		.map_err(|error| GitError::TempDirFailed(error.to_string()))?;
	let mut command = git_command(program, url, credentials);
	command
		.current_dir(command_dir.path())
		.arg("ls-remote")
		.arg("--heads")
		.arg("--")
		.arg(url)
		.stdout(Stdio::piped())
		.stderr(Stdio::null());
	let mut child = spawn_git(&mut command)?;
	let stdout = child.take_stdout().expect("Git stdout was piped");
	let (sender, receiver) = mpsc::sync_channel(1);
	let reader = match thread::Builder::new()
		.name("git-ls-remote-reader".to_string())
		.spawn(move || {
			let result = read_bounded_branches(stdout, limits);
			let _ = sender.send(result);
		}) {
		Ok(reader) => reader,
		Err(error) => {
			terminate_and_wait(&mut child)?;
			return Err(error.into());
		}
	};

	let mut branches = None;
	let mut reader_done = false;
	let status = wait_for_git(&mut child, limits.timeout, cancelled, || {
		if reader_done {
			return Ok(true);
		}
		match receiver.try_recv() {
			Ok(Ok(result)) => {
				branches = Some(result);
				reader_done = true;
				Ok(true)
			}
			Ok(Err(error)) => Err(error),
			Err(TryRecvError::Empty) => Ok(false),
			Err(TryRecvError::Disconnected) => Err(GitError::clone_failed(
				"Git stdout reader stopped unexpectedly",
			)),
		}
	});

	let reader_result = reader.join();
	let status = match status {
		Ok(status) => status,
		Err(error) => {
			let _ = reader_result;
			return Err(error);
		}
	};
	reader_result.map_err(|_| {
		GitError::clone_failed("Git stdout reader stopped unexpectedly")
	})?;
	if !status.success() {
		return Err(command_failed("ls-remote", status));
	}
	let mut branches = match branches {
		Some(branches) => branches,
		None => receiver.recv().map_err(|_| {
			GitError::clone_failed("Git stdout reader stopped unexpectedly")
		})??,
	};
	branches.sort();
	branches.dedup();
	Ok(branches)
}

fn read_bounded_branches(
	mut stdout: impl Read,
	limits: RemoteLimits,
) -> Result<Vec<String>> {
	let mut branches = Vec::new();
	let mut line = Vec::new();
	let mut total_bytes = 0_usize;
	let mut buffer = [0_u8; 8 * 1024];
	loop {
		let read = stdout.read(&mut buffer)?;
		if read == 0 {
			break;
		}
		total_bytes = total_bytes
			.checked_add(read)
			.ok_or(GitError::RemoteOutputLimit)?;
		if total_bytes > limits.max_output_bytes {
			return Err(GitError::RemoteOutputLimit);
		}
		for byte in &buffer[..read] {
			if *byte == b'\n' {
				push_branch(&line, &mut branches, limits.max_branches)?;
				line.clear();
			} else {
				line.push(*byte);
			}
		}
	}
	if !line.is_empty() {
		push_branch(&line, &mut branches, limits.max_branches)?;
	}
	Ok(branches)
}

fn push_branch(
	line: &[u8],
	branches: &mut Vec<String>,
	max_branches: usize,
) -> Result<()> {
	let Some(separator) = line.iter().position(u8::is_ascii_whitespace) else {
		return Ok(());
	};
	let reference = line[separator..]
		.iter()
		.position(|byte| !byte.is_ascii_whitespace())
		.map(|offset| &line[separator + offset..])
		.unwrap_or_default();
	let reference = reference.strip_suffix(b"\r").unwrap_or(reference);
	let Some(branch) = reference.strip_prefix(b"refs/heads/") else {
		return Ok(());
	};
	if branches.len() >= max_branches {
		return Err(GitError::RemoteBranchLimit);
	}
	branches.push(String::from_utf8_lossy(branch).into_owned());
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	#[cfg(unix)]
	use std::{os::unix::fs::PermissionsExt, time::Instant};

	// Process startup can stall while multi-target CI builds share a runner.
	#[cfg(unix)]
	const TEST_PROCESS_START_TIMEOUT: Duration = Duration::from_secs(10);

	#[cfg(unix)]
	fn write_script(root: &std::path::Path, body: &str) -> std::path::PathBuf {
		let path = root.join("git");
		std::fs::write(&path, format!("#!/bin/sh\nset -eu\n{body}\n")).unwrap();
		let mut permissions = std::fs::metadata(&path).unwrap().permissions();
		permissions.set_mode(0o700);
		std::fs::set_permissions(&path, permissions).unwrap();
		path
	}

	#[cfg(unix)]
	fn wait_for_pid(path: &std::path::Path) -> i32 {
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
		let started = Instant::now();
		loop {
			let result = unsafe { libc::kill(pid, 0) };
			if result == -1
				&& std::io::Error::last_os_error().raw_os_error()
					== Some(libc::ESRCH)
			{
				return;
			}
			assert!(
				started.elapsed() < TEST_PROCESS_START_TIMEOUT,
				"worker process {pid} remained after Git cleanup"
			);
			thread::sleep(Duration::from_millis(10));
		}
	}

	#[test]
	fn bounded_reader_sorts_and_deduplicates_branches() {
		let refs = b"0\trefs/heads/release\n0\trefs/tags/v1\n\
			0\trefs/heads/main\n0\trefs/heads/main\n";
		let branches = read_bounded_branches(
			refs.as_slice(),
			RemoteLimits::new(Duration::from_secs(1), 1024, 8),
		)
		.unwrap();
		let mut branches = branches;
		branches.sort();
		branches.dedup();

		assert_eq!(branches, ["main", "release"]);
	}

	#[test]
	fn bounded_reader_rejects_output_cap() {
		let error = read_bounded_branches(
			b"0\trefs/heads/main\n".as_slice(),
			RemoteLimits::new(Duration::from_secs(1), 8, 8),
		)
		.unwrap_err();

		assert!(matches!(error, GitError::RemoteOutputLimit));
	}

	#[test]
	fn bounded_reader_rejects_branch_cap() {
		let error = read_bounded_branches(
			b"0\trefs/heads/main\n0\trefs/heads/next\n".as_slice(),
			RemoteLimits::new(Duration::from_secs(1), 1024, 1),
		)
		.unwrap_err();

		assert!(matches!(error, GitError::RemoteBranchLimit));
	}

	#[test]
	fn remote_url_rejects_query_and_fragment_data() {
		for url in [
			"https://github.com/owner/repo.git?token=secret",
			"https://github.com/owner/repo.git#secret",
		] {
			let error =
				validated_remote_url(&RemoteOptions::new(url)).unwrap_err();

			assert!(matches!(error, GitError::InvalidUrl(_)));
		}
	}

	#[cfg(unix)]
	#[test]
	fn stdout_cap_kills_and_waits_for_fake_git() {
		let root = tempfile::TempDir::new().unwrap();
		let script = write_script(
			root.path(),
			r#"
root=$(dirname "$0")
printf '%s' "$$" > "$root/pid"
while :; do
  printf '0000000000000000000000000000000000000000\trefs/heads/main\n'
done
"#,
		);
		let cancelled = AtomicBool::new(false);
		let error = list_remote_branches_with_program(
			script.as_os_str(),
			"https://github.com/owner/repo.git",
			None,
			RemoteLimits::new(Duration::from_secs(2), 128, 128),
			&cancelled,
		)
		.unwrap_err();
		let pid = wait_for_pid(&root.path().join("pid"));

		assert!(matches!(error, GitError::RemoteOutputLimit));
		let result = unsafe { libc::kill(pid, 0) };
		assert_eq!(result, -1);
		assert_eq!(
			std::io::Error::last_os_error().raw_os_error(),
			Some(libc::ESRCH),
		);
	}

	#[cfg(unix)]
	#[test]
	fn timeout_kills_stdout_holder_after_git_exits() {
		let root = tempfile::TempDir::new().unwrap();
		let script = write_script(
			root.path(),
			r#"
root=$(dirname "$0")
(while :; do sleep 1; done) &
printf '%s' "$!" > "$root/worker-pid"
				"#,
		);
		let mut command = git_command(
			script.as_os_str(),
			"https://github.com/owner/repo.git",
			None,
		);
		command.stdout(Stdio::piped()).stderr(Stdio::null());
		let mut child = spawn_git(&mut command).unwrap();
		let mut stdout = child.take_stdout().unwrap();
		let reader = thread::spawn(move || {
			let mut output = Vec::new();
			stdout.read_to_end(&mut output)
		});
		let worker_pid = wait_for_pid(&root.path().join("worker-pid"));
		let cancelled = AtomicBool::new(false);
		let error = wait_for_git(
			&mut child,
			Duration::from_secs(1),
			&cancelled,
			|| Ok(false),
		)
		.unwrap_err();
		reader.join().unwrap().unwrap();

		assert!(matches!(error, GitError::TimedOut));
		assert_process_gone(worker_pid);
	}
}
