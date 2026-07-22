use super::ConfigManager;
use crate::{
	convert_skill,
	errors::{ConfigError, Result},
	models::Skill,
};
use log::{debug, info, warn};
use skill::{sanitize::sanitize_name, SkillSource};
use std::{
	collections::{hash_map::DefaultHasher, BTreeMap},
	hash::{Hash, Hasher},
	path::{Path, PathBuf},
};

const MAX_STAGING_SAFE_NAME_BYTES: usize = 80;
const MAX_UNPACKED_SKILL_SCAN_DEPTH: usize = 10;

enum SkillImportSource {
	Directory(PathBuf),
	SkillMd(PathBuf),
	Package {
		root: PathBuf,
		_temp_dir: tempfile::TempDir,
	},
}

impl SkillImportSource {
	fn root_path(&self) -> Option<&Path> {
		match self {
			SkillImportSource::Directory(root)
			| SkillImportSource::Package { root, .. } => Some(root),
			SkillImportSource::SkillMd(path) => path.parent(),
		}
	}
}

/// Resolve a source_path string (potentially with `~/` prefix) to an absolute PathBuf
fn resolve_source_path(sp: &str) -> PathBuf {
	if let Some(stripped) = sp.strip_prefix("~/") {
		if let Some(home) = dirs::home_dir() {
			home.join(stripped)
		} else {
			PathBuf::from(sp)
		}
	} else {
		PathBuf::from(sp)
	}
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

fn symlink_import_error(path: &Path) -> ConfigError {
	ConfigError::InvalidConfig(format!(
		"Refusing to copy symlink '{}'",
		path.display()
	))
}

fn unsupported_import_entry_error(path: &Path) -> ConfigError {
	ConfigError::InvalidConfig(format!(
		"Refusing to copy unsupported import entry '{}'",
		path.display()
	))
}

fn same_existing_path(left: &Path, right: &Path) -> bool {
	if left == right {
		return true;
	}

	match (std::fs::canonicalize(left), std::fs::canonicalize(right)) {
		(Ok(left), Ok(right)) => left == right,
		_ => false,
	}
}

fn should_skip_import_path(path: &Path, skip_paths: &[PathBuf]) -> bool {
	skip_paths
		.iter()
		.any(|skip_path| same_existing_path(path, skip_path))
}

fn is_strict_ancestor(parent: &Path, child: &Path) -> bool {
	let parent =
		std::fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
	let child =
		std::fs::canonicalize(child).unwrap_or_else(|_| child.to_path_buf());
	child.starts_with(&parent) && child != parent
}

fn copy_dir_recursive(
	from: &Path,
	to: &Path,
	skip_paths: &[PathBuf],
) -> Result<()> {
	let metadata = std::fs::symlink_metadata(from)?;
	if metadata.file_type().is_symlink() {
		return Err(symlink_import_error(from));
	}
	if !metadata.is_dir() {
		return Err(unsupported_import_entry_error(from));
	}

	std::fs::create_dir_all(to)?;
	for entry in std::fs::read_dir(from)? {
		let entry = entry?;
		let from_path = entry.path();
		let to_path = to.join(entry.file_name());
		let file_type = entry.file_type()?;
		if file_type.is_symlink() {
			return Err(symlink_import_error(&from_path));
		}
		if should_skip_import_path(&from_path, skip_paths) {
			continue;
		}
		if file_type.is_dir() {
			copy_dir_recursive(&from_path, &to_path, skip_paths)?;
		} else if file_type.is_file() {
			std::fs::copy(&from_path, &to_path)?;
		} else {
			return Err(unsupported_import_entry_error(&from_path));
		}
	}
	Ok(())
}

fn cleanup_import_path(path: &Path) {
	if let Ok(metadata) = std::fs::symlink_metadata(path) {
		let result = if metadata.file_type().is_symlink() {
			std::fs::remove_file(path)
		} else if metadata.is_dir() {
			std::fs::remove_dir_all(path)
		} else {
			std::fs::remove_file(path)
		};
		let _ = result;
	}
}

fn copy_skill_md_with_resources(
	from: &Path,
	to: &Path,
	skip_paths: &[PathBuf],
) -> Result<()> {
	let metadata = std::fs::symlink_metadata(from)?;
	if metadata.file_type().is_symlink() {
		return Err(symlink_import_error(from));
	}
	if !metadata.is_file() {
		return Err(unsupported_import_entry_error(from));
	}

	std::fs::create_dir_all(to)?;
	std::fs::copy(from, to.join("SKILL.md"))?;
	if let Some(parent) = from.parent() {
		for dir_name in ["scripts", "references", "assets"] {
			let resource_dir = parent.join(dir_name);
			match std::fs::symlink_metadata(&resource_dir) {
				Ok(metadata) if metadata.file_type().is_symlink() => {
					return Err(symlink_import_error(&resource_dir));
				}
				Ok(metadata) if metadata.is_dir() => {
					copy_dir_recursive(
						&resource_dir,
						&to.join(dir_name),
						skip_paths,
					)?;
				}
				Ok(_) => {}
				Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
				Err(e) => return Err(ConfigError::Io(e)),
			}
		}
	}
	Ok(())
}

fn copy_import_source(
	source: &SkillImportSource,
	to: &Path,
	skip_paths: &[PathBuf],
) -> Result<()> {
	match source {
		SkillImportSource::Directory(root)
		| SkillImportSource::Package { root, .. } => {
			copy_dir_recursive(root, to, skip_paths)
		}
		SkillImportSource::SkillMd(path) => {
			copy_skill_md_with_resources(path, to, skip_paths)
		}
	}
}

fn staged_import_dir(parent: &Path, safe_name: &str) -> PathBuf {
	let now = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|duration| duration.as_nanos())
		.unwrap_or_default();
	let safe_name = staging_safe_name(safe_name);
	parent.join(format!(".aghub-import-{safe_name}-{now}"))
}

