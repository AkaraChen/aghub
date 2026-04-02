//! Git clone operations with credential support.

use std::path::Path;

use gix::clone::PrepareFetch;
use gix::create::Kind;
use tempfile::TempDir;

use crate::credentials::{inject_credentials, read_credentials, Credentials};
use crate::error::{GitError, Result};

/// Clone a git repository into a temporary directory.
///
/// Reads credentials from `GIT_USERNAME` and `GIT_PASSWORD` environment
/// variables. If credentials are not set, attempts clone without
/// authentication (public repos only).
///
/// The returned `TempDir` will be automatically deleted when it goes
/// out of scope. To keep the directory, use `TempDir::into_path()`.
///
/// # Arguments
///
/// * `url` - HTTPS URL of the git repository to clone
///
/// # Returns
///
/// A `TempDir` containing the cloned repository.
///
/// # Errors
///
/// Returns `GitError::CloneFailed` if the clone operation fails.
/// Returns `GitError::NotHttps` if the URL is not HTTPS.
///
/// # Example
///
/// ```rust,no_run
/// use aghub_git::clone_to_temp;
///
/// let temp_dir = clone_to_temp("https://github.com/user/repo.git").unwrap();
/// println!("Cloned to: {}", temp_dir.path().display());
/// // temp_dir is automatically cleaned up when dropped
/// ```
pub fn clone_to_temp(url: &str) -> Result<TempDir> {
	let creds = read_credentials();

	let clone_url = if let Some(c) = creds {
		inject_credentials(url, &c)?
	} else {
		validate_https_url(url)?;
		url.to_string()
	};

	do_clone(&clone_url)
}

/// Clone a git repository with explicit credentials.
///
/// Bypasses environment variables and uses the provided credentials
/// directly. Useful for one-off clones with different credentials.
///
/// # Arguments
///
/// * `url` - HTTPS URL of the git repository
/// * `username` - Git username
/// * `password` - Git password or personal access token
///
/// # Returns
///
/// A `TempDir` containing the cloned repository.
///
/// # Example
///
/// ```rust,no_run
/// use aghub_git::clone_with_credentials;
///
/// let temp_dir = clone_with_credentials(
///     "https://github.com/user/repo.git",
///     "myuser",
///     "mytoken"
/// ).unwrap();
/// ```
pub fn clone_with_credentials(
	url: &str,
	username: &str,
	password: &str,
) -> Result<TempDir> {
	let creds = Credentials {
		username: username.to_string(),
		password: password.to_string(),
	};

	let clone_url = inject_credentials(url, &creds)?;
	do_clone(&clone_url)
}

/// Validate that the URL is HTTPS.
fn validate_https_url(url: &str) -> Result<()> {
	let parsed = url::Url::parse(url).map_err(GitError::from)?;
	if parsed.scheme() != "https" {
		return Err(GitError::not_https(url));
	}
	Ok(())
}

/// Internal clone implementation using gix.
fn do_clone(url: &str) -> Result<TempDir> {
	let temp_dir =
		TempDir::new().map_err(|e| GitError::TempDirFailed(e.to_string()))?;

	let dest_path = temp_dir.path();

	let mut prep = PrepareFetch::new(
		url,
		dest_path,
		Kind::WithWorktree,
		Default::default(),
		Default::default(),
	)
	.map_err(|e| GitError::clone_failed(e.to_string()))?;

	let (mut checkout, _) = prep
		.fetch_then_checkout(
			gix::progress::Discard,
			&gix::interrupt::IS_INTERRUPTED,
		)
		.map_err(|e| GitError::clone_failed(format!("Fetch failed: {e}")))?;

	checkout
		.main_worktree(gix::progress::Discard, &gix::interrupt::IS_INTERRUPTED)
		.map_err(|e| GitError::clone_failed(format!("Checkout failed: {e}")))?;

	Ok(temp_dir)
}

/// Clone a git repository into a temporary directory, checking out a
/// specific branch.
///
/// If `branch` is provided, that branch will be checked out instead
/// of the default branch (HEAD).
///
/// # Arguments
///
/// * `url` - HTTPS URL of the git repository to clone
/// * `branch` - Branch name to check out (e.g. "main", "develop")
///
/// # Returns
///
/// A `TempDir` containing the cloned repository.
pub fn clone_to_temp_branch(url: &str, branch: &str) -> Result<TempDir> {
	let creds = read_credentials();

	let clone_url = if let Some(c) = creds {
		inject_credentials(url, &c)?
	} else {
		validate_https_url(url)?;
		url.to_string()
	};

	do_clone_branch(&clone_url, branch)
}

