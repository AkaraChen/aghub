//! Validation for skill packages.

use std::path::Path;

/// Validate a .skill file.
///
/// # Arguments
/// * `path` - Path to the .skill file
///
/// # Returns
/// List of validation error messages. Empty list means valid.
pub fn validate_skill_file(path: &Path) -> Vec<String> {
	let mut errors = Vec::new();

	if !path.exists() {
		return vec![format!("File not found: {}", path.display())];
	}

	// Try to parse as skill file
	match crate::parser::parse_skill_file(path) {
		Ok(skill) => {
			// Validate the parsed skill
			errors.extend(validate_skill(&skill));
		}
		Err(e) => {
			errors.push(e.to_string());
		}
	}

	errors
}

/// Validate a .zip file as a skill package.
///
/// # Arguments
/// * `path` - Path to the .zip file
///
/// # Returns
/// List of validation error messages. Empty list means valid.
pub fn validate_zip(path: &Path) -> Vec<String> {
	validate_skill_file(path)
}

/// Validate a skill directory.
///
/// Delegates to skills-ref validator but also checks directory structure.
///
/// # Arguments
/// * `path` - Path to the skill directory
///
/// # Returns
/// List of validation error messages. Empty list means valid.
pub fn validate_skill_dir(path: &Path) -> Vec<String> {
	let mut errors = skills_ref::validator::validate(path);

	// Additional structure validation
	if let Ok(skill) = crate::parser::parse_skill_dir(path) {
		errors.extend(validate_skill_structure(&skill));
	}

	errors
}

/// Unified validation - auto-detect format and validate.
///
/// # Arguments
/// * `path` - Path to skill (directory, .skill file, .zip file, or .md file)
///
/// # Returns
/// List of validation error messages. Empty list means valid.
pub fn validate(path: &Path) -> Vec<String> {
	if !path.exists() {
		return vec![format!("Path not found: {}", path.display())];
	}

	let path_str = path.to_string_lossy().to_lowercase();

	if path.is_dir() {
		validate_skill_dir(path)
	} else if path_str.ends_with(".skill") || path_str.ends_with(".zip") {
		validate_skill_file(path)
	} else if path_str.ends_with(".md") {
		// Validate single SKILL.md file
		match crate::parser::parse_skill_md(
			&std::fs::read_to_string(path).unwrap_or_default(),
		) {
			Ok(skill) => validate_skill(&skill),
			Err(e) => vec![e.to_string()],
		}
	} else {
		vec![format!(
			"Cannot determine skill format for: {}",
			path.display()
		)]
	}
}

/// Validate a parsed skill's metadata and content.
fn validate_skill(skill: &crate::model::Skill) -> Vec<String> {
	let mut errors = Vec::new();

	// Validate name is not empty
	if skill.name.trim().is_empty() {
		errors.push("Skill name cannot be empty".to_string());
	}

	// Validate name format
	if skill.name.contains(' ') {
		errors.push(format!(
			"Skill name '{}' contains spaces; use hyphens instead",
			skill.name
		));
	}

	// Validate description is not empty
	if skill.description.trim().is_empty() {
		errors.push("Skill description cannot be empty".to_string());
	}

	// Validate description length (warning if too short)
	if skill.description.len() < 10 {
		errors.push(format!(
            "Skill description '{}' is very short ({} chars); consider adding more detail",
            skill.description,
            skill.description.len()
        ));
	}

	errors
}

/// Validate skill directory structure.
fn validate_skill_structure(skill: &crate::model::Skill) -> Vec<String> {
	let mut errors = Vec::new();

	// Validate resource paths are valid
	for script in &skill.scripts {
		if script.contains("..") {
			errors.push(format!(
				"Invalid script path (contains '..'): {}",
				script
			));
		}
	}

	for reference in &skill.references {
		if reference.contains("..") {
			errors.push(format!(
				"Invalid reference path (contains '..'): {}",
				reference
			));
		}
	}

	for asset in &skill.assets {
		if asset.contains("..") {
			errors
				.push(format!("Invalid asset path (contains '..'): {}", asset));
		}
	}

	errors
}

#[cfg(test)]
mod tests {
	use super::*;
	use tempfile::TempDir;

	fn create_test_skill_dir(dir: &Path, name: &str) -> std::path::PathBuf {
		let skill_dir = dir.join(name);
		std::fs::create_dir(&skill_dir).unwrap();

		// Create SKILL.md
		std::fs::write(
            skill_dir.join("SKILL.md"),
            format!(
                "---\nname: {}\ndescription: A test skill\n---\n\n# Instructions\n",
                name
            ),
        )
        .unwrap();

		skill_dir
	}

