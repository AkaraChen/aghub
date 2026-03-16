//! Skill validation logic.

use crate::parser::{find_skill_md, parse_frontmatter};
use std::collections::HashMap;
use std::path::Path;
use unicode_normalization::UnicodeNormalization;

const MAX_SKILL_NAME_LENGTH: usize = 64;
const MAX_DESCRIPTION_LENGTH: usize = 1024;
const MAX_COMPATIBILITY_LENGTH: usize = 500;

/// Allowed frontmatter fields per Agent Skills Spec.
const ALLOWED_FIELDS: &[&str] = &[
	"name",
	"description",
	"license",
	"allowed-tools",
	"metadata",
	"compatibility",
];

/// Normalize a string using NFKC normalization.
fn nfkc_normalize(s: &str) -> String {
	s.nfkc().collect()
}

/// Validate skill name format and directory match.
///
/// Skill names support i18n characters (Unicode letters) plus hyphens.
/// Names must be lowercase and cannot start/end with hyphens.
fn validate_name(name: &str, skill_dir: Option<&Path>) -> Vec<String> {
	let mut errors = Vec::new();

	if name.is_empty() {
		errors.push("Field 'name' must be a non-empty string".to_string());
		return errors;
	}

	let name = nfkc_normalize(name.trim());

	if name.len() > MAX_SKILL_NAME_LENGTH {
		errors.push(format!(
			"Skill name '{}' exceeds {} character limit ({} chars)",
			name,
			MAX_SKILL_NAME_LENGTH,
			name.len()
		));
	}

	// Check lowercase - for ASCII, this is straightforward.
	// For Unicode, we check if the string changes when lowercased.
	let lowercased = name.to_lowercase();
	if name != lowercased {
		errors.push(format!("Skill name '{}' must be lowercase", name));
	}

	if name.starts_with('-') || name.ends_with('-') {
		errors.push("Skill name cannot start or end with a hyphen".to_string());
	}

	if name.contains("--") {
		errors
			.push("Skill name cannot contain consecutive hyphens".to_string());
	}

	// Check for valid characters: letters, digits, and hyphens
	// Using Unicode character properties
	for c in name.chars() {
		if !c.is_alphanumeric() && c != '-' {
			errors.push(format!(
                "Skill name '{}' contains invalid characters. Only letters, digits, and hyphens are allowed.",
                name
            ));
			break;
		}
	}

	// Check directory name match
	if let Some(dir) = skill_dir {
		let dir_name = nfkc_normalize(
			dir.file_name()
				.unwrap_or_default()
				.to_string_lossy()
				.as_ref(),
		);
		if dir_name != name {
			errors.push(format!(
				"Directory name '{}' must match skill name '{}'",
				dir.file_name().unwrap_or_default().to_string_lossy(),
				name
			));
		}
	}

	errors
}

/// Validate description format.
fn validate_description(description: &str) -> Vec<String> {
	let mut errors = Vec::new();

	if description.is_empty() {
		errors
			.push("Field 'description' must be a non-empty string".to_string());
		return errors;
	}

	if description.len() > MAX_DESCRIPTION_LENGTH {
		errors.push(format!(
			"Description exceeds {} character limit ({} chars)",
			MAX_DESCRIPTION_LENGTH,
			description.len()
		));
	}

	errors
}

/// Validate compatibility format.
fn validate_compatibility(compatibility: &str) -> Vec<String> {
	let mut errors = Vec::new();

	if compatibility.len() > MAX_COMPATIBILITY_LENGTH {
		errors.push(format!(
			"Compatibility exceeds {} character limit ({} chars)",
			MAX_COMPATIBILITY_LENGTH,
			compatibility.len()
		));
	}

	errors
}

/// Validate that only allowed fields are present.
fn validate_metadata_fields(
	metadata: &HashMap<String, serde_yaml::Value>,
) -> Vec<String> {
	let mut errors = Vec::new();

	let extra_fields: Vec<&String> = metadata
		.keys()
		.filter(|k| !ALLOWED_FIELDS.contains(&k.as_str()))
		.collect();

	if !extra_fields.is_empty() {
		let extra: Vec<String> =
			extra_fields.iter().map(|s| (*s).clone()).collect();
		let allowed: Vec<&str> = ALLOWED_FIELDS.to_vec();
		errors.push(format!(
			"Unexpected fields in frontmatter: {}. Only {:?} are allowed.",
			extra.join(", "),
			allowed
		));
	}

	errors
}

/// Validate parsed skill metadata.
///
/// This is the core validation function that works on already-parsed metadata,
/// avoiding duplicate file I/O when called from the parser.
///
/// # Arguments
/// * `metadata` - Parsed YAML frontmatter dictionary
/// * `skill_dir` - Optional path to skill directory (for name-directory match check)
///
/// # Returns
/// List of validation error messages. Empty list means valid.
pub fn validate_metadata(
	metadata: &HashMap<String, serde_yaml::Value>,
	skill_dir: Option<&Path>,
) -> Vec<String> {
	let mut errors = Vec::new();

	errors.extend(validate_metadata_fields(metadata));

	// Validate name
	if let Some(name_value) = metadata.get("name") {
		if let Some(name) = name_value.as_str() {
			errors.extend(validate_name(name, skill_dir));
		} else {
			errors.push(
				"Missing required field in frontmatter: name".to_string(),
			);
		}
	} else {
		errors.push("Missing required field in frontmatter: name".to_string());
	}

	// Validate description
	if let Some(desc_value) = metadata.get("description") {
		if let Some(description) = desc_value.as_str() {
			errors.extend(validate_description(description));
		} else {
			errors.push(
				"Missing required field in frontmatter: description"
					.to_string(),
			);
		}
	} else {
		errors.push(
			"Missing required field in frontmatter: description".to_string(),
		);
	}

	// Validate compatibility if present
	if let Some(compat_value) = metadata.get("compatibility") {
		if let Some(compatibility) = compat_value.as_str() {
			errors.extend(validate_compatibility(compatibility));
		}
	}

	errors
}

/// Validate a skill directory.
///
/// # Arguments
/// * `skill_dir` - Path to the skill directory
///
/// # Returns
/// List of validation error messages. Empty list means valid.
pub fn validate(skill_dir: &Path) -> Vec<String> {
	let skill_dir = Path::new(skill_dir);

	if !skill_dir.exists() {
		return vec![format!("Path does not exist: {}", skill_dir.display())];
	}

	if !skill_dir.is_dir() {
		return vec![format!("Not a directory: {}", skill_dir.display())];
	}

	let skill_md = match find_skill_md(skill_dir) {
		Some(path) => path,
		None => return vec!["Missing required file: SKILL.md".to_string()],
	};

	let content = match std::fs::read_to_string(&skill_md) {
		Ok(c) => c,
		Err(e) => return vec![format!("Failed to read SKILL.md: {}", e)],
	};

	let (metadata, _) = match parse_frontmatter(&content) {
		Ok((m, b)) => (m, b),
		Err(e) => return vec![e.to_string()],
	};

	validate_metadata(&metadata, Some(skill_dir))
}
