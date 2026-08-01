//! Parser for .skill, .zip, and directory formats.

use crate::error::{Result, SkillError};
use crate::model::{Skill, SkillSource};
use std::path::{Path, PathBuf};

const MAX_SKILL_NAME_BYTES: usize = 64;
const MAX_SKILL_DESCRIPTION_BYTES: usize = 1024;
const MAX_SKILL_COMPATIBILITY_BYTES: usize = 500;
const MAX_SKILL_METADATA_VALUE_BYTES: usize = 4096;

/// Parse a .skill file (zip format).
///
/// # Arguments
/// * `path` - Path to the .skill file
///
/// # Returns
/// * `Ok(Skill)` - Parsed skill with directory structure info
///
/// # Errors
/// * `SkillError::Io` - If file operations fail
/// * `SkillError::Zip` - If zip reading fails
/// * `SkillError::Parse` - If SKILL.md parsing fails
pub fn parse_skill_file(path: &Path) -> Result<Skill> {
	let mut package = crate::package::open_skill_archive(path)?;
	let content = package.read_skill_md()?;
	let resource_paths = package.skill_files();

	let mut skill = parse_skill_md(&content)?;
	skill.source = SkillSource::SkillFile(path.to_path_buf());
	scan_archive_structure(&resource_paths, &mut skill);

	Ok(skill)
}

/// Parse a .zip file as a skill package.
///
/// This is an alias for `parse_skill_file` as .skill and .zip
/// have the same internal structure.
pub fn parse_zip(path: &Path) -> Result<Skill> {
	parse_skill_file(path)
}

/// Scan the archive structure and populate skill resource lists.
fn scan_archive_structure(
	resource_paths: &[(usize, String)],
	skill: &mut Skill,
) {
	for (_, relative) in resource_paths {
		// Categorize files
		if relative.starts_with("scripts/") {
			skill.scripts.push(relative.clone());
		} else if relative.starts_with("references/") {
			skill.references.push(relative.clone());
		} else if relative.starts_with("assets/") {
			skill.assets.push(relative.clone());
		}
	}
}

/// Parse a skill directory.
///
/// # Arguments
/// * `path` - Path to the skill directory
///
/// # Returns
/// * `Ok(Skill)` - Parsed skill with directory structure info
///
/// # Errors
/// * `SkillError::Io` - If file operations fail
/// * `SkillError::Parse` - If SKILL.md parsing fails
pub fn parse_skill_dir(path: &Path) -> Result<Skill> {
	if !path.exists() {
		return Err(SkillError::NotFound(format!(
			"Skill directory not found: {}",
			path.display()
		)));
	}

	if !path.is_dir() {
		return Err(SkillError::InvalidFormat(format!(
			"Not a directory: {}",
			path.display()
		)));
	}

	let (content, _) = crate::content::read_directory_skill_md(path)?;
	let mut skill = parse_skill_md(&content)?;
	skill.source = SkillSource::Directory(path.to_path_buf());

	// Scan directory structure
	scan_directory_structure(path, &mut skill)?;

	Ok(skill)
}

/// Scan a subdirectory and populate a skill resource list.
fn scan_subdir(base: &Path, subdir: &str, out: &mut Vec<String>) {
	if let Ok(entries) = std::fs::read_dir(base.join(subdir)) {
		for entry in entries.flatten() {
			if entry.file_type().is_ok_and(|ft| ft.is_file()) {
				out.push(format!(
					"{}/{}",
					subdir,
					entry.file_name().to_string_lossy()
				));
			}
		}
	}
}

/// Scan the directory structure and populate skill resource lists.
fn scan_directory_structure(path: &Path, skill: &mut Skill) -> Result<()> {
	scan_subdir(path, "scripts", &mut skill.scripts);
	scan_subdir(path, "references", &mut skill.references);
	scan_subdir(path, "assets", &mut skill.assets);
	Ok(())
}

