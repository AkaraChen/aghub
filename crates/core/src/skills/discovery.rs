use crate::models::Skill;
use skills_ref::read_properties;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Convert skills-ref metadata HashMap to serde_json::Map
fn convert_metadata(metadata: HashMap<String, String>) -> Option<serde_json::Map<String, serde_json::Value>> {
	if metadata.is_empty() {
		return None;
	}

	let map: serde_json::Map<String, serde_json::Value> = metadata
		.into_iter()
		.map(|(k, v)| (k, serde_json::Value::String(v)))
		.collect();

	Some(map)
}

/// Load skills from a directory using skills-ref parser
pub fn load_skills_from_dir(skills_dir: &Path) -> Vec<Skill> {
	let mut skills = Vec::new();
	collect_skills(skills_dir, &mut skills);
	skills.sort_by(|a, b| a.name.cmp(&b.name));
	skills
}

/// Load skills from multiple directories
pub fn load_skills_from_dirs(dirs: &[PathBuf]) -> Vec<Skill> {
	let mut all_skills = Vec::new();
	let mut seen_names = std::collections::HashSet::new();

	for dir in dirs {
		let mut skills = Vec::new();
		collect_skills(dir, &mut skills);

		for skill in skills {
			if seen_names.insert(skill.name.clone()) {
				all_skills.push(skill);
			}
		}
	}

	all_skills.sort_by(|a, b| a.name.cmp(&b.name));
	all_skills
}

/// Check if a skill is marked as internal
pub fn is_internal_skill(skill: &Skill) -> bool {
	skill
		.metadata
		.as_ref()
		.and_then(|m| m.get("internal"))
		.and_then(|v| v.as_str())
		.map(|s| s == "true")
		.unwrap_or(false)
}

/// Filter out internal skills unless INCLUDE_INTERNAL_SKILLS is set
pub fn filter_internal_skills(skills: Vec<Skill>) -> Vec<Skill> {
	let include_internal = std::env::var("INCLUDE_INTERNAL_SKILLS")
		.map(|v| v == "1" || v == "true")
		.unwrap_or(false);

	if include_internal {
		skills
	} else {
		skills.into_iter().filter(|s| !is_internal_skill(s)).collect()
	}
}

fn collect_skills(dir: &Path, skills: &mut Vec<Skill>) {
	if !dir.exists() {
		return;
	}

	let Ok(entries) = fs::read_dir(dir) else {
		return;
	};

	for entry in entries.flatten() {
		let path = entry.path();
		if !path.is_dir() {
			continue;
		}

		// Try to read skill using skills-ref parser
		if let Ok(props) = read_properties(&path) {
			skills.push(Skill {
				name: props.name,
				enabled: true,
				description: Some(props.description),
				author: None, // skills-ref doesn't have author field
				version: None, // skills-ref doesn't have version field
				tools: Vec::new(),
				metadata: convert_metadata(props.metadata),
			});
		} else {
			// Recurse into subdirectories if no SKILL.md found at this level
			collect_skills(&path, skills);
		}
	}
}
