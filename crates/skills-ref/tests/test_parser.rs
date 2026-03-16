//! Tests for parser module.

use skills_ref::parser::{find_skill_md, parse_frontmatter, read_properties};
use tempfile::TempDir;

#[test]
fn test_valid_frontmatter() {
	let content = r#"---
name: my-skill
description: A test skill
---
# My Skill

Instructions here.
"#;
	let (metadata, body) = parse_frontmatter(content).unwrap();
	assert_eq!(metadata["name"].as_str().unwrap(), "my-skill");
	assert_eq!(metadata["description"].as_str().unwrap(), "A test skill");
	assert!(body.contains("# My Skill"));
}

#[test]
fn test_missing_frontmatter() {
	let content = "# No frontmatter here";
	let result = parse_frontmatter(content);
	assert!(result.is_err());
	let err = result.unwrap_err().to_string();
	assert!(err.contains("must start with YAML frontmatter"));
}

#[test]
fn test_unclosed_frontmatter() {
	let content = r#"---
name: my-skill
description: A test skill
"#;
	let result = parse_frontmatter(content);
	assert!(result.is_err());
	let err = result.unwrap_err().to_string();
	assert!(err.contains("not properly closed"));
}

#[test]
fn test_invalid_yaml() {
	let content = r#"---
name: [invalid
description: broken
---
Body here
"#;
	let result = parse_frontmatter(content);
	assert!(result.is_err());
	let err = result.unwrap_err().to_string();
	assert!(err.contains("Invalid YAML"));
}

#[test]
fn test_non_dict_frontmatter() {
	let content = r#"---
- just
- a
- list
---
Body
"#;
	let result = parse_frontmatter(content);
	assert!(result.is_err());
	let err = result.unwrap_err().to_string();
	assert!(err.contains("must be a YAML mapping"));
}

#[test]
fn test_read_valid_skill() {
	let temp = TempDir::new().unwrap();
	let skill_dir = temp.path().join("my-skill");
	std::fs::create_dir(&skill_dir).unwrap();
	std::fs::write(
		skill_dir.join("SKILL.md"),
		r#"---
name: my-skill
description: A test skill
license: MIT
---
# My Skill
"#,
	)
	.unwrap();

	let props = read_properties(&skill_dir).unwrap();
	assert_eq!(props.name, "my-skill");
	assert_eq!(props.description, "A test skill");
	assert_eq!(props.license, Some("MIT".to_string()));
}

#[test]
fn test_read_with_metadata() {
	let temp = TempDir::new().unwrap();
	let skill_dir = temp.path().join("my-skill");
	std::fs::create_dir(&skill_dir).unwrap();
	std::fs::write(
		skill_dir.join("SKILL.md"),
		r#"---
name: my-skill
description: A test skill
metadata:
  author: Test Author
  version: 1.0
---
Body
"#,
	)
	.unwrap();

	let props = read_properties(&skill_dir).unwrap();
	assert_eq!(
		props.metadata.get("author"),
		Some(&"Test Author".to_string())
	);
	assert_eq!(props.metadata.get("version"), Some(&"1.0".to_string()));
}

#[test]
fn test_missing_skill_md() {
	let temp = TempDir::new().unwrap();
	let result = read_properties(temp.path());
	assert!(result.is_err());
	let err = result.unwrap_err().to_string();
	assert!(err.contains("SKILL.md not found"));
}

#[test]
fn test_missing_name() {
	let temp = TempDir::new().unwrap();
	let skill_dir = temp.path().join("my-skill");
	std::fs::create_dir(&skill_dir).unwrap();
	std::fs::write(
		skill_dir.join("SKILL.md"),
		r#"---
description: A test skill
---
Body
"#,
	)
	.unwrap();

	let result = read_properties(&skill_dir);
	assert!(result.is_err());
	let err = result.unwrap_err().to_string();
	assert!(err.contains("Missing required field"));
	assert!(err.contains("name"));
}

#[test]
fn test_missing_description() {
	let temp = TempDir::new().unwrap();
	let skill_dir = temp.path().join("my-skill");
	std::fs::create_dir(&skill_dir).unwrap();
	std::fs::write(
		skill_dir.join("SKILL.md"),
		r#"---
name: my-skill
---
Body
"#,
	)
	.unwrap();

	let result = read_properties(&skill_dir);
	assert!(result.is_err());
	let err = result.unwrap_err().to_string();
	assert!(err.contains("Missing required field"));
	assert!(err.contains("description"));
}

#[test]
fn test_find_skill_md_prefers_uppercase() {
	let temp = TempDir::new().unwrap();
	let skill_dir = temp.path().join("my-skill");
	std::fs::create_dir(&skill_dir).unwrap();
	std::fs::write(skill_dir.join("SKILL.md"), "uppercase").unwrap();
	std::fs::write(skill_dir.join("skill.md"), "lowercase").unwrap();

	let result = find_skill_md(&skill_dir);
	assert!(result.is_some());
	assert_eq!(result.unwrap().file_name().unwrap(), "SKILL.md");
}

#[test]
fn test_find_skill_md_accepts_lowercase() {
	let temp = TempDir::new().unwrap();
	let skill_dir = temp.path().join("my-skill");
	std::fs::create_dir(&skill_dir).unwrap();
	std::fs::write(skill_dir.join("skill.md"), "lowercase").unwrap();

	let result = find_skill_md(&skill_dir);
	assert!(result.is_some());
	// Check case-insensitively since some filesystems are case-insensitive
	assert!(
		result
			.unwrap()
			.file_name()
			.unwrap()
			.to_string_lossy()
			.to_lowercase()
			== "skill.md"
	);
}

#[test]
fn test_find_skill_md_returns_none_when_missing() {
	let temp = TempDir::new().unwrap();
	let skill_dir = temp.path().join("my-skill");
	std::fs::create_dir(&skill_dir).unwrap();

	let result = find_skill_md(&skill_dir);
	assert!(result.is_none());
}

#[test]
fn test_read_properties_with_lowercase_skill_md() {
	let temp = TempDir::new().unwrap();
	let skill_dir = temp.path().join("my-skill");
	std::fs::create_dir(&skill_dir).unwrap();
	std::fs::write(
		skill_dir.join("skill.md"),
		r#"---
name: my-skill
description: A test skill
---
# My Skill
"#,
	)
	.unwrap();

	let props = read_properties(&skill_dir).unwrap();
	assert_eq!(props.name, "my-skill");
	assert_eq!(props.description, "A test skill");
}

#[test]
fn test_read_with_allowed_tools() {
	let temp = TempDir::new().unwrap();
	let skill_dir = temp.path().join("my-skill");
	std::fs::create_dir(&skill_dir).unwrap();
	std::fs::write(
		skill_dir.join("SKILL.md"),
		r#"---
name: my-skill
description: A test skill
allowed-tools: Bash(jq:*) Bash(git:*)
---
Body
"#,
	)
	.unwrap();

	let props = read_properties(&skill_dir).unwrap();
	assert_eq!(
		props.allowed_tools,
		Some("Bash(jq:*) Bash(git:*)".to_string())
	);

	// Verify to_dict outputs as "allowed-tools" (hyphenated)
	let dict = props.to_dict();
	assert_eq!(
		dict["allowed-tools"].as_str().unwrap(),
		"Bash(jq:*) Bash(git:*)"
	);
}
