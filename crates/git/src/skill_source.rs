//! Read repository provenance without fetching or changing the checkout.

use std::path::{Path, PathBuf};

use crate::{GitError, ResolvedRemoteSource, Result};

#[derive(Debug, Clone)]
pub struct RepositorySkillSource {
	pub repository_root: PathBuf,
	pub source: Option<ResolvedRemoteSource>,
	pub skill_path: String,
	pub reference: Option<String>,
	pub revision: String,
	pub tree: String,
}

pub fn repository_skill_source(
	directory: &Path,
) -> Result<Option<RepositorySkillSource>> {
	let directory = directory.canonicalize()?;
	let Some(root) = repository_root(&directory)? else {
		return Ok(None);
	};
	let repository = gix::open(&root).map_err(inspection_error)?;
	if repository.head().map_err(inspection_error)?.is_unborn() {
		return Ok(None);
	}
	let Some(work_dir) = repository.workdir() else {
		return Ok(None);
	};
	let work_dir = work_dir.canonicalize()?;
	let relative = directory
		.strip_prefix(&work_dir)
		.map_err(inspection_error)?;
	let mut document = relative.join("SKILL.md");
	let commit = repository.head_commit().map_err(inspection_error)?;
	let tree = commit.tree().map_err(inspection_error)?;
	if tree
		.lookup_entry_by_path(&document)
		.map_err(inspection_error)?
		.is_none()
	{
		document = relative.join("skill.md");
		if tree
			.lookup_entry_by_path(&document)
			.map_err(inspection_error)?
			.is_none()
		{
			return Ok(None);
		}
	}
	let source = repository
		.config_snapshot()
		.string("remote.origin.url")
		.map(|remote| {
			let remote =
				std::str::from_utf8(&remote).map_err(inspection_error)?;
			if remote.contains('?')
				|| remote.contains('#')
				|| url::Url::parse(remote)
					.is_ok_and(|url| url.password().is_some())
			{
				return Err(inspection_error(
					"Repository remote contains credentials or query data",
				));
			}
			crate::resolve_remote_source(remote).map_err(|_| {
				inspection_error(
					"Repository remote cannot be used as a Skill source",
				)
			})
		})
		.transpose()?;
	let tree_id = if relative.as_os_str().is_empty() {
		tree.id().to_string()
	} else {
		let Some(entry) = tree
			.lookup_entry_by_path(relative)
			.map_err(inspection_error)?
		else {
			return Ok(None);
		};
		if !entry.mode().is_tree() {
			return Ok(None);
		}
		entry.id().to_string()
	};
	Ok(Some(RepositorySkillSource {
		repository_root: work_dir.clone(),
		source,
		skill_path: document
			.to_str()
			.ok_or_else(|| inspection_error("Skill path is not UTF-8"))?
			.replace('\\', "/"),
		reference: crate::current_branch(&root)?,
		revision: commit.id.to_string(),
		tree: tree_id,
	}))
}

fn repository_root(directory: &Path) -> Result<Option<PathBuf>> {
	for candidate in directory.ancestors() {
		match std::fs::symlink_metadata(candidate.join(".git")) {
			Ok(_) => return Ok(Some(candidate.to_path_buf())),
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
			Err(error) => return Err(error.into()),
		}
	}
	Ok(None)
}