fn staging_safe_name(safe_name: &str) -> String {
	if safe_name.len() <= MAX_STAGING_SAFE_NAME_BYTES {
		return safe_name.to_string();
	}

	let mut hasher = DefaultHasher::new();
	safe_name.hash(&mut hasher);
	let digest = format!("{:016x}", hasher.finish());
	let mut prefix = String::new();
	for ch in safe_name.chars() {
		if prefix.len() + ch.len_utf8() > MAX_STAGING_SAFE_NAME_BYTES {
			break;
		}
		prefix.push(ch);
	}
	format!("{prefix}-{digest}")
}

fn copy_import_source_staged(
	source: &SkillImportSource,
	target_dir: &Path,
) -> Result<()> {
	let parent = target_dir.parent().ok_or_else(|| {
		ConfigError::InvalidConfig(format!(
			"Skill target '{}' has no parent",
			target_dir.display()
		))
	})?;
	std::fs::create_dir_all(parent)?;
	let safe_name = target_dir
		.file_name()
		.and_then(|name| name.to_str())
		.unwrap_or("skill");
	let staged = staged_import_dir(parent, safe_name);
	cleanup_import_path(&staged);

	let mut skip_paths = vec![staged.clone()];
	if let Some(source_root) = source.root_path() {
		if is_strict_ancestor(source_root, parent) {
			skip_paths.push(parent.to_path_buf());
		}
	}

	if let Err(e) = copy_import_source(source, &staged, &skip_paths) {
		cleanup_import_path(&staged);
		return Err(e);
	}

	if let Err(e) = std::fs::rename(&staged, target_dir) {
		cleanup_import_path(&staged);
		return Err(ConfigError::Io(e));
	}

	Ok(())
}

pub(crate) fn copy_skill_directory_staged(
	from: &Path,
	target_dir: &Path,
) -> Result<()> {
	copy_import_source_staged(
		&SkillImportSource::Directory(from.to_path_buf()),
		target_dir,
	)
}

