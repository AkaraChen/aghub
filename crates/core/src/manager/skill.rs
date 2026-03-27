use super::ConfigManager;
use crate::{
	convert_skill,
	errors::{ConfigError, Result},
	models::Skill,
};
use skill::sanitize::sanitize_name;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Resolve a source_path string (potentially with `~/` prefix) to an absolute PathBuf
fn resolve_source_path(sp: &str) -> PathBuf {
	if let Some(stripped) = sp.strip_prefix("~/") {
		dirs::home_dir().unwrap().join(stripped)
	} else {
		PathBuf::from(sp)
	}
}

/// Read the body (everything after the closing `---`) from an existing SKILL.md.
/// Returns Err on I/O failure, Ok(None) if file doesn't exist or has no body.
fn read_existing_body(path: &Path) -> Result<Option<String>> {
	let content = match std::fs::read_to_string(path) {
		Ok(c) => c,
		Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
			return Ok(None);
		}
		Err(e) => return Err(e.into()),
	};

	let mut in_frontmatter = false;
	let mut body_start = None;

	for (i, line) in content.lines().enumerate() {
		if line.trim() == "---" {
			if !in_frontmatter {
				in_frontmatter = true;
			} else {
				// Found closing ---, body starts after this line
				let byte_offset: usize =
					content.lines().take(i + 1).map(|l| l.len() + 1).sum();
				body_start = Some(byte_offset.min(content.len()));
				break;
			}
		}
	}

	Ok(body_start.map(|start| content[start..].to_string()))
}

/// Remove a skill's file or directory from disk.
///
/// Handles three cases:
/// 1. Symlink — only unlink the symlink directory, leave the target intact
/// 2. Named directory (e.g. `skills/my-skill/SKILL.md`) — remove entire dir
/// 3. Standalone file — remove just the file
fn remove_skill_path(
	path: &Path,
	safe_name: &str,
	is_symlink: bool,
) -> Result<()> {
	if is_symlink {
		let Some(parent) = path.parent() else {
			return Ok(());
		};
		let is_link = parent
			.symlink_metadata()
			.map(|m| m.file_type().is_symlink())
			.unwrap_or(false);
		if is_link {
			std::fs::remove_file(parent).map_err(|e| {
				ConfigError::Io(std::io::Error::new(
					e.kind(),
					format!(
						"Failed to remove symlink '{}': {}",
						parent.display(),
						e
					),
				))
			})?;
		}
		return Ok(());
	}

	let Some(parent) = path.parent() else {
		return std::fs::remove_file(path).map_err(|e| e.into());
	};

	let is_named_dir =
		parent.file_name().and_then(|n| n.to_str()) == Some(safe_name);
	if is_named_dir {
		std::fs::remove_dir_all(parent).map_err(|e| {
			ConfigError::Io(std::io::Error::new(
				e.kind(),
				format!(
					"Failed to remove directory '{}': {}",
					parent.display(),
					e
				),
			))
		})?;
	} else {
		std::fs::remove_file(path).map_err(|e| {
			ConfigError::Io(std::io::Error::new(
				e.kind(),
				format!("Failed to remove file '{}': {}", path.display(), e),
			))
		})?;
	}
	Ok(())
}

impl ConfigManager {
	pub fn add_skill(&mut self, skill: Skill) -> Result<()> {
		let target_dir = self.target_skills_dir();
		let config = self.config_mut()?;
		if config.skills.iter().any(|s| s.name == skill.name) {
			return Err(ConfigError::resource_exists("skill", &skill.name));
		}

		if let Some(dir) = target_dir {
			let safe_name = sanitize_name(&skill.name);
			let skill_dir = dir.join(&safe_name);
			std::fs::create_dir_all(&skill_dir)?;
			let content = format_skill(&skill, None);
			std::fs::write(skill_dir.join("SKILL.md"), content)?;
			let mut fs_skill = skill.clone();
			fs_skill.source_path =
				Some(skill_dir.join("SKILL.md").to_string_lossy().to_string());
			fs_skill.canonical_path = None;
			config.skills.push(fs_skill);
		} else {
			return Err(ConfigError::InvalidConfig(
				"Agent does not support persistent skill creation \
				 in the current scope"
					.into(),
			));
		}

		self.save_current()
	}

	pub fn get_skill(&self, name: &str) -> Option<&Skill> {
		self.config.as_ref()?.skills.iter().find(|s| s.name == name)
	}

