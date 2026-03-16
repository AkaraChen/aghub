//! Error types for the skill library.

use std::path::PathBuf;

/// Error type for skill operations.
#[derive(Debug, thiserror::Error)]
pub enum SkillError {
	/// I/O error.
	#[error("IO error: {0}")]
	Io(#[from] std::io::Error),

	/// ZIP file error.
	#[error("ZIP error: {0}")]
	Zip(#[from] zip::result::ZipError),

	/// Parse error from skills-ref.
	#[error("Parse error: {0}")]
	Parse(String),

	/// Validation errors.
	#[error("Validation failed: {0}")]
	Validation(String),

	/// Missing SKILL.md file.
	#[error("SKILL.md not found in {path}")]
	MissingSkillMd {
		/// Path where SKILL.md was expected.
		path: PathBuf,
	},

	/// Invalid file format.
	#[error("Invalid format: {0}")]
	InvalidFormat(String),

	/// Skill not found.
	#[error("Skill not found: {0}")]
	NotFound(String),
}

impl From<Box<dyn skills_ref::errors::SkillError>> for SkillError {
	fn from(e: Box<dyn skills_ref::errors::SkillError>) -> Self {
		SkillError::Parse(e.to_string())
	}
}

/// Result type alias for skill operations.
pub type Result<T> = std::result::Result<T, SkillError>;
