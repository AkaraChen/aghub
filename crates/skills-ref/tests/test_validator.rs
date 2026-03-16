//! Tests for validator module.

use skills_ref::validator::validate;
use tempfile::TempDir;

#[test]
fn test_valid_skill() {
    let temp = TempDir::new().unwrap();
    let skill_dir = temp.path().join("my-skill");
    std::fs::create_dir(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        r#"---
name: my-skill
description: A test skill
---
# My Skill
"#,
    )
    .unwrap();

    let errors = validate(&skill_dir);
    assert!(errors.is_empty());
}

#[test]
fn test_nonexistent_path() {
    let temp = TempDir::new().unwrap();
    let errors = validate(&temp.path().join("nonexistent"));
    assert_eq!(errors.len(), 1);
    assert!(errors[0].contains("does not exist"));
}

#[test]
fn test_not_a_directory() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("file.txt");
    std::fs::write(&file_path, "test").unwrap();

    let errors = validate(&file_path);
    assert_eq!(errors.len(), 1);
    assert!(errors[0].contains("Not a directory"));
}

#[test]
fn test_missing_skill_md() {
    let temp = TempDir::new().unwrap();
    let skill_dir = temp.path().join("my-skill");
    std::fs::create_dir(&skill_dir).unwrap();

    let errors = validate(&skill_dir);
    assert_eq!(errors.len(), 1);
    assert!(errors[0].contains("Missing required file: SKILL.md"));
}

#[test]
fn test_invalid_name_uppercase() {
    let temp = TempDir::new().unwrap();
    let skill_dir = temp.path().join("MySkill");
    std::fs::create_dir(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        r#"---
name: MySkill
description: A test skill
---
Body
"#,
    )
    .unwrap();

    let errors = validate(&skill_dir);
    assert!(errors.iter().any(|e| e.contains("lowercase")));
}

#[test]
fn test_name_too_long() {
    let temp = TempDir::new().unwrap();
    let long_name = "a".repeat(70); // Exceeds 64 char limit
    let skill_dir = temp.path().join(&long_name);
    std::fs::create_dir(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        format!(
            r#"---
name: {}
description: A test skill
---
Body
"#,
            long_name
        ),
    )
    .unwrap();

    let errors = validate(&skill_dir);
    assert!(errors.iter().any(|e| e.contains("exceeds") && e.contains("character limit")));
}

#[test]
fn test_name_leading_hyphen() {
    let temp = TempDir::new().unwrap();
    let skill_dir = temp.path().join("-my-skill");
    std::fs::create_dir(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        r#"---
name: -my-skill
description: A test skill
---
Body
"#,
    )
    .unwrap();

    let errors = validate(&skill_dir);
    assert!(errors.iter().any(|e| e.contains("cannot start or end with a hyphen")));
}

#[test]
fn test_name_consecutive_hyphens() {
    let temp = TempDir::new().unwrap();
    let skill_dir = temp.path().join("my--skill");
    std::fs::create_dir(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        r#"---
name: my--skill
description: A test skill
---
Body
"#,
    )
    .unwrap();

    let errors = validate(&skill_dir);
    assert!(errors.iter().any(|e| e.contains("consecutive hyphens")));
}

#[test]
fn test_name_invalid_characters() {
    let temp = TempDir::new().unwrap();
    let skill_dir = temp.path().join("my_skill");
    std::fs::create_dir(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        r#"---
name: my_skill
description: A test skill
---
Body
"#,
    )
    .unwrap();

    let errors = validate(&skill_dir);
    assert!(errors.iter().any(|e| e.contains("invalid characters")));
}

#[test]
fn test_name_directory_mismatch() {
    let temp = TempDir::new().unwrap();
    let skill_dir = temp.path().join("wrong-name");
    std::fs::create_dir(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        r#"---
name: correct-name
description: A test skill
---
Body
"#,
    )
    .unwrap();

    let errors = validate(&skill_dir);
    assert!(errors.iter().any(|e| e.contains("must match skill name")));
}

#[test]
fn test_unexpected_fields() {
    let temp = TempDir::new().unwrap();
    let skill_dir = temp.path().join("my-skill");
    std::fs::create_dir(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        r#"---
name: my-skill
description: A test skill
unknown_field: should not be here
---
Body
"#,
    )
    .unwrap();

    let errors = validate(&skill_dir);
    assert!(errors.iter().any(|e| e.contains("Unexpected fields")));
}

#[test]
fn test_valid_with_all_fields() {
    let temp = TempDir::new().unwrap();
    let skill_dir = temp.path().join("my-skill");
    std::fs::create_dir(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        r#"---
name: my-skill
description: A test skill
license: MIT
metadata:
  author: Test
---
Body
"#,
    )
    .unwrap();

    let errors = validate(&skill_dir);
    assert!(errors.is_empty());
}

