//! Error types for skills-ref library.

/// Base trait for all skill-related errors.
pub trait SkillError: std::error::Error + Send + Sync {}

/// Error type for parsing failures.
#[derive(Debug, thiserror::Error)]
pub enum ParseError {
	/// SKILL.md file not found in directory.
	#[error("SKILL.md not found in {0}")]
	FileNotFound(String),

	/// Frontmatter is missing or invalid.
	#[error("SKILL.md must start with YAML frontmatter (---)")]
	MissingFrontmatter,

	/// Frontmatter is not properly closed.
	#[error("SKILL.md frontmatter not properly closed with ---")]
	UnclosedFrontmatter,

	/// Invalid YAML syntax.
	#[error("Invalid YAML in frontmatter: {0}")]
	InvalidYaml(String),

	/// Frontmatter is not a YAML mapping.
	#[error("SKILL.md frontmatter must be a YAML mapping")]
	NotAMapping,
}

impl SkillError for ParseError {}

impl From<ParseError> for Box<dyn SkillError> {
	fn from(e: ParseError) -> Self {
		Box::new(e)
	}
}

/// Error type for validation failures.
#[derive(Debug, thiserror::Error)]
pub enum ValidationError {
	/// Required field is missing.
	#[error("Missing required field in frontmatter: {0}")]
	MissingField(String),

	/// Field has invalid value.
	#[error("{0}")]
	InvalidValue(String),
}

impl SkillError for ValidationError {}

impl From<ValidationError> for Box<dyn SkillError> {
	fn from(e: ValidationError) -> Self {
		Box::new(e)
	}
}

impl ValidationError {
	/// Create a new validation error for a missing field.
	pub fn missing_field(field: &str) -> Self {
		Self::MissingField(field.to_string())
	}

	/// Create a new validation error for an invalid value.
	pub fn invalid_value(message: String) -> Self {
		Self::InvalidValue(message)
	}
}
