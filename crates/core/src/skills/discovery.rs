use crate::models::{ResourceOrigin, Skill};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SkillDiscoveryOptions {
	pub include_nested: bool,
	pub include_dependencies: bool,
	pub include_flat_markdown: bool,
}

impl SkillDiscoveryOptions {
	pub fn for_agent(self, discovery: aghub_agents::SkillDiscovery) -> Self {
		Self {
			include_nested: self.include_nested && discovery.include_nested,
			include_dependencies: self.include_dependencies,
			include_flat_markdown: discovery.include_flat_markdown,
		}
	}
}

impl Default for SkillDiscoveryOptions {
	fn default() -> Self {
		Self {
			include_nested: true,
			include_dependencies: true,
			include_flat_markdown: false,
		}
	}
}

pub(crate) struct SkillLocationCache {
	options: SkillDiscoveryOptions,
	locations_by_root: HashMap<(PathBuf, SkillDiscoveryOptions), Vec<Skill>>,
}

impl SkillLocationCache {
	pub(crate) fn new(options: SkillDiscoveryOptions) -> Self {
		Self {
			options,
			locations_by_root: HashMap::new(),
		}
	}

	pub(crate) fn load(&mut self, dirs: &[PathBuf]) -> Vec<Skill> {
		self.load_with_options(dirs, self.options)
	}

	pub(crate) fn load_for_agent(
		&mut self,
		dirs: &[PathBuf],
		discovery: aghub_agents::SkillDiscovery,
	) -> Vec<Skill> {
		self.load_with_options(dirs, self.options.for_agent(discovery))
	}