	#[test]
	fn test_validate_skill_dir_valid() {
		let temp_dir = TempDir::new().unwrap();
		let skill_dir = create_test_skill_dir(temp_dir.path(), "test-skill");

		let errors = validate_skill_dir(&skill_dir);
		assert!(errors.is_empty(), "Expected no errors, got: {:?}", errors);
	}

	#[test]
	fn test_validate_skill_dir_missing_skill_md() {
		let temp_dir = TempDir::new().unwrap();
		let skill_dir = temp_dir.path().join("empty-skill");
		std::fs::create_dir(&skill_dir).unwrap();

		let errors = validate_skill_dir(&skill_dir);
		assert!(!errors.is_empty());
		assert!(errors.iter().any(|e| e.contains("SKILL.md")));
	}

	#[test]
	fn test_validate_skill_file() {
		let temp_dir = TempDir::new().unwrap();
		let skill_dir =
			create_test_skill_dir(temp_dir.path(), "packaged-skill");
		let skill_file = temp_dir.path().join("packaged-skill.skill");

		// Pack the skill
		crate::package::pack(&skill_dir, &skill_file).unwrap();

		// Validate the packed file
		let errors = validate_skill_file(&skill_file);
		assert!(errors.is_empty(), "Expected no errors, got: {:?}", errors);
	}

	#[test]
	fn test_validate_skill_with_spaces_in_name() {
		// Test the validate_skill function directly rather than the full directory validation
		// which includes directory name matching
		let skill = crate::model::Skill {
			name: "bad name".to_string(),
			description: "A test skill with a bad name".to_string(),
			license: None,
			compatibility: None,
			allowed_tools: None,
			author: None,
			version: None,
			content: String::new(),
			source: crate::model::SkillSource::SkillMd(
				std::path::PathBuf::new(),
			),
			scripts: vec![],
			references: vec![],
			assets: vec![],
		};

		let errors = validate_skill(&skill);
		assert!(
			errors.iter().any(|e| e.contains("spaces")),
			"Expected error about spaces in name, got: {:?}",
			errors
		);
	}

	#[test]
	fn test_validate_auto_detect() {
		let temp_dir = TempDir::new().unwrap();
		let skill_dir = create_test_skill_dir(temp_dir.path(), "auto-test");

		// Validate directory
		let errors = validate(&skill_dir);
		assert!(errors.is_empty());

		// Pack and validate file
		let skill_file = temp_dir.path().join("auto-test.skill");
		crate::package::pack(&skill_dir, &skill_file).unwrap();
		let errors = validate(&skill_file);
		assert!(errors.is_empty());
	}

	// --- Path traversal tests (ported from subpath-traversal.test.ts) ---

	fn make_skill_with_resources(
		scripts: Vec<&str>,
		references: Vec<&str>,
		assets: Vec<&str>,
	) -> crate::model::Skill {
		crate::model::Skill {
			name: "test-skill".to_string(),
			description: "A test skill".to_string(),
			license: None,
			compatibility: None,
			allowed_tools: None,
			author: None,
			version: None,
			content: String::new(),
			source: crate::model::SkillSource::SkillMd(
				std::path::PathBuf::new(),
			),
			scripts: scripts.iter().map(|s| s.to_string()).collect(),
			references: references.iter().map(|s| s.to_string()).collect(),
			assets: assets.iter().map(|s| s.to_string()).collect(),
		}
	}

	#[test]
	fn test_traversal_in_scripts() {
		let skill = make_skill_with_resources(
			vec!["scripts/../../../etc/passwd"],
			vec![],
			vec![],
		);
		let errors = validate_skill_structure(&skill);
		assert!(
			!errors.is_empty(),
			"Expected error for traversal in scripts"
		);
		assert!(errors.iter().any(|e| e.contains("..")));
	}

	#[test]
	fn test_traversal_in_references() {
		let skill = make_skill_with_resources(
			vec![],
			vec!["references/../../etc/shadow"],
			vec![],
		);
		let errors = validate_skill_structure(&skill);
		assert!(
			!errors.is_empty(),
			"Expected error for traversal in references"
		);
		assert!(errors.iter().any(|e| e.contains("..")));
	}

	#[test]
	fn test_traversal_in_assets() {
		let skill =
			make_skill_with_resources(vec![], vec![], vec!["assets/../secret"]);
		let errors = validate_skill_structure(&skill);
		assert!(!errors.is_empty(), "Expected error for traversal in assets");
		assert!(errors.iter().any(|e| e.contains("..")));
	}

	#[test]
	fn test_valid_resource_paths_accepted() {
		let skill = make_skill_with_resources(
			vec!["scripts/helper.sh", "scripts/install.sh"],
			vec!["references/guide.md"],
			vec!["assets/logo.png"],
		);
		let errors = validate_skill_structure(&skill);
		assert!(
			errors.is_empty(),
			"Expected no errors for valid paths, got: {:?}",
			errors
		);
	}
}