fn find_unpacked_skill_root(
	unpack_dir: &Path,
	skill_name: &str,
) -> Result<PathBuf> {
	let mut skill_dirs = Vec::new();
	collect_unpacked_skill_roots(unpack_dir, 0, &mut skill_dirs).map_err(
		|e| {
			ConfigError::InvalidConfig(format!(
				"Failed to scan unpacked skill package: {e}"
			))
		},
	)?;
	let matches = skill_dirs
		.into_iter()
		.filter(|dir| {
			skill::parser::parse_skill_dir(dir)
				.map(|skill| skill.name == skill_name)
				.unwrap_or(false)
		})
		.collect::<Vec<_>>();

	match matches.as_slice() {
		[root] => Ok(root.clone()),
		[] => Err(ConfigError::InvalidConfig(format!(
			"Unpacked skill package did not contain skill '{skill_name}'"
		))),
		_ => Err(ConfigError::InvalidConfig(format!(
			"Unpacked skill package contains multiple roots named \
			 '{skill_name}'"
		))),
	}
}

fn has_skill_md_file(dir: &Path) -> bool {
	["SKILL.md", "skill.md"]
		.iter()
		.any(|name| dir.join(name).is_file())
}

fn collect_unpacked_skill_roots(
	dir: &Path,
	depth: usize,
	out: &mut Vec<PathBuf>,
) -> std::io::Result<()> {
	if depth > MAX_UNPACKED_SKILL_SCAN_DEPTH {
		return Ok(());
	}

	if has_skill_md_file(dir) {
		out.push(dir.to_path_buf());
	}
	if depth == MAX_UNPACKED_SKILL_SCAN_DEPTH {
		return Ok(());
	}

	for entry in std::fs::read_dir(dir)? {
		let entry = entry?;
		let path = entry.path();
		let metadata = std::fs::symlink_metadata(&path)?;
		if metadata.file_type().is_symlink() {
			continue;
		}
		if metadata.is_dir() {
			collect_unpacked_skill_roots(&path, depth + 1, out)?;
		}
	}
	Ok(())
}

fn import_source_from_parsed(
	path: &Path,
	source: &SkillSource,
	skill_name: &str,
) -> Result<SkillImportSource> {
	match source {
		SkillSource::Directory(root) => {
			Ok(SkillImportSource::Directory(root.clone()))
		}
		SkillSource::SkillMd(skill_md) => {
			Ok(SkillImportSource::SkillMd(skill_md.clone()))
		}
		SkillSource::SkillFile(_) | SkillSource::ZipFile(_) => {
			let temp_dir = tempfile::TempDir::new().map_err(ConfigError::Io)?;
			skill::package::unpack(path, temp_dir.path()).map_err(|e| {
				ConfigError::InvalidConfig(format!(
					"Failed to unpack skill package: {e}"
				))
			})?;
			let root = find_unpacked_skill_root(temp_dir.path(), skill_name)?;
			Ok(SkillImportSource::Package {
				root,
				_temp_dir: temp_dir,
			})
		}
	}
}

