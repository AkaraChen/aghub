//! YAML frontmatter parsing for SKILL.md files.

use crate::errors::{ParseError, ValidationError};
use crate::models::SkillProperties;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Find the SKILL.md file in a skill directory.
///
/// Prefers SKILL.md (uppercase) but accepts skill.md (lowercase).
///
/// # Arguments
/// * `skill_dir` - Path to the skill directory
///
/// # Returns
/// * `Some(PathBuf)` - Path to the SKILL.md file if found
/// * `None` - If no SKILL.md file exists
pub fn find_skill_md(skill_dir: &Path) -> Option<PathBuf> {
    for name in ["SKILL.md", "skill.md"] {
        let path = skill_dir.join(name);
        if path.exists() {
            return Some(path);
        }
    }
    None
}

/// Parse YAML frontmatter from SKILL.md content.
///
/// # Arguments
/// * `content` - Raw content of SKILL.md file
///
/// # Returns
/// * `Ok((metadata, body))` - Parsed metadata dict and markdown body
///
/// # Errors
/// * `ParseError` - If frontmatter is missing or invalid
pub fn parse_frontmatter(content: &str) -> Result<(HashMap<String, serde_yaml::Value>, String), ParseError> {
    if !content.starts_with("---") {
        return Err(ParseError::MissingFrontmatter);
    }

    let parts: Vec<&str> = content.splitn(3, "---").collect();
    if parts.len() < 3 {
        return Err(ParseError::UnclosedFrontmatter);
    }

    let frontmatter_str = parts[1];
    let body = parts[2].trim().to_string();

    // First parse as generic Value to check if it's a mapping
    let value: serde_yaml::Value = match serde_yaml::from_str(frontmatter_str) {
        Ok(v) => v,
        Err(e) => return Err(ParseError::InvalidYaml(e.to_string())),
    };

    // Check if it's a mapping
    if !value.is_mapping() {
        return Err(ParseError::NotAMapping);
    }

    let parsed = value.as_mapping().unwrap();

    // Convert to HashMap<String, serde_yaml::Value>
    let metadata: HashMap<String, serde_yaml::Value> = parsed
        .iter()
        .filter_map(|(k, v)| {
            k.as_str().map(|key| {
                let value = if key == "metadata" && v.is_mapping() {
                    // Convert nested metadata mapping to have string values
                    if let serde_yaml::Value::Mapping(m) = v {
                        let converted: HashMap<String, String> = m
                            .iter()
                            .filter_map(|(mk, mv)| {
                                mk.as_str().map(|k| {
                                    let value_str = match mv {
                                        serde_yaml::Value::String(s) => s.clone(),
                                        serde_yaml::Value::Number(n) => n.to_string(),
                                        serde_yaml::Value::Bool(b) => b.to_string(),
                                        _ => format!("{:?}", mv),
                                    };
                                    (k.to_string(), value_str)
                                })
                            })
                            .collect();
                        serde_yaml::to_value(converted).unwrap_or_else(|_| v.clone())
                    } else {
                        v.clone()
                    }
                } else {
                    v.clone()
                };
                (key.to_string(), value)
            })
        })
        .collect();

    Ok((metadata, body))
}

/// Read skill properties from SKILL.md frontmatter.
///
/// This function parses the frontmatter and returns properties.
/// It does NOT perform full validation. Use `validate()` for that.
///
/// # Arguments
/// * `skill_dir` - Path to the skill directory
///
/// # Returns
/// * `Ok(SkillProperties)` - Parsed skill properties
///
/// # Errors
/// * `ParseError` - If SKILL.md is missing or has invalid YAML
/// * `ValidationError` - If required fields (name, description) are missing
pub fn read_properties(skill_dir: &Path) -> Result<SkillProperties, Box<dyn crate::errors::SkillError>> {
    let skill_dir = PathBuf::from(skill_dir);
    let skill_md = find_skill_md(&skill_dir)
        .ok_or_else(|| ParseError::FileNotFound(skill_dir.to_string_lossy().to_string()))?;

    let content = std::fs::read_to_string(&skill_md)
        .map_err(|e| ParseError::InvalidYaml(e.to_string()))?;

    let (metadata, _) = parse_frontmatter(&content)?;

    // Extract required fields
    let name = metadata
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ValidationError::missing_field("name"))?;

    let description = metadata
        .get("description")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ValidationError::missing_field("description"))?;

    let name = name.trim();
    let description = description.trim();

    if name.is_empty() {
        return Err(Box::new(ValidationError::invalid_value(
            "Field 'name' must be a non-empty string".to_string(),
        )));
    }

    if description.is_empty() {
        return Err(Box::new(ValidationError::invalid_value(
            "Field 'description' must be a non-empty string".to_string(),
        )));
    }

    // Extract optional fields
    let license = metadata.get("license").and_then(|v| v.as_str()).map(String::from);

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

    Ok(SkillProperties {
        name: name.to_string(),
        description: description.to_string(),
        license,
        compatibility,
        allowed_tools,
        metadata: skill_metadata,
    })
}
