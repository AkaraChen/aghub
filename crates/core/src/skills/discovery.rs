use crate::models::Skill;
use std::fs;
use std::path::{Path, PathBuf};

/// Load skills from a directory using skill parser
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

/// Load every physical skill location from multiple directories.
pub fn load_skill_locations_from_dirs(dirs: &[PathBuf]) -> Vec<Skill> {
	let mut skills = Vec::new();
	let mut seen_locations = std::collections::HashSet::new();
	for dir in dirs {
		for skill in load_skills_from_dir(dir) {
			let location = skill_location_identity(&skill);
			if location
				.as_ref()
				.is_some_and(|path| !seen_locations.insert(path.clone()))
			{
				continue;
			}
			skills.push(skill);
		}
	}
	skills.sort_by(|a, b| a.name.cmp(&b.name));
	skills
}

fn skill_location_identity(skill: &Skill) -> Option<PathBuf> {
	let source = skill
		.canonical_path
		.as_deref()
		.or(skill.source_path.as_deref())?;
	let path = source
		.strip_prefix("~/")
		.and_then(|relative| dirs::home_dir().map(|home| home.join(relative)))
		.unwrap_or_else(|| PathBuf::from(source));
	Some(fs::canonicalize(&path).unwrap_or(path))
}

fn collect_skills(dir: &Path, skills: &mut Vec<Skill>) {
	let Ok(entries) = fs::read_dir(dir) else {
		return;
	};

	for entry in entries.flatten() {
		let path = entry.path();
		if !path.is_dir() {
			continue;
		}

		match skill::parser::parse_skill_dir(&path) {
			Ok(skill_pkg) => {
				let mut skill = crate::convert_skill(skill_pkg);
				// Detect symlink and record canonical path
				if let Ok(meta) = path.symlink_metadata() {
					if meta.file_type().is_symlink() {
						if let Ok(resolved) = fs::canonicalize(&path) {
							let canonical = resolved.join("SKILL.md");
							skill.canonical_path =
								crate::format_path_with_tilde(&canonical);
						}
					}
				}
				skills.push(skill);
			}
			Err(_) => collect_skills(&path, skills),
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::fs;

	#[test]
	fn test_recursive_skills_discovery() {
		let tmp = tempfile::tempdir().unwrap();
		let root = tmp.path();
		let skill_a = root.join("skill-a");
		fs::create_dir_all(&skill_a).unwrap();
		fs::write(
			skill_a.join("SKILL.md"),
			"---\nname: skill-a\ndescription: Direct skill\n---\n",
		)
		.unwrap();
		let group = root.join("group");
		fs::create_dir_all(&group).unwrap();
		let skill_b = group.join("skill-b");
		fs::create_dir_all(&skill_b).unwrap();
		fs::write(
			skill_b.join("SKILL.md"),
			"---\nname: skill-b\ndescription: Nested skill\n---\n",
		)
		.unwrap();
		let skills = load_skills_from_dir(root);
		let names: Vec<&str> = skills.iter().map(|s| s.name.as_str()).collect();
		assert!(names.contains(&"skill-a"));
		assert!(names.contains(&"skill-b"));
		assert_eq!(skills.len(), 2);
	}

	#[test]
	fn test_skill_locations_preserve_same_name_from_multiple_directories() {
		let tmp = tempfile::tempdir().unwrap();
		let primary = tmp.path().join("z-primary/demo");
		let fallback = tmp.path().join("a-fallback/demo");
		fs::create_dir_all(&primary).unwrap();
		fs::create_dir_all(&fallback).unwrap();
		for path in [&primary, &fallback] {
			fs::write(
				path.join("SKILL.md"),
				"---\nname: demo\ndescription: Demo\n---\n",
			)
			.unwrap();
		}

		let roots =
			[tmp.path().join("z-primary"), tmp.path().join("a-fallback")];
		let skills = load_skill_locations_from_dirs(&roots);

		assert_eq!(skills.len(), 2);
		assert_ne!(skills[0].source_path, skills[1].source_path);
		assert!(skills[0]
			.source_path
			.as_deref()
			.is_some_and(|path| path.contains("z-primary")));

		let effective = load_skills_from_dirs(&roots);
		assert_eq!(effective.len(), 1);
		assert!(effective[0]
			.source_path
			.as_deref()
			.is_some_and(|path| path.contains("z-primary")));
	}

	#[test]
	fn test_skill_locations_deduplicate_repeated_read_path() {
		let tmp = tempfile::tempdir().unwrap();
		let root = tmp.path().join("skills");
		let skill = root.join("demo");
		fs::create_dir_all(&skill).unwrap();
		fs::write(
			skill.join("SKILL.md"),
			"---\nname: demo\ndescription: Demo\n---\n",
		)
		.unwrap();

		let skills =
			load_skill_locations_from_dirs(&[root.clone(), root.clone()]);

		assert_eq!(skills.len(), 1);
	}

	#[cfg(unix)]
	#[test]
	fn test_skill_locations_deduplicate_symlinked_read_root() {
		let tmp = tempfile::tempdir().unwrap();
		let root = tmp.path().join("skills");
		let alias = tmp.path().join("skills-alias");
		let skill = root.join("demo");
		fs::create_dir_all(&skill).unwrap();
		fs::write(
			skill.join("SKILL.md"),
			"---\nname: demo\ndescription: Demo\n---\n",
		)
		.unwrap();
		std::os::unix::fs::symlink(&root, &alias).unwrap();

		let skills = load_skill_locations_from_dirs(&[root, alias]);

		assert_eq!(skills.len(), 1);
	}
}
