//! Local Git repository inspection.

use std::path::Path;

use crate::{GitError, Result};

/// Return the short branch name referenced by `HEAD`, or `None` for a
/// detached `HEAD`.
pub fn current_branch(repo_path: impl AsRef<Path>) -> Result<Option<String>> {
	let repository = gix::open(repo_path.as_ref())
		.map_err(|error| GitError::RepositoryInspection(error.to_string()))?;
	let name = repository
		.head_name()
		.map_err(|error| GitError::RepositoryInspection(error.to_string()))?;
	Ok(name.map(|name| String::from_utf8_lossy(name.shorten()).into_owned()))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn reads_the_symbolic_head_branch() {
		let root = tempfile::tempdir().unwrap();
		gix::init(root.path()).unwrap();
		std::fs::write(
			root.path().join(".git/HEAD"),
			"ref: refs/heads/review\n",
		)
		.unwrap();

		assert_eq!(
			current_branch(root.path()).unwrap().as_deref(),
			Some("review")
		);
	}
}
