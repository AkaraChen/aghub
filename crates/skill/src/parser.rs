//! Parser for .skill, .zip, and directory formats.

use crate::error::{Result, SkillError};
use crate::model::{Skill, SkillSource};
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use zip::ZipArchive;

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
	if !path.exists() {
		return Err(SkillError::NotFound(format!(
			"Skill file not found: {}",
			path.display()
		)));
	}

	let file = File::open(path)?;
	let mut archive = ZipArchive::new(file)?;

	// Find SKILL.md in the archive
	let mut skill_md_content: Option<String> = None;
	let mut skill_root: Option<String> = None;

	for i in 0..archive.len() {
		let mut file = archive.by_index(i)?;
		let name = file.name().to_string();

		if name.ends_with("SKILL.md") || name.ends_with("skill.md") {
			let mut content = String::new();
			file.read_to_string(&mut content)?;
			skill_md_content = Some(content);
			// Get the parent directory of SKILL.md as skill root
			skill_root = Path::new(&name)
				.parent()
				.map(|p| p.to_string_lossy().to_string());
			break;
		}
	}

	let content =
		skill_md_content.ok_or_else(|| SkillError::MissingSkillMd {
			path: path.to_path_buf(),
		})?;

	let mut skill = parse_skill_md(&content)?;
	skill.source = SkillSource::SkillFile(path.to_path_buf());

	// Scan directory structure if we have a skill root
	if let Some(root) = skill_root {
		scan_archive_structure(&mut archive, &root, &mut skill)?;
	}

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
	archive: &mut ZipArchive<File>,
	root: &str,
	skill: &mut Skill,
) -> Result<()> {
	let root_prefix = if root.is_empty() {
		String::new()
	} else {
		format!("{}/", root)
	};

	for i in 0..archive.len() {
		let file = archive.by_index(i)?;
		let name = file.name();

		// Skip directories and files outside the skill root
		if !name.starts_with(&root_prefix) || name.ends_with('/') {
			continue;
		}

		// Get the relative path from skill root
		let relative = &name[root_prefix.len()..];

		// Categorize files
		if relative.starts_with("scripts/") {
			skill.scripts.push(relative.to_string());
		} else if relative.starts_with("references/") {
			skill.references.push(relative.to_string());
		} else if relative.starts_with("assets/") {
			skill.assets.push(relative.to_string());
		}
	}

	Ok(())
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

	// Find and read SKILL.md
	let skill_md =
		skills_ref::parser::find_skill_md(path).ok_or_else(|| {
			SkillError::MissingSkillMd {
				path: path.to_path_buf(),
			}
		})?;

	let content = std::fs::read_to_string(&skill_md)?;
	let mut skill = parse_skill_md(&content)?;
	skill.source = SkillSource::Directory(path.to_path_buf());

	// Scan directory structure
	scan_directory_structure(path, &mut skill)?;

	Ok(skill)
}

/// Scan the directory structure and populate skill resource lists.
fn scan_directory_structure(path: &Path, skill: &mut Skill) -> Result<()> {
	// Scan scripts directory
	let scripts_dir = path.join("scripts");
	if scripts_dir.exists() && scripts_dir.is_dir() {
		for entry in std::fs::read_dir(&scripts_dir)? {
			let entry = entry?;
			if entry.file_type()?.is_file() {
				let name = entry.file_name().to_string_lossy().to_string();
				skill.scripts.push(format!("scripts/{}", name));
			}
		}
	}

	// Scan references directory
	let refs_dir = path.join("references");
	if refs_dir.exists() && refs_dir.is_dir() {
		for entry in std::fs::read_dir(&refs_dir)? {
			let entry = entry?;
			if entry.file_type()?.is_file() {
				let name = entry.file_name().to_string_lossy().to_string();
				skill.references.push(format!("references/{}", name));
			}
		}
	}

	// Scan assets directory
	let assets_dir = path.join("assets");
	if assets_dir.exists() && assets_dir.is_dir() {
		for entry in std::fs::read_dir(&assets_dir)? {
			let entry = entry?;
			if entry.file_type()?.is_file() {
				let name = entry.file_name().to_string_lossy().to_string();
				skill.assets.push(format!("assets/{}", name));
			}
		}
	}

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

	let description = metadata
		.get("description")
		.and_then(|v| v.as_str())
		.ok_or_else(|| {
			SkillError::Parse("Missing required field: description".to_string())
		})?;

	// Extract optional fields
	let license = metadata
		.get("license")
		.and_then(|v| v.as_str())
		.map(String::from);

	let compatibility = metadata
		.get("compatibility")
		.and_then(|v| v.as_str())
		.map(String::from);

	let allowed_tools = metadata
		.get("allowed-tools")
		.and_then(|v| v.as_str())
		.map(String::from);

	// Extract metadata as HashMap<String, String>
	let skill_metadata: HashMap<String, String> = metadata
		.get("metadata")
		.and_then(|v| v.as_mapping())
		.map(|m| {
			m.iter()
				.filter_map(|(k, v)| {
					k.as_str().map(|key| {
						let value = match v {
							serde_yaml::Value::String(s) => s.clone(),
							serde_yaml::Value::Number(n) => n.to_string(),
							serde_yaml::Value::Bool(b) => b.to_string(),
							_ => format!("{:?}", v),
						};
						(key.to_string(), value)
					})
				})
				.collect()
		})
		.unwrap_or_default();

	Ok(Skill {
		name: name.to_string(),
		description: description.to_string(),
		license,
		compatibility,
		allowed_tools,
		metadata: skill_metadata,
		content: body,
		source: SkillSource::SkillMd(PathBuf::new()),
		scripts: Vec::new(),
		references: Vec::new(),
		assets: Vec::new(),
	})
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
		let content = std::fs::read_to_string(path)?;
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
}
