//! Git clone and remote inspection operations.

use std::path::Path;

use gix::clone::PrepareFetch;
use gix::create::Kind;
use tempfile::TempDir;

use crate::credentials::Credentials;
use crate::error::{GitError, Result};
use crate::remote::{resolve_remote_url, RemoteOptions};

/// Options for clone operations.
#[derive(Debug, Clone)]
pub struct CloneOptions<'a> {
	/// Shared remote options.
	pub remote: RemoteOptions<'a>,
	/// Optional branch to check out.
	pub branch: Option<&'a str>,
}

impl<'a> CloneOptions<'a> {
	/// Create clone options for a repository URL.
	pub fn new(url: &'a str) -> Self {
		Self {
			remote: RemoteOptions::new(url),
			branch: None,
		}
	}

	/// Check out a specific branch after cloning.
	pub fn with_branch(mut self, branch: &'a str) -> Self {
		self.branch = Some(branch);
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
/// Uses explicit credentials from [`CloneOptions`] when present,
/// otherwise falls back to `GIT_USERNAME` and `GIT_PASSWORD`.
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
	let url = resolve_remote_url(&options.remote, true)?;
	let temp_dir =
		TempDir::new().map_err(|e| GitError::TempDirFailed(e.to_string()))?;
	clone_into(url.as_str(), temp_dir.path(), options.branch)?;
	Ok(temp_dir)
}

/// Clone a repository to a specific path.
pub fn clone_to_path(dest: &Path, options: CloneOptions<'_>) -> Result<()> {
	let url = resolve_remote_url(&options.remote, true)?;
	clone_into(url.as_str(), dest, options.branch)
}

fn clone_into(url: &str, dest: &Path, branch: Option<&str>) -> Result<()> {
	let prep = prepare_fetch(url, dest, branch)
		.map_err(|e| GitError::destination_error(dest, e.to_string()))?;
	run_checkout(prep)
}

fn prepare_fetch(
	url: &str,
	dest: &Path,
	branch: Option<&str>,
) -> Result<PrepareFetch> {
	let prep = PrepareFetch::new(
		url,
		dest,
		Kind::WithWorktree,
		Default::default(),
		Default::default(),
	)
	.map_err(|e| GitError::clone_failed(e.to_string()))?;

	match branch {
		Some(branch) => prep.with_ref_name(Some(branch)).map_err(
			|e: gix::refs::name::Error| {
				GitError::clone_failed(format!(
					"Invalid branch name '{branch}': {e}"
				))
			},
		),
		None => Ok(prep),
	}
}

fn run_checkout(mut prep: PrepareFetch) -> Result<()> {
	let (mut checkout, _) = prep
		.fetch_then_checkout(
			gix::progress::Discard,
			&gix::interrupt::IS_INTERRUPTED,
		)
		.map_err(|e| GitError::clone_failed(format!("Fetch failed: {e}")))?;

	checkout
		.main_worktree(gix::progress::Discard, &gix::interrupt::IS_INTERRUPTED)
		.map_err(|e| GitError::clone_failed(format!("Checkout failed: {e}")))?;

	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::process::Command;
	use std::sync::{Mutex, OnceLock};

	fn env_lock() -> &'static Mutex<()> {
		static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
		LOCK.get_or_init(|| Mutex::new(()))
	}

	#[test]
	fn test_clone_public_repo() {
		let _guard = env_lock().lock().unwrap_or_else(|e| e.into_inner());
		let result = clone_to_temp(CloneOptions::new(
			"https://github.com/octocat/Hello-World.git",
		));
		if let Ok(temp_dir) = result {
			assert!(temp_dir.path().exists());
			assert!(
				temp_dir.path().join(".git").exists()
					|| temp_dir.path().join("README").exists()
			);
		}
	}

	#[test]
	fn test_clone_public_repo_branch() {
		let _guard = env_lock().lock().unwrap_or_else(|e| e.into_inner());
		let result = clone_to_temp(
			CloneOptions::new("https://github.com/octocat/Hello-World.git")
				.with_branch("master"),
		);
		if let Ok(temp_dir) = result {
			let output = Command::new("git")
				.args(["rev-parse", "--abbrev-ref", "HEAD"])
				.current_dir(temp_dir.path())
				.output()
				.unwrap();
			assert!(output.status.success());
			assert_eq!(
				String::from_utf8_lossy(&output.stdout).trim(),
				"master",
			);
		}
	}
}
