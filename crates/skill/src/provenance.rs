//! GitHub CLI metadata embedded in an installed Skill document.

use serde::Deserialize;
use std::path::{Component, Path};

use crate::{error::Result, SkillError};

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct GithubSkillMetadata {
	#[serde(rename = "github-repo")]
	pub repository: String,
	#[serde(rename = "github-ref")]
	pub reference: Option<String>,
	#[serde(rename = "github-tree-sha")]
	pub tree_sha: Option<String>,
	#[serde(rename = "github-path")]
	pub path: Option<String>,
	#[serde(rename = "github-pinned")]
	pub pinned_ref: Option<String>,
}

pub fn read_github_metadata(
	directory: &Path,
) -> Result<Option<GithubSkillMetadata>> {
	let (content, _) = crate::content::read_directory_skill_md(directory)?;
	parse_github_metadata(&content)
}

fn parse_github_metadata(content: &str) -> Result<Option<GithubSkillMetadata>> {
	let (frontmatter, _) = skills_ref::parser::parse_frontmatter(content)
		.map_err(|error| SkillError::Parse(error.to_string()))?;
	let Some(metadata) = frontmatter.get("metadata") else {
		return Ok(None);
	};
	if metadata.get("github-repo").is_none() {
		return Ok(None);
	}
	let mut source: GithubSkillMetadata =
		serde_yaml::from_value(metadata.clone()).map_err(|_| {
			SkillError::Parse("Invalid GitHub Skill metadata".into())
		})?;
	// Older gh installations stored owner and repository separately.
	if let Some(owner) = metadata.get("github-owner").and_then(|v| v.as_str()) {
		if !source.repository.contains('/') {
			source.repository = format!("{owner}/{}", source.repository);
		}
	}
	if source.repository.is_empty() || source.repository.len() > 4096 {
		return Err(SkillError::Validation(
			"Invalid GitHub repository metadata".into(),
		));
	}
	if let Some(path) = &source.path {
		if path.contains(['\\', ':'])
			|| Path::new(path)
				.components()
				.any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
		{
			return Err(SkillError::Validation(
				"GitHub Skill path must stay within its repository".into(),
			));
		}
	}
	for reference in [&source.reference, &source.pinned_ref]
		.into_iter()
		.flatten()
	{
		if reference.is_empty()
			|| reference.len() > 4096
			|| reference.chars().any(char::is_control)
		{
			return Err(SkillError::Validation(
				"Invalid GitHub Skill reference".into(),
			));
		}
	}
	if let Some(hash) = &source.tree_sha {
		if !matches!(hash.len(), 40 | 64)
			|| !hash.bytes().all(|b| b.is_ascii_hexdigit())
		{
			return Err(SkillError::Validation(
				"Invalid GitHub Skill tree hash".into(),
			));
		}
	}
	Ok(Some(source))
}

#[cfg(test)]
mod tests {
	use super::*;

	fn document(metadata: &str) -> String {
		format!("---\nname: demo\ndescription: demo\nmetadata:\n{metadata}\n---\nbody")
	}

	#[test]
	fn reads_gh_reference_tree_path_and_pin_without_rewriting_content() {
		let source = parse_github_metadata(&document(&format!(
			concat!(
				"  github-repo: https://github.com/owner/repo\n",
				"  github-ref: v1.2\n  github-tree-sha: '{}'\n",
				"  github-path: skills/demo\n  github-pinned: v1.2"
			),
			"a".repeat(40)
		)))
		.unwrap()
		.unwrap();
		assert_eq!(source.pinned_ref.as_deref(), Some("v1.2"));
		assert_eq!(source.path.as_deref(), Some("skills/demo"));
		assert_eq!(source.tree_sha.as_deref(), Some("a".repeat(40).as_str()));
	}

	#[test]
	fn accepts_windows_line_endings() {
		let content =
			document("  github-repo: owner/repo").replace('\n', "\r\n");
		assert_eq!(
			parse_github_metadata(&content).unwrap().unwrap().repository,
			"owner/repo"
		);
	}

	#[test]
	fn local_and_unattributed_skills_have_no_github_metadata() {
		assert!(parse_github_metadata(&document("  local-path: /tmp/demo"))
			.unwrap()
			.is_none());
		assert!(parse_github_metadata(
			"---\nname: demo\ndescription: demo\n---\nbody"
		)
		.unwrap()
		.is_none());
	}

	#[test]
	fn reads_legacy_owner_without_treating_commit_sha_as_tree_sha() {
		let source = parse_github_metadata(&document(
			"  github-owner: owner\n  github-repo: repo\n  github-sha: abcdef",
		))
		.unwrap()
		.unwrap();
		assert_eq!(source.repository, "owner/repo");
		assert_eq!(source.tree_sha, None);
	}

	#[test]
	fn rejects_unsafe_paths_and_invalid_pin_types() {
		for value in [
			"  github-path: ../outside",
			"  github-path: /outside",
			"  github-path: C:/outside",
			"  github-pinned: true",
			"  github-tree-sha: not-a-sha",
		] {
			assert!(parse_github_metadata(&document(&format!(
				"  github-repo: owner/repo\n{value}"
			)))
			.is_err());
		}
	}
}
