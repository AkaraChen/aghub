//! Remote git URL resolution and ref discovery.

use crate::credentials::{inject_credentials, read_credentials, Credentials};
use crate::error::{GitError, Result};

/// Options shared by remote git operations.
#[derive(Debug, Clone)]
pub struct RemoteOptions<'a> {
	/// HTTPS URL of the git repository.
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

pub fn list_remote_branches(options: RemoteOptions<'_>) -> Result<Vec<String>> {
	let url = resolve_remote_url(&options, false)?;
	let remote_refs = discover_remote_refs(url.as_str())?;
	Ok(branches_from_remote_refs(&remote_refs))
}

pub(crate) fn resolve_remote_url(
	options: &RemoteOptions<'_>,
	use_env_credentials: bool,
) -> Result<String> {
	let env_credentials = if use_env_credentials {
		read_credentials()
	} else {
		None
	};
	let credentials = options.credentials.as_ref().or(env_credentials.as_ref());

	match credentials {
		Some(credentials) => inject_credentials(options.url, credentials),
		None => {
			validate_https_url(options.url).map(|()| options.url.to_string())
		}
	}
}

fn validate_https_url(url: &str) -> Result<()> {
	let parsed = url::Url::parse(url).map_err(GitError::from)?;
	if parsed.scheme() != "https" {
		return Err(GitError::not_https(url));
	}
	Ok(())
}

fn discover_remote_refs(
	url: &str,
) -> Result<Vec<gix::protocol::handshake::Ref>> {
	let temp_dir = tempfile::TempDir::new()
		.map_err(|e| GitError::TempDirFailed(e.to_string()))?;
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

	Ok(ref_map.remote_refs)
}

pub(crate) fn branches_from_remote_refs(
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

#[cfg(test)]
mod tests {
	use super::*;
	use std::sync::{Mutex, OnceLock};

	fn env_lock() -> &'static Mutex<()> {
		static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
		LOCK.get_or_init(|| Mutex::new(()))
	}

	#[test]
	fn test_list_remote_branches_public_repo() {
		let _guard = env_lock().lock().unwrap_or_else(|e| e.into_inner());
		let branches = list_remote_branches(RemoteOptions::new(
			"https://github.com/octocat/Hello-World.git",
		))
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