	fn load_with_options(
		&mut self,
		dirs: &[PathBuf],
		options: SkillDiscoveryOptions,
	) -> Vec<Skill> {
		let mut skills = Vec::new();
		let mut seen_locations = HashSet::new();

		for dir in dirs {
			let key = (dir.clone(), options);
			let root_skills =
				self.locations_by_root.entry(key).or_insert_with(|| {
					load_skills_from_dir_with_options(dir, options)
				});
			for skill in root_skills.iter().cloned() {
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
}

/// Load skills from a directory using skill parser
pub fn load_skills_from_dir(skills_dir: &Path) -> Vec<Skill> {
	load_skills_from_dir_with_options(
		skills_dir,
		SkillDiscoveryOptions::default(),
	)
}

pub fn load_skills_from_dir_with_options(
	skills_dir: &Path,
	options: SkillDiscoveryOptions,
) -> Vec<Skill> {
	let mut skills = Vec::new();
	let mut visited = HashSet::new();
	let linked_root = fs::symlink_metadata(skills_dir)
		.is_ok_and(|metadata| metadata.file_type().is_symlink());
	collect_skills(skills_dir, &mut skills, options, linked_root, &mut visited);
	skills.sort_by(|a, b| a.name.cmp(&b.name));
	skills
}

/// Load skills from multiple directories
pub fn load_skills_from_dirs(dirs: &[PathBuf]) -> Vec<Skill> {
	load_skills_from_dirs_with_options(dirs, SkillDiscoveryOptions::default())
}

pub fn load_skills_from_dirs_with_options(
	dirs: &[PathBuf],
	options: SkillDiscoveryOptions,
) -> Vec<Skill> {
	let mut all_skills = Vec::new();
	let mut seen_names = std::collections::HashSet::new();

	for dir in dirs {
		let mut skills = Vec::new();
		let mut visited = HashSet::new();
		let linked_root = fs::symlink_metadata(dir)
			.is_ok_and(|metadata| metadata.file_type().is_symlink());
		collect_skills(dir, &mut skills, options, linked_root, &mut visited);

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
	load_skill_locations_from_dirs_with_options(
		dirs,
		SkillDiscoveryOptions::default(),
	)
}

pub fn load_skill_locations_from_dirs_with_options(
	dirs: &[PathBuf],
	options: SkillDiscoveryOptions,
) -> Vec<Skill> {
	SkillLocationCache::new(options).load(dirs)
}

pub fn assign_skill_origins(
	skills: &mut [Skill],
	product_id: &str,
	sources: &[aghub_agents::SkillReadSource],
) {
	for skill in skills {
		let Some(source_path) = skill.source_path.as_deref() else {
			continue;
		};
		let physical_path = expand_home_path(source_path);
		let Some(source) = sources
			.iter()
			.find(|source| physical_path.starts_with(&source.root))
		else {
			continue;
		};
		skill.config_source = Some(source.scope);
		skill.origin = Some(ResourceOrigin {
			product_id: product_id.to_string(),
			surface_ids: source
				.surface_ids
				.iter()
				.map(|id| (*id).to_string())
				.collect(),
			scope: source.scope,
			source_kind: source.source_kind,
			physical_location: Some(source_path.to_string()),
			precedence: source.precedence,
			write_policy: source.write_policy,
			runtime_visibility: source.runtime_visibility,
			runtime_visibility_evidence: Some(
				source.runtime_visibility_evidence.to_string(),
			),
		});
	}
}

fn expand_home_path(path: &str) -> PathBuf {
	path.strip_prefix("~/")
		.and_then(|relative| dirs::home_dir().map(|home| home.join(relative)))
		.unwrap_or_else(|| PathBuf::from(path))
}

fn skill_location_identity(skill: &Skill) -> Option<PathBuf> {
	let source = skill
		.source_path
		.as_deref()
		.or(skill.canonical_path.as_deref())?;
	let path = source
		.strip_prefix("~/")
		.and_then(|relative| dirs::home_dir().map(|home| home.join(relative)))
		.unwrap_or_else(|| PathBuf::from(source));
	Some(path)
}

fn collect_skills(
	dir: &Path,
	skills: &mut Vec<Skill>,
	options: SkillDiscoveryOptions,
	linked_ancestor: bool,
	visited: &mut HashSet<PathBuf>,
) {
	let Ok(canonical_dir) = fs::canonicalize(dir) else {
		return;
	};
	if !visited.insert(canonical_dir) {
		return;
	}
	let Ok(entries) = fs::read_dir(dir) else {
		return;
	};
	let mut entries = entries.flatten().collect::<Vec<_>>();
	entries.sort_by_key(|entry| entry.file_name());

	for entry in entries {
		let path = entry.path();
		let Ok(file_type) = entry.file_type() else {
			continue;
		};
		let is_link = file_type.is_symlink();
		if options.include_flat_markdown
			&& (file_type.is_file() || is_link)
			&& path
				.extension()
				.is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
		{
			let parse_path = if is_link {
				fs::canonicalize(&path).unwrap_or_else(|_| path.clone())
			} else {
				path.clone()
			};
			if let Ok(skill_pkg) = skill::parser::parse(&parse_path) {
				let mut skill = crate::convert_skill(skill_pkg);
				if is_link {
					skill.source_path = crate::format_path_with_tilde(&path);
					skill.canonical_path =
						crate::format_path_with_tilde(&parse_path);
				}
				skills.push(skill);
			}
			continue;
		}
		if !is_link && !file_type.is_dir() {
			continue;
		}
		if skill::is_repository_metadata_dir(&entry.file_name()) {
			continue;
		}
		if !options.include_dependencies
			&& is_dependency_directory(&entry.file_name())
		{
			continue;
		}

		let linked_location = linked_ancestor || is_link;
		if let Ok(skill_pkg) = skill::parser::parse_skill_dir(&path) {
			let mut skill = crate::convert_skill(skill_pkg);
			if linked_location {
				set_canonical_skill_path(&mut skill, &path);
			}
			skills.push(skill);
			if options.include_nested {
				collect_skills(
					&path,
					skills,
					options,
					linked_location,
					visited,
				);
			}
			continue;
		}
		if options.include_nested {
			collect_skills(&path, skills, options, linked_location, visited);
		}
	}
}

fn set_canonical_skill_path(skill: &mut Skill, path: &Path) {
	if let Ok(resolved) = fs::canonicalize(path) {
		let canonical = resolved.join("SKILL.md");
		skill.canonical_path = crate::format_path_with_tilde(&canonical);
	}
}

fn is_dependency_directory(name: &std::ffi::OsStr) -> bool {
	matches!(
		name.to_str(),
		Some("node_modules" | "vendor" | ".venv" | "venv" | "site-packages")
	)
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
	fn discovery_options_keep_direct_skills_and_gate_nested_locations() {
		let temp = tempfile::tempdir().unwrap();
		let root = temp.path().join("skills");
		let direct = root.join("direct");
		let nested = root.join("collection/nested");
		let dependency = root.join("vendor/dependency");
		for (path, name) in [
			(&direct, "direct"),
			(&nested, "nested"),
			(&dependency, "dependency"),
		] {
			fs::create_dir_all(path).unwrap();
			fs::write(
				path.join("SKILL.md"),
				format!("---\nname: {name}\ndescription: Test\n---\n"),
			)
			.unwrap();
		}

		let direct_only = load_skills_from_dir_with_options(
			&root,
			SkillDiscoveryOptions {
				include_nested: false,
				include_dependencies: false,
				include_flat_markdown: false,
			},
		);
		assert_eq!(
			direct_only
				.iter()
				.map(|skill| skill.name.as_str())
				.collect::<Vec<_>>(),
			vec!["direct"]
		);

		let nested_without_dependencies = load_skills_from_dir_with_options(
			&root,
			SkillDiscoveryOptions {
				include_nested: true,
				include_dependencies: false,
				include_flat_markdown: false,
			},
		);
		assert_eq!(
			nested_without_dependencies
				.iter()
				.map(|skill| skill.name.as_str())
				.collect::<Vec<_>>(),
			vec!["direct", "nested"]
		);

		let all = load_skills_from_dir_with_options(
			&root,
			SkillDiscoveryOptions {
				include_nested: true,
				include_dependencies: true,
				include_flat_markdown: false,
			},
		);
		assert_eq!(
			all.iter()
				.map(|skill| skill.name.as_str())
				.collect::<Vec<_>>(),
			vec!["dependency", "direct", "nested"]
		);
	}

	#[test]
	fn discovery_options_read_direct_flat_markdown() {
		let temp = tempfile::tempdir().unwrap();
		let root = temp.path().join("skills");
		let nested = root.join("collection/nested");
		fs::create_dir_all(&nested).unwrap();
		fs::write(
			root.join("flat.md"),
			"---\nname: flat\ndescription: Flat skill\n---\n",
		)
		.unwrap();
		fs::write(
			nested.join("SKILL.md"),
			"---\nname: nested\ndescription: Nested skill\n---\n",
		)
		.unwrap();

		let skills = load_skills_from_dir_with_options(
			&root,
			SkillDiscoveryOptions {
				include_nested: false,
				include_dependencies: false,
				include_flat_markdown: true,
			},
		);

		assert_eq!(skills.len(), 1);
		assert_eq!(skills[0].name, "flat");
	}

	#[test]
	fn location_cache_reuses_a_physical_root_within_one_scan() {
		let temp = tempfile::tempdir().unwrap();
		let root = temp.path().join("skills");
		let first = root.join("first");
		fs::create_dir_all(&first).unwrap();
		fs::write(
			first.join("SKILL.md"),
			"---\nname: first\ndescription: First\n---\n",
		)
		.unwrap();

		let mut cache =
			SkillLocationCache::new(SkillDiscoveryOptions::default());
		assert_eq!(cache.load(std::slice::from_ref(&root)).len(), 1);

		let second = root.join("second");
		fs::create_dir_all(&second).unwrap();
		fs::write(
			second.join("SKILL.md"),
			"---\nname: second\ndescription: Second\n---\n",
		)
		.unwrap();

		let cached = cache.load(std::slice::from_ref(&root));
		assert_eq!(cached.len(), 1);
		assert_eq!(cached[0].name, "first");
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
	fn test_skill_locations_preserve_symlinked_read_root() {
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

		assert_eq!(skills.len(), 2);
		assert_ne!(skills[0].source_path, skills[1].source_path);
		assert_eq!(
			skills
				.iter()
				.filter(|skill| skill.canonical_path.is_some())
				.count(),
			1
		);
	}

	#[test]
	fn nested_dependency_skills_are_discovered_when_enabled() {
		let temp = tempfile::tempdir().unwrap();
		let root = temp.path().join("skills");
		let repository = root.join("repository");
		let embedded = repository.join("vendor/tooling");
		for (path, name) in
			[(&repository, "repository"), (&embedded, "tooling")]
		{
			fs::create_dir_all(path).unwrap();
			fs::write(
				path.join("SKILL.md"),
				format!("---\nname: {name}\ndescription: Test\n---\n"),
			)
			.unwrap();
		}

		let without_dependencies = load_skills_from_dir_with_options(
			&root,
			SkillDiscoveryOptions {
				include_nested: true,
				include_dependencies: false,
				include_flat_markdown: false,
			},
		);
		let skills = load_skills_from_dir_with_options(
			&root,
			SkillDiscoveryOptions {
				include_nested: true,
				include_dependencies: true,
				include_flat_markdown: false,
			},
		);

		let names = skills
			.iter()
			.map(|skill| skill.name.as_str())
			.collect::<Vec<_>>();

		assert_eq!(without_dependencies.len(), 1);
		assert_eq!(without_dependencies[0].name, "repository");
		assert_eq!(names, ["repository", "tooling"]);
	}
	#[cfg(unix)]
	#[test]
	fn direct_skill_symlink_is_discovered_without_recursive_traversal() {
		let tmp = tempfile::tempdir().unwrap();
		let root = tmp.path().join("skills");
		let external = tmp.path().join("external/demo");
		fs::create_dir_all(&root).unwrap();
		fs::create_dir_all(&external).unwrap();
		fs::write(
			external.join("SKILL.md"),
			"---\nname: demo\ndescription: Demo\n---\n",
		)
		.unwrap();
		std::os::unix::fs::symlink(&external, root.join("demo")).unwrap();

		let skills = load_skills_from_dir(&root);

		assert_eq!(skills.len(), 1);
		assert_eq!(skills[0].name, "demo");
		assert!(skills[0].canonical_path.is_some());
	}

	#[cfg(unix)]
	#[test]
	fn nested_symlink_directory_is_traversed_without_following_cycles() {
		let tmp = tempfile::tempdir().unwrap();
		let root = tmp.path().join("skills");
		let external = tmp.path().join("external/group/demo");
		fs::create_dir_all(&root).unwrap();
		fs::create_dir_all(&external).unwrap();
		fs::write(
			external.join("SKILL.md"),
			"---\nname: demo\ndescription: Demo\n---\n",
		)
		.unwrap();
		std::os::unix::fs::symlink(
			tmp.path().join("external/group"),
			root.join("group"),
		)
		.unwrap();
		std::os::unix::fs::symlink(&root, root.join("cycle")).unwrap();

		let skills = load_skills_from_dir(&root);

		assert_eq!(skills.len(), 1);
		assert_eq!(skills[0].name, "demo");
		assert!(skills[0].canonical_path.is_some());
	}
}
