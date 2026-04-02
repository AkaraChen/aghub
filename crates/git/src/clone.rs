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
/// Uses `gix` remote ref discovery to fetch branch names without
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

/// Internal implementation using `gix` ref discovery.
fn do_list_remote_branches(url: &str) -> Result<Vec<String>> {
	let temp_dir =
		TempDir::new().map_err(|e| GitError::TempDirFailed(e.to_string()))?;
	let repo = gix::init(temp_dir.path())
		.map_err(|e| GitError::clone_failed(e.to_string()))?;
	let remote = repo
		.remote_at(url)
		.map_err(|e| GitError::clone_failed(e.to_string()))?;
	let remote = remote
		.with_refspecs(
			Some("+refs/heads/*:refs/remotes/origin/*"),
			gix::remote::Direction::Fetch,
		)
		.map_err(|e| GitError::clone_failed(e.to_string()))?;
	let connection = remote
		.connect(gix::remote::Direction::Fetch)
		.map_err(|e| GitError::clone_failed(e.to_string()))?;
	let (ref_map, _) = connection
		.ref_map(
			gix::progress::Discard,
			gix::remote::ref_map::Options::default(),
		)
		.map_err(|e| GitError::clone_failed(e.to_string()))?;

	Ok(branches_from_remote_refs(&ref_map.remote_refs))
}

fn branches_from_remote_refs(
	remote_refs: &[gix::protocol::handshake::Ref],
) -> Vec<String> {
	use gix::bstr::ByteSlice;

	let mut branches: Vec<String> = remote_refs
		.iter()
		.filter_map(|remote_ref| match remote_ref {
			gix::protocol::handshake::Ref::Direct { full_ref_name, .. }
			| gix::protocol::handshake::Ref::Peeled { full_ref_name, .. } => {
				full_ref_name
					.strip_prefix(b"refs/heads/" as &[u8])
					.map(|name| name.to_str_lossy().to_string())
			}
			gix::protocol::handshake::Ref::Symbolic { target, .. }
			| gix::protocol::handshake::Ref::Unborn { target, .. } => target
				.strip_prefix(b"refs/heads/" as &[u8])
				.map(|name| name.to_str_lossy().to_string()),
		})
		.collect();
	branches.sort();
	branches.dedup();
	branches
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
	use std::process::Command;
	use std::sync::{Mutex, OnceLock};

	fn env_lock() -> &'static Mutex<()> {
		static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
		LOCK.get_or_init(|| Mutex::new(()))
	}

	#[test]
	fn test_clone_public_repo() {
		let _guard = env_lock().lock().unwrap_or_else(|e| e.into_inner());
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

	#[test]
	fn test_clone_public_repo_branch() {
		let _guard = env_lock().lock().unwrap_or_else(|e| e.into_inner());
		let result = clone_to_temp_branch(
			"https://github.com/octocat/Hello-World.git",
			"master",
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

	#[test]
	fn test_list_remote_branches_public_repo() {
		let _guard = env_lock().lock().unwrap_or_else(|e| e.into_inner());
		let branches =
			list_remote_branches("https://github.com/octocat/Hello-World.git")
				.unwrap();
		assert!(!branches.is_empty());
		assert!(branches.contains(&"master".to_string()));
	}

	#[test]
	fn test_branches_from_remote_refs() {
		use gix::protocol::handshake::Ref;

		let null_id = gix::hash::ObjectId::null(gix::hash::Kind::Sha1);
		let branches = branches_from_remote_refs(&[
			Ref::Direct {
				full_ref_name: "refs/heads/main".into(),
				object: null_id,
			},
			Ref::Symbolic {
				full_ref_name: "HEAD".into(),
				target: "refs/heads/main".into(),
				tag: None,
				object: gix::hash::ObjectId::null(gix::hash::Kind::Sha1),
			},
			Ref::Unborn {
				full_ref_name: "HEAD".into(),
				target: "refs/heads/develop".into(),
			},
			Ref::Peeled {
				full_ref_name: "refs/heads/release".into(),
				tag: gix::hash::ObjectId::null(gix::hash::Kind::Sha1),
				object: gix::hash::ObjectId::null(gix::hash::Kind::Sha1),
			},
		]);

		assert_eq!(
			branches,
			vec![
				"develop".to_string(),
				"main".to_string(),
				"release".to_string(),
			],
		);
	}
}