/// Parse SKILL.md content into a Skill struct.
///
/// # Arguments
/// * `content` - Raw content of SKILL.md file
///
/// # Returns
/// * `Ok(Skill)` - Parsed skill
///
/// # Errors
/// * `SkillError::Parse` - If frontmatter parsing fails
pub fn parse_skill_md(content: &str) -> Result<Skill> {
	// Use skills-ref parser for frontmatter
	let (metadata, body) = skills_ref::parser::parse_frontmatter(content)
		.map_err(|e| SkillError::Parse(e.to_string()))?;

	// Extract required fields
	let name =
		metadata
			.get("name")
			.and_then(|v| v.as_str())
			.ok_or_else(|| {
				SkillError::Parse("Missing required field: name".to_string())
			})?;
	if name.len() > MAX_SKILL_NAME_BYTES {
		return Err(SkillError::Validation(format!(
			"Skill name exceeds the {MAX_SKILL_NAME_BYTES}-byte limit"
		)));
	}
	if name.chars().any(is_unsafe_metadata_character) {
		return Err(SkillError::Validation(
			"Skill name contains control or format characters".to_string(),
		));
	}

	let description = metadata
		.get("description")
		.and_then(|v| v.as_str())
		.ok_or_else(|| {
			SkillError::Parse("Missing required field: description".to_string())
		})?;
	if description.len() > MAX_SKILL_DESCRIPTION_BYTES {
		return Err(SkillError::Validation(format!(
				"Skill description exceeds the {MAX_SKILL_DESCRIPTION_BYTES}-byte limit"
			)));
	}

	// Extract optional fields
	let license = metadata
		.get("license")
		.and_then(|v| v.as_str())
		.map(String::from);

	let compatibility = metadata
		.get("compatibility")
		.and_then(|v| v.as_str())
		.map(String::from);
	validate_optional_metadata_bytes(
		"compatibility",
		compatibility.as_deref(),
		MAX_SKILL_COMPATIBILITY_BYTES,
	)?;

	let allowed_tools = metadata
		.get("allowed-tools")
		.and_then(|v| v.as_str())
		.map(String::from);
	validate_optional_metadata_bytes(
		"allowed-tools",
		allowed_tools.as_deref(),
		MAX_SKILL_METADATA_VALUE_BYTES,
	)?;

	let author = metadata
		.get("author")
		.and_then(|v| v.as_str())
		.map(String::from);
	validate_optional_metadata_bytes(
		"author",
		author.as_deref(),
		MAX_SKILL_METADATA_VALUE_BYTES,
	)?;

	let version = metadata
		.get("version")
		.map(|v| {
			if let Some(s) = v.as_str() {
				Ok(s.to_string())
			} else if let Some(n) = v.as_f64() {
				Ok(n.to_string())
			} else if let Some(n) = v.as_i64() {
				Ok(n.to_string())
			} else {
				Err(SkillError::Validation(
					"Skill version must be a string or number".to_string(),
				))
			}
		})
		.transpose()?;
	validate_optional_metadata_bytes(
		"version",
		version.as_deref(),
		MAX_SKILL_METADATA_VALUE_BYTES,
	)?;

	Ok(Skill {
		name: name.to_string(),
		description: description.to_string(),
		license,
		compatibility,
		allowed_tools,
		author,
		version,
		content: body,
		source: SkillSource::SkillMd(PathBuf::new()),
		scripts: Vec::new(),
		references: Vec::new(),
		assets: Vec::new(),
	})
}

/// Change the `name` field while retaining the remaining frontmatter and body.
pub fn rename_skill_md(content: &str, name: &str) -> Result<String> {
	let (mut metadata, body) =
		aghub_markdown::parse::<serde_yaml::Mapping>(content)
			.map_err(|error| SkillError::Parse(error.to_string()))?;
	metadata.insert(
		serde_yaml::Value::String("name".to_string()),
		serde_yaml::Value::String(name.to_string()),
	);
	let renamed = aghub_markdown::render(&metadata, body)
		.map_err(|error| SkillError::Parse(error.to_string()))?;
	let parsed = parse_skill_md(&renamed)?;
	if parsed.name != name {
		return Err(SkillError::Validation(
			"Renamed skill has an unexpected name".to_string(),
		));
	}
	Ok(renamed)
}