#[test]
fn test_allowed_tools_accepted() {
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

    let errors = validate(&skill_dir);
    assert!(errors.is_empty());
}

#[test]
fn test_i18n_chinese_name() {
    let temp = TempDir::new().unwrap();
    let skill_dir = temp.path().join("技能");
    std::fs::create_dir(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        r#"---
name: 技能
description: A skill with Chinese name
---
Body
"#,
    )
    .unwrap();

    let errors = validate(&skill_dir);
    assert!(errors.is_empty(), "Expected no errors, got: {:?}", errors);
}

#[test]
fn test_i18n_russian_name_with_hyphens() {
    let temp = TempDir::new().unwrap();
    let skill_dir = temp.path().join("мой-навык");
    std::fs::create_dir(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        r#"---
name: мой-навык
description: A skill with Russian name
---
Body
"#,
    )
    .unwrap();

    let errors = validate(&skill_dir);
    assert!(errors.is_empty(), "Expected no errors, got: {:?}", errors);
}

#[test]
fn test_i18n_russian_lowercase_valid() {
    let temp = TempDir::new().unwrap();
    let skill_dir = temp.path().join("навык");
    std::fs::create_dir(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        r#"---
name: навык
description: A skill with Russian lowercase name
---
Body
"#,
    )
    .unwrap();

    let errors = validate(&skill_dir);
    assert!(errors.is_empty(), "Expected no errors, got: {:?}", errors);
}

#[test]
fn test_i18n_russian_uppercase_rejected() {
    let temp = TempDir::new().unwrap();
    let skill_dir = temp.path().join("НАВЫК");
    std::fs::create_dir(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        r#"---
name: НАВЫК
description: A skill with Russian uppercase name
---
Body
"#,
    )
    .unwrap();

    let errors = validate(&skill_dir);
    assert!(errors.iter().any(|e| e.contains("lowercase")));
}

#[test]
fn test_description_too_long() {
    let temp = TempDir::new().unwrap();
    let skill_dir = temp.path().join("my-skill");
    std::fs::create_dir(&skill_dir).unwrap();
    let long_desc = "x".repeat(1100);
    std::fs::write(
        skill_dir.join("SKILL.md"),
        format!(
            r#"---
name: my-skill
description: {}
---
Body
"#,
            long_desc
        ),
    )
    .unwrap();

    let errors = validate(&skill_dir);
    assert!(errors.iter().any(|e| e.contains("exceeds") && e.contains("1024")));
}

#[test]
fn test_valid_compatibility() {
    let temp = TempDir::new().unwrap();
    let skill_dir = temp.path().join("my-skill");
    std::fs::create_dir(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        r#"---
name: my-skill
description: A test skill
compatibility: Requires Python 3.11+
---
Body
"#,
    )
    .unwrap();

    let errors = validate(&skill_dir);
    assert!(errors.is_empty(), "Expected no errors, got: {:?}", errors);
}

#[test]
fn test_compatibility_too_long() {
    let temp = TempDir::new().unwrap();
    let skill_dir = temp.path().join("my-skill");
    std::fs::create_dir(&skill_dir).unwrap();
    let long_compat = "x".repeat(550);
    std::fs::write(
        skill_dir.join("SKILL.md"),
        format!(
            r#"---
name: my-skill
description: A test skill
compatibility: {}
---
Body
"#,
            long_compat
        ),
    )
    .unwrap();

    let errors = validate(&skill_dir);
    assert!(errors.iter().any(|e| e.contains("exceeds") && e.contains("500")));
}

#[test]
fn test_nfkc_normalization() {
    //! Skill names are NFKC normalized before validation.
    //!
    //! The name 'café' can be represented two ways:
    //! - Precomposed: 'café' (4 chars, 'é' is U+00E9)
    //! - Decomposed: 'café' (5 chars, 'e' + combining acute U+0301)
    //!
    //! NFKC normalizes both to the precomposed form.

    let temp = TempDir::new().unwrap();

    // Use decomposed form: 'cafe' + combining acute accent (U+0301)
    let decomposed_name = "cafe\u{0301}"; // 'café' with combining accent
    let composed_name = "café"; // precomposed form

    // Directory uses composed form, SKILL.md uses decomposed - should match after normalization
    let skill_dir = temp.path().join(composed_name);
    std::fs::create_dir(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        format!(
            r#"---
name: {}
description: A test skill
---
Body
"#,
            decomposed_name
        ),
    )
    .unwrap();

    let errors = validate(&skill_dir);
    assert!(errors.is_empty(), "Expected no errors, got: {:?}", errors);
}
