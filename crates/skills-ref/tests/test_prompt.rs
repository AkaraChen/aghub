//! Tests for prompt module.

use skills_ref::prompt::to_prompt;
use tempfile::TempDir;

#[test]
fn test_empty_list() {
    let result = to_prompt(&[]).unwrap();
    assert_eq!(result, "<available_skills>\n</available_skills>");
}

#[test]
fn test_single_skill() {
    let temp = TempDir::new().unwrap();
    let skill_dir = temp.path().join("my-skill");
    std::fs::create_dir(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        r#"---
name: my-skill
description: A test skill
---
Body
"#,
    )
    .unwrap();

    let result = to_prompt(&[skill_dir]).unwrap();
    assert!(result.contains("<available_skills>"));
    assert!(result.contains("</available_skills>"));
    assert!(result.contains("<name>\nmy-skill\n</name>"));
    assert!(result.contains("<description>\nA test skill\n</description>"));
    assert!(result.contains("<location>"));
    assert!(result.contains("SKILL.md"));
}

#[test]
fn test_multiple_skills() {
    let temp = TempDir::new().unwrap();

    let skill_a = temp.path().join("skill-a");
    std::fs::create_dir(&skill_a).unwrap();
    std::fs::write(
        skill_a.join("SKILL.md"),
        r#"---
name: skill-a
description: First skill
---
Body
"#,
    )
    .unwrap();

    let skill_b = temp.path().join("skill-b");
    std::fs::create_dir(&skill_b).unwrap();
    std::fs::write(
        skill_b.join("SKILL.md"),
        r#"---
name: skill-b
description: Second skill
---
Body
"#,
    )
    .unwrap();

    let result = to_prompt(&[skill_a, skill_b]).unwrap();
    assert_eq!(result.matches("<skill>").count(), 2);
    assert_eq!(result.matches("</skill>").count(), 2);
    assert!(result.contains("skill-a"));
    assert!(result.contains("skill-b"));
}

#[test]
fn test_special_characters_escaped() {
    //! XML special characters in description are escaped.
    let temp = TempDir::new().unwrap();
    let skill_dir = temp.path().join("special-skill");
    std::fs::create_dir(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        r#"---
name: special-skill
description: Use <foo> & <bar> tags
---
Body
"#,
    )
    .unwrap();

    let result = to_prompt(&[skill_dir]).unwrap();
    assert!(result.contains("&lt;foo&gt;"));
    assert!(result.contains("&amp;"));
    assert!(result.contains("&lt;bar&gt;"));
    assert!(!result.contains("<foo>"));
    assert!(!result.contains("<bar>"));
}