/// Update aghub-owned fields while retaining extension frontmatter fields.
pub fn update_skill_md(
	content: &str,
	name: &str,
	description: &str,
	author: Option<&str>,
	version: Option<&str>,
	allowed_tools: Option<&str>,
	body: Option<&str>,
) -> Result<String> {
	let (mut metadata, existing_body) =
		aghub_markdown::parse::<serde_yaml::Mapping>(content)
			.map_err(|error| SkillError::Parse(error.to_string()))?;
	metadata.insert(
		serde_yaml::Value::String("name".to_string()),
		serde_yaml::Value::String(name.to_string()),
	);
	metadata.insert(
		serde_yaml::Value::String("description".to_string()),
		serde_yaml::Value::String(description.replace('\n', " ")),
	);
	update_optional_metadata(&mut metadata, "author", author);
	update_optional_metadata(&mut metadata, "version", version);
	update_optional_metadata(&mut metadata, "allowed-tools", allowed_tools);
	let updated =
		aghub_markdown::render(&metadata, body.unwrap_or(existing_body))
			.map_err(|error| SkillError::Parse(error.to_string()))?;
	parse_skill_md(&updated)?;
	Ok(updated)
}

fn update_optional_metadata(
	metadata: &mut serde_yaml::Mapping,
	key: &str,
	value: Option<&str>,
) {
	let key = serde_yaml::Value::String(key.to_string());
	if let Some(value) = value {
		metadata.insert(key, serde_yaml::Value::String(value.to_string()));
	} else {
		metadata.remove(&key);
	}
}

fn validate_optional_metadata_bytes(
	field: &str,
	value: Option<&str>,
	max_bytes: usize,
) -> Result<()> {
	if value.is_some_and(|value| value.len() > max_bytes) {
		return Err(SkillError::Validation(format!(
			"Skill {field} exceeds the {max_bytes}-byte limit"
		)));
	}
	Ok(())
}

fn is_unsafe_metadata_character(character: char) -> bool {
	character.is_control()
		|| matches!(
			character,
			'\u{061C}'
				| '\u{200B}'..='\u{200F}'
				| '\u{202A}'..='\u{202E}'
				| '\u{2060}'..='\u{206F}'
				| '\u{FEFF}'
				| '\u{E0000}'..='\u{E007F}'
		)
}