	pub fn update_skill(&mut self, name: &str, skill: Skill) -> Result<()> {
		let target_dir = self.target_skills_dir();
		let config = self.config_mut()?;
		let index = config
			.skills
			.iter()
			.position(|s| s.name == name)
			.ok_or_else(|| ConfigError::resource_not_found("skill", name))?;

		let existing_skill = &config.skills[index];
		let safe_old_name = sanitize_name(name);
		// Prefer canonical path (real location) for writes
		let file_path = if let Some(cp) = &existing_skill.canonical_path {
			Some(resolve_source_path(cp))
		} else if let Some(sp) = &existing_skill.source_path {
			Some(resolve_source_path(sp))
		} else {
			target_dir.map(|dir| dir.join(&safe_old_name).join("SKILL.md"))
		};

		if let Some(path) = file_path {
			// Read existing body before any filesystem changes
			let existing_body = read_existing_body(&path)?;

			let mut final_file_path = path.clone();

			// Handle rename
			if name != skill.name {
				let safe_new_name = sanitize_name(&skill.name);
				if let Some(parent) = path.parent() {
					if parent.file_name().and_then(|n| n.to_str())
						== Some(&safe_old_name)
					{
						let new_parent = parent.with_file_name(&safe_new_name);
						std::fs::rename(parent, &new_parent).map_err(|e| {
							ConfigError::Io(std::io::Error::new(
								e.kind(),
								format!(
									"Failed to rename skill \
										 directory '{}' -> '{}': {}",
									parent.display(),
									new_parent.display(),
									e
								),
							))
						})?;
						final_file_path =
							new_parent.join(path.file_name().unwrap());
					} else if path.file_name().and_then(|n| n.to_str())
						== Some(&format!("{}.md", safe_old_name))
					{
						let new_path = path
							.with_file_name(format!("{}.md", safe_new_name));
						std::fs::rename(&path, &new_path).map_err(|e| {
							ConfigError::Io(std::io::Error::new(
								e.kind(),
								format!(
									"Failed to rename skill \
										 file '{}' -> '{}': {}",
									path.display(),
									new_path.display(),
									e
								),
							))
						})?;
						final_file_path = new_path;
					}
				}
			}

			if let Some(parent) = final_file_path.parent() {
				if !parent.exists() {
					std::fs::create_dir_all(parent)?;
				}
			}

			let content = format_skill(&skill, existing_body.as_deref());
			std::fs::write(&final_file_path, content)?;

			let mut fs_skill = skill.clone();
			if final_file_path == path {
				fs_skill.source_path = existing_skill.source_path.clone();
				fs_skill.canonical_path = existing_skill.canonical_path.clone();
			} else {
				fs_skill.source_path =
					Some(final_file_path.to_string_lossy().to_string());
				fs_skill.canonical_path = None;
			}
			config.skills[index] = fs_skill;
		} else {
			return Err(ConfigError::InvalidConfig(
				"Agent does not support persistent skill updates \
				 or source missing"
					.into(),
			));
		}

		self.save_current()
	}

	pub fn remove_skill(&mut self, name: &str) -> Result<()> {
		let target_dir = self.target_skills_dir();
		let config = self.config_mut()?;
		let index = config
			.skills
			.iter()
			.position(|s| s.name == name)
			.ok_or_else(|| ConfigError::resource_not_found("skill", name))?;

		let existing_skill = &config.skills[index];
		let safe_name = sanitize_name(name);
		let file_path = if let Some(sp) = &existing_skill.source_path {
			Some(resolve_source_path(sp))
		} else {
			target_dir.map(|dir| dir.join(&safe_name).join("SKILL.md"))
		};
		let is_symlink = existing_skill.canonical_path.is_some();

		if let Some(path) = file_path {
			if path.exists() {
				remove_skill_path(&path, &safe_name, is_symlink)?;
			}
		}

		config.skills.remove(index);
		self.save_current()
	}

	fn set_skill_enabled(&mut self, name: &str, enabled: bool) -> Result<()> {
		let config = self.config_mut()?;
		let skill = config
			.skills
			.iter_mut()
			.find(|s| s.name == name)
			.ok_or_else(|| ConfigError::resource_not_found("skill", name))?;
		skill.enabled = enabled;
		self.save_current()
	}

	pub fn disable_skill(&mut self, name: &str) -> Result<()> {
		self.set_skill_enabled(name, false)
	}

	pub fn enable_skill(&mut self, name: &str) -> Result<()> {
		self.set_skill_enabled(name, true)
	}

	pub fn add_skill_from_path(&mut self, path: &Path) -> Result<Skill> {
		let skill_pkg = skill::parser::parse(path).map_err(|e| {
			ConfigError::InvalidConfig(format!("Failed to parse skill: {}", e))
		})?;
		let skill = convert_skill(skill_pkg);
		self.add_skill(skill.clone())?;
		Ok(skill)
	}