impl ConfigManager {
	pub fn add_skill(&mut self, skill: Skill) -> Result<()> {
		let target_dir = self.target_skills_dir();
		let agent_name = self.adapter.name().to_string();
		let config = self.config_mut()?;
		if config.skills.iter().any(|s| s.name == skill.name) {
			return Err(ConfigError::resource_exists("skill", &skill.name));
		}
		info!("adding skill '{}' for agent '{}'", skill.name, agent_name);

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
		let agent_name = self.adapter.name().to_string();
		let config = self.config.as_ref().ok_or_else(|| {
			ConfigError::InvalidConfig("No configuration loaded".to_string())
		})?;
		let index = config
			.skills
			.iter()
			.position(|s| s.name == name)
			.ok_or_else(|| ConfigError::resource_not_found("skill", name))?;
		let existing_skill = config.skills[index].clone();

		let config = self.config_mut()?;
		info!(
			"updating skill '{}' -> '{}' for agent '{}'",
			name, skill.name, agent_name
		);
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
			let existing_body = match skill::parser::parse(&path) {
				Ok(existing) => Some(existing.content),
				Err(skill::SkillError::NotFound(_)) => None,
				Err(e) => {
					return Err(ConfigError::InvalidConfig(format!(
						"Failed to parse existing skill '{}': {e}",
						path.display()
					)));
				}
			};

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
						== Some(&format!("{safe_old_name}.md"))
					{
						let new_path =
							path.with_file_name(format!("{safe_new_name}.md"));
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
		let agent_name = self.adapter.name().to_string();
		let config = self.config.as_ref().ok_or_else(|| {
			ConfigError::InvalidConfig("No configuration loaded".to_string())
		})?;
		let index = config
			.skills
			.iter()
			.position(|s| s.name == name)
			.ok_or_else(|| ConfigError::resource_not_found("skill", name))?;
		let existing_skill = config.skills[index].clone();

		let config = self.config_mut()?;
		info!("removing skill '{}' for agent '{}'", name, agent_name);
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
		let agent_name = self.adapter.name().to_string();
		let config = self.config_mut()?;
		let skill = config
			.skills
			.iter_mut()
			.find(|s| s.name == name)
			.ok_or_else(|| ConfigError::resource_not_found("skill", name))?;
		info!(
			"setting skill '{}' enabled={} for agent '{}'",
			name, enabled, agent_name
		);
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
		debug!(
			"adding skill from path '{}' for agent '{}'",
			path.display(),
			self.adapter.name()
		);
		let skill_pkg = skill::parser::parse(path).map_err(|e| {
			ConfigError::InvalidConfig(format!("Failed to parse skill: {e}"))
		})?;
		let source = import_source_from_parsed(
			path,
			&skill_pkg.source,
			&skill_pkg.name,
		)?;
		let mut skill = convert_skill(skill_pkg);
		let target_dir = self.target_skills_dir().ok_or_else(|| {
			ConfigError::InvalidConfig(
				"Agent does not support persistent skill creation \
				 in the current scope"
					.into(),
			)
		})?;
		let safe_name = sanitize_name(&skill.name);
		let skill_dir = target_dir.join(&safe_name);
		let agent_name = self.adapter.name().to_string();

		{
			let config = self.config_mut()?;
			if config.skills.iter().any(|s| s.name == skill.name) {
				return Err(ConfigError::resource_exists("skill", &skill.name));
			}
			if skill_dir.exists() {
				return Err(ConfigError::resource_exists(
					"skill target",
					skill_dir.display().to_string(),
				));
			}
		}

		info!(
			"importing skill '{}' from '{}' for agent '{}'",
			skill.name,
			path.display(),
			agent_name
		);
		copy_import_source_staged(&source, &skill_dir)?;

		skill.source_path =
			Some(skill_dir.join("SKILL.md").to_string_lossy().to_string());
		skill.canonical_path = None;
		self.config_mut()?.skills.push(skill.clone());
		self.save_current()?;
		Ok(skill)
	}

	pub fn validate_skill_path(&self, path: &Path) -> Vec<String> {
		let mut errors = Vec::new();
		match skill::parser::parse(path) {
			Ok(_) => {}
			Err(e) => {
				warn!("skill validation failed for '{}': {e}", path.display());
				errors.push(format!("Parse error: {e}"));
			}
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
	let description = skill
		.description
		.as_deref()
		.unwrap_or("")
		.replace('\n', " ");
	map.insert(
		"description".to_string(),
		serde_yaml::Value::String(description),
	);
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
	fn test_format_skill_stays_parseable_by_skill_crate() {
		let skill = Skill::new("test-skill");
		let output = format_skill(&skill, None);
		let parsed = skill::parser::parse_skill_md(&output).unwrap();
		assert_eq!(parsed.name, "test-skill");
		assert_eq!(parsed.description, "");
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
	fn staged_import_dir_bounds_long_safe_name() {
		let safe_name = "a".repeat(300);
		let staged = staged_import_dir(Path::new("/tmp"), &safe_name);
		let file_name = staged.file_name().unwrap().to_string_lossy();

		assert!(file_name.starts_with(".aghub-import-"));
		assert!(file_name.len() < 255);
		assert!(file_name.len() < safe_name.len());
	}
}