/// Auto-detect format and parse skill.
///
/// This function automatically detects the input format based on the path:
/// - If it's a directory → parse as skill directory
/// - If it ends with .skill or .zip → parse as skill file
/// - If it ends with .md or is named SKILL.md → parse as single SKILL.md file
///
/// # Arguments
/// * `path` - Path to skill (directory, .skill file, .zip file, or .md file)
///
/// # Returns
/// * `Ok(Skill)` - Parsed skill
pub fn parse(path: &Path) -> Result<Skill> {
	if !path.exists() {
		return Err(SkillError::NotFound(format!(
			"Path not found: {}",
			path.display()
		)));
	}

	let path_str = path.to_string_lossy().to_lowercase();

	if path.is_dir() {
		parse_skill_dir(path)
	} else if path_str.ends_with(".skill") || path_str.ends_with(".zip") {
		parse_skill_file(path)
	} else if path_str.ends_with(".md")
		|| path.file_name() == Some("SKILL.md".as_ref())
	{
		// Parse as single SKILL.md file
		let content = crate::content::read_standalone_skill_md(path)?;
		let mut skill = parse_skill_md(&content)?;
		skill.source = SkillSource::SkillMd(path.to_path_buf());
		Ok(skill)
	} else {
		Err(SkillError::InvalidFormat(format!(
			"Cannot determine skill format for: {}",
			path.display()
		)))
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use tempfile::TempDir;

	fn create_test_skill_dir(dir: &Path) -> PathBuf {
		let skill_dir = dir.join("test-skill");
		std::fs::create_dir(&skill_dir).unwrap();

		// Create SKILL.md
		std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: test-skill\ndescription: A test skill\nlicense: MIT\n---\n\n# Instructions\nDo something useful.\n",
        )
        .unwrap();

		// Create scripts directory with a file
		let scripts_dir = skill_dir.join("scripts");
		std::fs::create_dir(&scripts_dir).unwrap();
		std::fs::write(scripts_dir.join("test.sh"), "#!/bin/bash\necho hello")
			.unwrap();

		// Create references directory with a file
		let refs_dir = skill_dir.join("references");
		std::fs::create_dir(&refs_dir).unwrap();
		std::fs::write(refs_dir.join("guide.md"), "# Guide\n").unwrap();

		skill_dir
	}

	#[test]
	fn test_parse_skill_md() {
		let content = "---\nname: my-skill\ndescription: My description\nlicense: Apache-2.0\nallowed-tools: read,write\n---\n\n# Instructions\nDo this.\n";

		let skill = parse_skill_md(content).unwrap();
		assert_eq!(skill.name, "my-skill");
		assert_eq!(skill.description, "My description");
		assert_eq!(skill.license, Some("Apache-2.0".to_string()));
		assert_eq!(skill.allowed_tools, Some("read,write".to_string()));
		assert_eq!(skill.content, "# Instructions\nDo this.");
	}

	#[test]
	fn test_parse_skill_dir() {
		let temp_dir = TempDir::new().unwrap();
		let skill_dir = create_test_skill_dir(temp_dir.path());

		let skill = parse_skill_dir(&skill_dir).unwrap();
		assert_eq!(skill.name, "test-skill");
		assert_eq!(skill.description, "A test skill");
		assert_eq!(skill.license, Some("MIT".to_string()));
		assert_eq!(skill.scripts.len(), 1);
		assert_eq!(skill.references.len(), 1);
	}

	#[test]
	fn parse_rejects_oversized_skill_md() {
		let temp_dir = TempDir::new().unwrap();
		let skill_md = temp_dir.path().join("SKILL.md");
		let manifest = std::fs::File::create(&skill_md).unwrap();
		manifest
			.set_len(crate::MAX_SKILL_CONTENT_BYTES as u64 + 1)
			.unwrap();

		assert!(parse(&skill_md).is_err());
	}

	#[cfg(unix)]
	#[test]
	fn parse_skill_dir_rejects_symlinked_skill_md() {
		use std::os::unix::fs::symlink;

		let temp_dir = TempDir::new().unwrap();
		let skill_dir = temp_dir.path().join("linked-skill");
		std::fs::create_dir_all(&skill_dir).unwrap();
		let manifest = temp_dir.path().join("outside.md");
		std::fs::write(
			&manifest,
			"---\nname: linked\ndescription: linked\n---\n",
		)
		.unwrap();
		symlink(&manifest, skill_dir.join("SKILL.md")).unwrap();

		assert!(parse_skill_dir(&skill_dir).is_err());
	}

	#[test]
	fn test_parse_auto_detect() {
		let temp_dir = TempDir::new().unwrap();
		let skill_dir = create_test_skill_dir(temp_dir.path());

		// Test directory detection
		let skill = parse(&skill_dir).unwrap();
		assert_eq!(skill.name, "test-skill");

		// Test .skill file detection
		let skill_file = temp_dir.path().join("test-skill.skill");
		crate::package::pack(&skill_dir, &skill_file).unwrap();
		let skill = parse(&skill_file).unwrap();
		assert_eq!(skill.name, "test-skill");

		// Test .md file detection
		let md_file = temp_dir.path().join("standalone.md");
		std::fs::write(
			&md_file,
			"---\nname: standalone\ndescription: A standalone skill\n---\n",
		)
		.unwrap();
		let skill = parse(&md_file).unwrap();
		assert_eq!(skill.name, "standalone");
	}

	#[test]
	fn test_parse_missing_name() {
		let content = "---\ndescription: Missing name\n---\n";
		let result = parse_skill_md(content);
		assert!(result.is_err());
	}

	// --- Non-string frontmatter rejection (ported from skill-matching.test.ts) ---

	#[test]
	fn test_numeric_name_rejected() {
		// YAML parses `name: 123` as an integer, not a string
		// .and_then(|v| v.as_str()) returns None → error
		let content = "---\nname: 123\ndescription: A valid description\n---\n";
		let result = parse_skill_md(content);
		assert!(result.is_err(), "Expected error for numeric name");
	}

	#[test]
	fn test_boolean_name_rejected() {
		let content =
			"---\nname: true\ndescription: A valid description\n---\n";
		let result = parse_skill_md(content);
		assert!(result.is_err(), "Expected error for boolean name");
	}

	#[test]
	fn test_array_name_rejected() {
		let content =
			"---\nname:\n  - foo\n  - bar\ndescription: A valid description\n---\n";
		let result = parse_skill_md(content);
		assert!(result.is_err(), "Expected error for array name");
	}

	#[test]
	fn test_numeric_description_rejected() {
		let content = "---\nname: valid-name\ndescription: 456\n---\n";
		let result = parse_skill_md(content);
		assert!(result.is_err(), "Expected error for numeric description");
	}

	#[test]
	fn test_valid_string_name_and_description_accepted() {
		let content =
			"---\nname: valid-skill\ndescription: A valid skill\n---\n";
		let skill = parse_skill_md(content).unwrap();
		assert_eq!(skill.name, "valid-skill");
		assert_eq!(skill.description, "A valid skill");
	}

	#[test]
	fn parse_skill_md_rejects_terminal_control_in_name() {
		let content = "---\nname: \"unsafe\\u001b]52;c;payload\\u0007\"\ndescription: A valid skill\n---\n";

		assert!(matches!(
			parse_skill_md(content),
			Err(SkillError::Validation(_))
		));
	}

	#[test]
	fn parse_skill_md_rejects_names_over_spec_limit() {
		let content = format!(
			"---\nname: {}\ndescription: A valid skill\n---\n",
			"a".repeat(65)
		);

		assert!(matches!(
			parse_skill_md(&content),
			Err(SkillError::Validation(_))
		));
	}

	#[test]
	fn parse_skill_md_keeps_supported_extension_fields() {
		let content = "---\nname: valid-skill\ndescription: A valid skill\nauthor: Akara\nversion: 1.0.0\n---\n";

		let skill = parse_skill_md(content).unwrap();
		assert_eq!(skill.author.as_deref(), Some("Akara"));
		assert_eq!(skill.version.as_deref(), Some("1.0.0"));
	}

	#[test]
	fn parse_skill_md_rejects_oversized_response_metadata() {
		let content = format!(
			"---\nname: valid-skill\ndescription: A valid skill\nauthor: {}\n---\n",
			"a".repeat(MAX_SKILL_METADATA_VALUE_BYTES + 1)
		);

		assert!(matches!(
			parse_skill_md(&content),
			Err(SkillError::Validation(_))
		));
	}

	#[test]
	fn parse_skill_md_rejects_structured_version() {
		let content = "---\nname: valid-skill\ndescription: A valid skill\nversion:\n  payload: value\n---\n";

		assert!(matches!(
			parse_skill_md(content),
			Err(SkillError::Validation(_))
		));
	}

	#[test]
	fn rename_skill_md_retains_extension_fields_and_body() {
		let content = "---\nname: old-name\ndescription: Demo\nlicense: MIT\ncompatibility: macOS\ncustom:\n  owner: akara\n---\n# Instructions\n";

		let renamed = rename_skill_md(content, "new-name").unwrap();
		let (metadata, body) =
			aghub_markdown::parse::<serde_yaml::Mapping>(&renamed).unwrap();

		assert_eq!(
			metadata.get("name").and_then(serde_yaml::Value::as_str),
			Some("new-name")
		);
		assert_eq!(
			metadata.get("license").and_then(serde_yaml::Value::as_str),
			Some("MIT")
		);
		assert_eq!(
			metadata
				.get("compatibility")
				.and_then(serde_yaml::Value::as_str),
			Some("macOS")
		);
		assert!(metadata.get("custom").is_some());
		assert_eq!(body, "# Instructions\n");
	}

	#[test]
	fn update_skill_md_retains_unowned_frontmatter_fields() {
		let content = "---\nname: demo\ndescription: Before\nlicense: MIT\ncompatibility: macOS\ncustom:\n  owner: akara\n---\n# Before\n";

		let updated = update_skill_md(
			content,
			"renamed",
			"After",
			Some("Eric"),
			None,
			Some("Read,Write"),
			Some("# After\n"),
		)
		.unwrap();
		let (metadata, body) =
			aghub_markdown::parse::<serde_yaml::Mapping>(&updated).unwrap();

		assert_eq!(
			metadata.get("name").and_then(serde_yaml::Value::as_str),
			Some("renamed")
		);
		assert_eq!(
			metadata
				.get("description")
				.and_then(serde_yaml::Value::as_str),
			Some("After")
		);
		assert_eq!(
			metadata.get("license").and_then(serde_yaml::Value::as_str),
			Some("MIT")
		);
		assert_eq!(
			metadata
				.get("compatibility")
				.and_then(serde_yaml::Value::as_str),
			Some("macOS")
		);
		assert!(metadata.get("custom").is_some());
		assert_eq!(
			metadata.get("author").and_then(serde_yaml::Value::as_str),
			Some("Eric")
		);
		assert_eq!(
			metadata
				.get("allowed-tools")
				.and_then(serde_yaml::Value::as_str),
			Some("Read,Write")
		);
		assert!(!metadata.contains_key("version"));
		assert_eq!(body, "# After\n");
	}
}