/// Clone a git repository with explicit credentials, checking out a
/// specific branch.
///
/// # Arguments
///
/// * `url` - HTTPS URL of the git repository
/// * `username` - Git username
/// * `password` - Git password or personal access token
/// * `branch` - Branch name to check out
pub fn clone_with_credentials_branch(
	url: &str,
	username: &str,
	password: &str,
	branch: &str,
) -> Result<TempDir> {
	let creds = Credentials {
		username: username.to_string(),
		password: password.to_string(),
	};

	let clone_url = inject_credentials(url, &creds)?;
	do_clone_branch(&clone_url, branch)
}

/// Internal clone implementation that checks out a specific branch.
fn do_clone_branch(url: &str, branch: &str) -> Result<TempDir> {
	let temp_dir =
		TempDir::new().map_err(|e| GitError::TempDirFailed(e.to_string()))?;

	let dest_path = temp_dir.path();

	let mut prep = PrepareFetch::new(
		url,
		dest_path,
		Kind::WithWorktree,
		Default::default(),
		Default::default(),
	)
	.map_err(|e| GitError::clone_failed(e.to_string()))?
	.with_ref_name(Some(branch))
	.map_err(|e: gix::refs::name::Error| {
		GitError::clone_failed(format!("Invalid branch name '{branch}': {e}"))
	})?;

	let (mut checkout, _) = prep
		.fetch_then_checkout(
			gix::progress::Discard,
			&gix::interrupt::IS_INTERRUPTED,
		)
		.map_err(|e| GitError::clone_failed(format!("Fetch failed: {e}")))?;

	checkout
		.main_worktree(gix::progress::Discard, &gix::interrupt::IS_INTERRUPTED)
		.map_err(|e| GitError::clone_failed(format!("Checkout failed: {e}")))?;

	Ok(temp_dir)
}

/// List remote branch names for a repository URL.
///
/// Uses `git ls-remote --heads` to fetch branch names without
/// cloning the entire repository.
///
/// # Arguments
///
/// * `url` - HTTPS URL of the git repository
///
/// # Returns
///
/// A sorted list of branch names (e.g. `["develop", "main"]`).
pub fn list_remote_branches(url: &str) -> Result<Vec<String>> {
	validate_https_url(url)?;
	do_list_remote_branches(url)
}

/// List remote branches with explicit credentials.
///
/// # Arguments
///
/// * `url` - HTTPS URL of the git repository
/// * `username` - Git username
/// * `password` - Git password or personal access token
///
/// # Returns
///
/// A sorted list of branch names.
pub fn list_remote_branches_with_credentials(
	url: &str,
	username: &str,
	password: &str,
) -> Result<Vec<String>> {
	let creds = Credentials {
		username: username.to_string(),
		password: password.to_string(),
	};
	let auth_url = inject_credentials(url, &creds)?;
	do_list_remote_branches(&auth_url)
}

/// Internal implementation using `git ls-remote --heads`.
fn do_list_remote_branches(url: &str) -> Result<Vec<String>> {
	let output = std::process::Command::new("git")
		.args(["ls-remote", "--heads", url])
		.output()
		.map_err(|e| {
			GitError::clone_failed(format!("Failed to run git ls-remote: {e}"))
		})?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).to_string();
		return Err(GitError::clone_failed(format!(
			"git ls-remote failed: {stderr}"
		)));
	}

	let stdout = String::from_utf8_lossy(&output.stdout);
	let mut branches: Vec<String> = stdout
		.lines()
		.filter_map(|line| {
			let refname = line.split_whitespace().nth(1)?;
			refname.strip_prefix("refs/heads/").map(String::from)
		})
		.collect();

	branches.sort();
	Ok(branches)
}

/// Clone a repository to a specific path (not temporary).
///
/// Use this when you need the clone to persist beyond the current
/// function scope.
///
/// # Arguments
///
/// * `url` - HTTPS URL of the git repository
/// * `dest` - Destination path for the clone
///
/// # Example
///
/// ```rust,no_run
/// use aghub_git::clone_to_path;
/// use std::path::Path;
///
/// clone_to_path(
///     "https://github.com/user/repo.git",
///     Path::new("/tmp/my-repo")
/// ).unwrap();
/// ```
pub fn clone_to_path(url: &str, dest: &Path) -> Result<()> {
	let creds = read_credentials();

	let clone_url = if let Some(c) = creds {
		inject_credentials(url, &c)?
	} else {
		validate_https_url(url)?;
		url.to_string()
	};

	let mut prep = PrepareFetch::new(
		clone_url.as_str(),
		dest,
		Kind::WithWorktree,
		Default::default(),
		Default::default(),
	)
	.map_err(|e| GitError::destination_error(dest, e.to_string()))?;

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

	#[test]
	fn test_clone_public_repo() {
		let result =
			clone_to_temp("https://github.com/octocat/Hello-World.git");
		if let Ok(temp_dir) = result {
			assert!(temp_dir.path().exists());
			assert!(
				temp_dir.path().join(".git").exists()
					|| temp_dir.path().join("README").exists()
			);
		}
	}
}
