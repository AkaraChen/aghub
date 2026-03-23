//! Data models for skills.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Source type for a skill.
#[derive(Debug, Clone)]
pub enum SkillSource {
	/// Single SKILL.md file.
	SkillMd(PathBuf),
	/// Skill directory with structure.
	Directory(PathBuf),
	/// Packaged .skill file (zip).
	SkillFile(PathBuf),
	/// Generic zip file.
	ZipFile(PathBuf),
}

impl Default for SkillSource {
	fn default() -> Self {
		SkillSource::SkillMd(PathBuf::new())
	}
}

impl SkillSource {
	/// Get the path of the skill source.
	pub fn path(&self) -> &PathBuf {
		match self {
			SkillSource::SkillMd(p) => p,
			SkillSource::Directory(p) => p,
			SkillSource::SkillFile(p) => p,
			SkillSource::ZipFile(p) => p,
		}
	}
}

/// Skill model - comprehensive representation of a skill.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
	/// Skill name from frontmatter (required).
	pub name: String,

	/// Description from frontmatter (required).
	pub description: String,

	/// License from frontmatter (optional).
	#[serde(skip_serializing_if = "Option::is_none")]
	pub license: Option<String>,

	/// Compatibility from frontmatter (optional).
	#[serde(skip_serializing_if = "Option::is_none")]
	pub compatibility: Option<String>,

	/// Allowed tools from frontmatter (optional).
	#[serde(rename = "allowed-tools", skip_serializing_if = "Option::is_none")]
	pub allowed_tools: Option<String>,

	/// Author from frontmatter (optional).
	#[serde(skip_serializing_if = "Option::is_none")]
	pub author: Option<String>,

	/// Version from frontmatter (optional).
	#[serde(skip_serializing_if = "Option::is_none")]
	pub version: Option<String>,

	/// Body content from SKILL.md (markdown instructions).
	#[serde(skip)]
	pub content: String,

	/// Source information.
	#[serde(skip)]
	pub source: SkillSource,

	/// Files in the scripts/ directory.
	#[serde(default, skip_serializing_if = "Vec::is_empty")]
	pub scripts: Vec<String>,

	/// Files in the references/ directory.
	#[serde(default, skip_serializing_if = "Vec::is_empty")]
	pub references: Vec<String>,

	/// Files in the assets/ directory.
	#[serde(default, skip_serializing_if = "Vec::is_empty")]
	pub assets: Vec<String>,
}

impl Skill {
	/// Create a new skill with the given name and description.
	pub fn new(
		name: impl Into<String>,
		description: impl Into<String>,
	) -> Self {
		Self {
			name: name.into(),
			description: description.into(),
			license: None,
			compatibility: None,
			allowed_tools: None,
			author: None,
			version: None,
			content: String::new(),
			source: SkillSource::SkillMd(PathBuf::new()),
			scripts: Vec::new(),
			references: Vec::new(),
			assets: Vec::new(),
		}
	}

	/// Convert to SkillProperties (from skills-ref).
	pub fn to_properties(&self) -> skills_ref::SkillProperties {
		skills_ref::SkillProperties {
			name: self.name.clone(),
			description: self.description.clone(),
			license: self.license.clone(),
			compatibility: self.compatibility.clone(),
			allowed_tools: self.allowed_tools.clone(),
		}
	}

	/// Get all resource files (scripts, references, assets).
	pub fn all_resources(&self) -> Vec<&String> {
		self.scripts
			.iter()
			.chain(self.references.iter())
			.chain(self.assets.iter())
			.collect()
	}

	/// Check if the skill has any resources.
	pub fn has_resources(&self) -> bool {
		!self.scripts.is_empty()
			|| !self.references.is_empty()
			|| !self.assets.is_empty()
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_skill_new() {
		let skill = Skill::new("test-skill", "A test skill");
		assert_eq!(skill.name, "test-skill");
		assert_eq!(skill.description, "A test skill");
		assert!(skill.scripts.is_empty());
		assert!(skill.references.is_empty());
		assert!(skill.assets.is_empty());
	}

	#[test]
	fn test_skill_has_resources() {
		let mut skill = Skill::new("test", "Test");
		assert!(!skill.has_resources());

		skill.scripts.push("script.sh".to_string());
		assert!(skill.has_resources());
	}
}
