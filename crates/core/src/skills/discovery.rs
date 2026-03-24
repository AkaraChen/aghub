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
}