	pub fn validate_skill_path(&self, path: &Path) -> Vec<String> {
		let mut errors = Vec::new();
		match skill::parser::parse(path) {
			Ok(_) => {}
			Err(e) => errors.push(format!("Parse error: {}", e)),
		}
		errors
	}

	fn target_skills_dir(&self) -> Option<PathBuf> {
		self.adapter
			.target_skills_dir(self.project_root.as_deref(), self.scope)
	}
}

/// Serialize frontmatter fields as structured YAML via serde_yaml
fn serialize_frontmatter(skill: &Skill) -> String {
	let mut map = BTreeMap::new();
	map.insert(
		"name".to_string(),
		serde_yaml::Value::String(skill.name.clone()),
	);
	if let Some(desc) = &skill.description {
		let single_line = desc.replace('\n', " ");
		map.insert(
			"description".to_string(),
			serde_yaml::Value::String(single_line),
		);
	}
	if let Some(author) = &skill.author {
		map.insert(
			"author".to_string(),
			serde_yaml::Value::String(author.clone()),
		);
	}
	if let Some(version) = &skill.version {
		map.insert(
			"version".to_string(),
			serde_yaml::Value::String(version.clone()),
		);
	}
	if !skill.tools.is_empty() {
		map.insert(
			"allowed-tools".to_string(),
			serde_yaml::Value::String(skill.tools.join(",")),
		);
	}
	serde_yaml::to_string(&map).unwrap_or_default()
}

/// Format a Skill as a valid SKILL.md, preserving existing body content
/// unless new body content is explicitly supplied.
fn format_skill(skill: &Skill, existing_body: Option<&str>) -> String {
	let yaml = serialize_frontmatter(skill);
	let mut out = String::from("---\n");
	out.push_str(&yaml);
	out.push_str("---\n");

	if let Some(body) = skill.content.as_deref().or(existing_body) {
		out.push_str(body);
	} else {
		out.push_str(&format!("\n# {}\n\n", skill.name));
	}

	out
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_format_skill_preserves_body() {
		let mut skill = Skill::new("test-skill");
		skill.description = Some("A test".to_string());
		let body = "\n# Original Title\n\nInstruction content.\n";
		let output = format_skill(&skill, Some(body));
		assert!(output.contains("# Original Title"));
		assert!(output.contains("Instruction content."));
		// Frontmatter should be valid YAML
		assert!(output.starts_with("---\n"));
		assert!(output.contains("---\n\n# Original Title"));
	}

	#[test]
	fn test_format_skill_generates_placeholder_without_body() {
		let skill = Skill::new("test-skill");
		let output = format_skill(&skill, None);
		assert!(output.contains("# test-skill"));
	}

	#[test]
	fn test_format_skill_quotes_colon_in_description() {
		let mut skill = Skill::new("test");
		skill.description = Some("Source: https://example.com".to_string());
		let output = format_skill(&skill, None);
		// serde_yaml should quote the value containing ':'
		let reparsed: BTreeMap<String, String> = serde_yaml::from_str(
			output
				.trim_start_matches("---\n")
				.split("---\n")
				.next()
				.unwrap(),
		)
		.expect("Should produce valid YAML");
		assert_eq!(reparsed["description"], "Source: https://example.com");
	}

	#[test]
	fn test_format_skill_quotes_numeric_values() {
		let mut skill = Skill::new("test");
		skill.version = Some("123".to_string());
		skill.author = Some("true".to_string());
		let output = format_skill(&skill, None);
		let reparsed: BTreeMap<String, String> = serde_yaml::from_str(
			output
				.trim_start_matches("---\n")
				.split("---\n")
				.next()
				.unwrap(),
		)
		.expect("Should produce valid YAML");
		assert_eq!(reparsed["version"], "123");
		assert_eq!(reparsed["author"], "true");
	}

	#[test]
	fn test_read_existing_body_extracts_correctly() {
		let tmp = tempfile::tempdir().unwrap();
		let path = tmp.path().join("SKILL.md");
		std::fs::write(
			&path,
			"---\nname: test\ndescription: desc\n---\n\n\
			 # Test\n\nBody content here.\n",
		)
		.unwrap();
		let body = read_existing_body(&path).unwrap().unwrap();
		assert!(body.contains("# Test"));
		assert!(body.contains("Body content here."));
	}

	#[test]
	fn test_read_existing_body_missing_file_returns_none() {
		let tmp = tempfile::tempdir().unwrap();
		let path = tmp.path().join("nonexistent.md");
		let result = read_existing_body(&path).unwrap();
		assert!(result.is_none());
	}
}