fn inspection_error(error: impl std::fmt::Display) -> GitError {
	GitError::RepositoryInspection(error.to_string())
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::process::Command;

	fn git(root: &Path, args: &[&str]) -> String {
		let output = Command::new("git")
			.current_dir(root)
			.env("GIT_CONFIG_NOSYSTEM", "1")
			.env(
				"GIT_CONFIG_GLOBAL",
				if cfg!(windows) { "NUL" } else { "/dev/null" },
			)
			.env("GIT_AUTHOR_NAME", "Fixture")
			.env("GIT_AUTHOR_EMAIL", "fixture@example.invalid")
			.env("GIT_COMMITTER_NAME", "Fixture")
			.env("GIT_COMMITTER_EMAIL", "fixture@example.invalid")
			.args(args)
			.output()
			.unwrap();
		assert!(
			output.status.success(),
			"{}",
			String::from_utf8_lossy(&output.stderr)
		);
		String::from_utf8(output.stdout).unwrap().trim().into()
	}

	fn repository(root: &Path, remote: &str) -> PathBuf {
		std::fs::create_dir_all(root).unwrap();
		git(root, &["init", "-b", "main"]);
		git(root, &["remote", "add", "origin", remote]);
		let skill = root.join("skills/demo");
		std::fs::create_dir_all(&skill).unwrap();
		std::fs::write(
			skill.join("SKILL.md"),
			"---\nname: demo\ndescription: fixture\n---\nbody",
		)
		.unwrap();
		git(root, &["add", "skills"]);
		git(root, &["commit", "-m", "fixture"]);
		skill
	}

	#[test]
	fn reads_the_nearest_repository_and_real_tree_revision() {
		let temp = tempfile::tempdir().unwrap();
		repository(temp.path(), "https://github.com/owner/parent.git");
		let nested = temp.path().join("vendor/child");
		let skill = repository(&nested, "https://github.com/owner/child.git");
		let source = repository_skill_source(&skill).unwrap().unwrap();
		assert_eq!(source.source.unwrap().source, "owner/child");
		assert_eq!(source.skill_path, "skills/demo/SKILL.md");
		assert_eq!(source.reference.as_deref(), Some("main"));
		assert_eq!(source.revision, git(&nested, &["rev-parse", "HEAD"]));
		assert_eq!(
			source.tree,
			git(&nested, &["rev-parse", "HEAD:skills/demo"])
		);
	}

	#[test]
	fn does_not_attribute_an_untracked_installation_to_its_parent() {
		let temp = tempfile::tempdir().unwrap();
		repository(temp.path(), "https://github.com/owner/parent.git");
		let installed = temp.path().join(".agents/skills/copied");
		std::fs::create_dir_all(&installed).unwrap();
		std::fs::write(installed.join("SKILL.md"), "local").unwrap();
		assert!(repository_skill_source(&installed).unwrap().is_none());
	}

	#[test]
	fn reads_lowercase_skill_document() {
		let temp = tempfile::tempdir().unwrap();
		let skill =
			repository(temp.path(), "https://github.com/example/repo.git");
		git(
			temp.path(),
			&["mv", "skills/demo/SKILL.md", "skills/demo/skill.md"],
		);
		git(temp.path(), &["commit", "-m", "lowercase document"]);
		let source = repository_skill_source(&skill).unwrap().unwrap();
		assert_eq!(source.skill_path, "skills/demo/skill.md");
	}

	#[test]
	fn supports_detached_worktrees() {
		let temp = tempfile::tempdir().unwrap();
		let root = temp.path().join("repo");
		repository(&root, "https://github.com/owner/repo.git");
		let linked = temp.path().join("worktree");
		git(
			&root,
			&["worktree", "add", "--detach", linked.to_str().unwrap()],
		);
		let source = repository_skill_source(&linked.join("skills/demo"))
			.unwrap()
			.unwrap();
		assert_eq!(source.reference, None);
		assert_eq!(source.repository_root, linked.canonicalize().unwrap());
	}

	#[cfg(unix)]
	#[test]
	fn follows_an_installed_directory_link_to_its_source() {
		let temp = tempfile::tempdir().unwrap();
		let skill = repository(
			&temp.path().join("repo"),
			"https://github.com/owner/repo.git",
		);
		let link = temp.path().join("installed");
		std::os::unix::fs::symlink(&skill, &link).unwrap();
		assert_eq!(
			repository_skill_source(&link)
				.unwrap()
				.unwrap()
				.source
				.unwrap()
				.source,
			"owner/repo"
		);
	}

	#[test]
	fn reads_submodule_origin_instead_of_parent_origin() {
		let temp = tempfile::tempdir().unwrap();
		let child = temp.path().join("child");
		repository(&child, "https://github.com/example/child.git");
		let parent = temp.path().join("parent");
		repository(&parent, "https://github.com/example/parent.git");
		git(
			&parent,
			&[
				"-c",
				"protocol.file.allow=always",
				"submodule",
				"add",
				child.to_str().unwrap(),
				"vendor/child",
			],
		);
		let checkout = parent.join("vendor/child");
		git(
			&checkout,
			&[
				"remote",
				"set-url",
				"origin",
				"https://github.com/example/child.git",
			],
		);
		let source = repository_skill_source(&checkout.join("skills/demo"))
			.unwrap()
			.unwrap();
		assert_eq!(source.source.unwrap().source, "example/child");
		assert_eq!(source.repository_root, checkout.canonicalize().unwrap());
		assert_eq!(source.revision, git(&child, &["rev-parse", "HEAD"]));
	}

	#[test]
	fn local_repository_without_remote_does_not_invent_a_source() {
		let temp = tempfile::tempdir().unwrap();
		let skill =
			repository(temp.path(), "https://github.com/example/repo.git");
		git(temp.path(), &["remote", "remove", "origin"]);
		assert!(repository_skill_source(&skill)
			.unwrap()
			.unwrap()
			.source
			.is_none());
	}

	#[test]
	fn does_not_expose_credentials_from_a_remote() {
		let temp = tempfile::tempdir().unwrap();
		let skill = repository(
			temp.path(),
			"https://user:secret@github.com/owner/repo.git",
		);
		let error = repository_skill_source(&skill).unwrap_err();
		assert!(!error.to_string().contains("secret"));
	}
}
