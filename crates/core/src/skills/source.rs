//! Existing repository provenance, separate from installation ownership.

use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillSourceEvidence {
	GithubCli,
	Repository,
	InstallationLock,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillRepositorySource {
	pub source: String,
	pub source_type: String,
	pub source_url: String,
	pub skill_path: Option<String>,
	pub reference: Option<String>,
	/// Repository HEAD, not proof that local files still match that commit.
	pub revision: Option<String>,
	pub tree_sha: Option<String>,
	pub pinned_ref: Option<String>,
	pub evidence: SkillSourceEvidence,
	/// The installed content is itself tracked in a checkout. Do not replace it.
	pub repository_managed: bool,
}

#[derive(Debug, Error)]
pub enum SkillSourceError {
	#[error(transparent)]
	Skill(#[from] skill::SkillError),
	#[error(transparent)]
	Git(#[from] aghub_git::GitError),
	#[error("Invalid Skill repository source")]
	InvalidSource,
}

pub fn discover_skill_source(
	directory: &Path,
	lock: Option<&skill::SkillLockEntry>,
) -> Result<Option<SkillRepositorySource>, SkillSourceError> {
	let metadata = skill::provenance::read_github_metadata(directory)?;
	let repository =
		aghub_git::skill_source::repository_skill_source(directory)?;
	let repository_managed = repository.is_some();
	if let Some(metadata) = metadata {
		let source = aghub_git::resolve_remote_source(&metadata.repository)
			.map_err(|_| SkillSourceError::InvalidSource)?;
		if !source.source_url.starts_with("https://") {
			return Err(SkillSourceError::InvalidSource);
		}
		return Ok(Some(SkillRepositorySource {
			source: source.lock_source(),
			source_type: source.source_type.as_str().into(),
			source_url: source.source_url,
			skill_path: metadata.path.map(|path| {
				skill::lock_skill_file_path(path.trim_matches('/'))
			}),
			reference: metadata.reference,
			revision: None,
			tree_sha: metadata.tree_sha,
			pinned_ref: metadata.pinned_ref,
			evidence: SkillSourceEvidence::GithubCli,
			repository_managed,
		}));
	}
	if let Some(repository) = repository {
		if let Some(source) = repository.source {
			return Ok(Some(SkillRepositorySource {
				source: source.lock_source(),
				source_type: source.source_type.as_str().into(),
				source_url: source.source_url,
				skill_path: Some(repository.skill_path),
				reference: repository.reference,
				revision: Some(repository.revision),
				tree_sha: Some(repository.tree),
				pinned_ref: None,
				evidence: SkillSourceEvidence::Repository,
				repository_managed: true,
			}));
		}
	}
	let Some(lock) = lock else { return Ok(None) };
	if !matches!(lock.source_type.as_str(), "github" | "gitlab" | "git") {
		return Ok(None);
	}
	let source = aghub_git::resolve_remote_source(&lock.source_url)
		.map_err(|_| SkillSourceError::InvalidSource)?;
	let pinned_ref = lock
		.extra
		.get("pinnedRef")
		.map(|value| {
			value
				.as_str()
				.map(str::to_owned)
				.ok_or(SkillSourceError::InvalidSource)
		})
		.transpose()?;
	let hash = &lock.skill_folder_hash;
	Ok(Some(SkillRepositorySource {
		source: source.lock_source(),
		source_type: source.source_type.as_str().into(),
		source_url: source.source_url,
		skill_path: lock.skill_path.clone(),
		reference: lock.ref_name.clone(),
		revision: None,
		tree_sha: (hash.len() == 40
			&& hash.bytes().all(|b| b.is_ascii_hexdigit()))
		.then(|| hash.clone()),
		pinned_ref,
		evidence: SkillSourceEvidence::InstallationLock,
		repository_managed,
	}))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn embedded_source_takes_precedence_over_a_same_name_lock_entry() {
		let root = tempfile::tempdir().unwrap();
		std::fs::write(
			root.path().join("SKILL.md"),
			concat!(
				"---\nname: demo\ndescription: demo\nmetadata:\n",
				"  github-repo: https://github.com/owner/actual\n",
				"  github-path: skills/demo\n  github-pinned: v1\n---\nbody"
			),
		)
		.unwrap();
		let lock = skill::SkillLockEntry::new(
			"owner/other".into(),
			"github".into(),
			"https://github.com/owner/other".into(),
			None,
			None,
			"legacy".into(),
			None,
		);
		let source = discover_skill_source(root.path(), Some(&lock))
			.unwrap()
			.unwrap();
		assert_eq!(source.source, "owner/actual");
		assert_eq!(source.skill_path.as_deref(), Some("skills/demo/SKILL.md"));
		assert_eq!(source.pinned_ref.as_deref(), Some("v1"));
		assert!(!source.repository_managed);
	}

	#[test]
	fn does_not_treat_placeholder_hashes_as_upstream_revisions() {
		let root = tempfile::tempdir().unwrap();
		std::fs::write(
			root.path().join("SKILL.md"),
			"---\nname: demo\ndescription: demo\n---\nbody",
		)
		.unwrap();
		let lock = skill::SkillLockEntry::new(
			"owner/repo".into(),
			"github".into(),
			"https://github.com/owner/repo".into(),
			None,
			None,
			skill::install::EMPTY_SKILLS_LOCK_DIGEST.into(),
			None,
		);
		assert_eq!(
			discover_skill_source(root.path(), Some(&lock))
				.unwrap()
				.unwrap()
				.tree_sha,
			None
		);
	}
}
