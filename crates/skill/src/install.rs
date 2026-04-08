use crate::{
	lock::{global, local},
	parser, scan, SkillLockEntry,
};
use std::path::{Path, PathBuf};
use thiserror::Error;

pub const EMPTY_SKILLS_LOCK_DIGEST: &str =
	"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoDiscoveredSkill {
	pub name: String,
	pub full_path: PathBuf,
	pub relative_dir: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallLockSource {
	pub source: String,
	pub source_type: String,
	pub source_url: String,
	pub ref_name: Option<String>,
}

#[derive(Debug, Error)]
pub enum RepoDiscoveryError {
	#[error("No skills found in source repository")]
	NoSkillsFound,
	#[error(
		"Requested skills not found: {missing}. Available skills: {available}"
	)]
	SkillsNotFound { missing: String, available: String },
	#[error("Failed to scan repository for skills: {0:?}")]
	Scan(#[from] scan::ScanError),
	#[error(
		"Failed to determine repo-relative skill path '{path}' from '{root}'"
	)]
	RelativePath { path: PathBuf, root: PathBuf },
}

fn normalize_relative_repo_dir(
	repo_root: &Path,
	skill_path: &Path,
) -> Result<String, RepoDiscoveryError> {
	let relative = skill_path.strip_prefix(repo_root).map_err(|_| {
		RepoDiscoveryError::RelativePath {
			path: skill_path.to_path_buf(),
			root: repo_root.to_path_buf(),
		}
	})?;
	let value = relative.to_string_lossy().replace('\\', "/");
	if value == "." {
		Ok(String::new())
	} else {
		Ok(value)
	}
}

pub fn lock_skill_file_path(relative_dir: &str) -> String {
	if relative_dir.is_empty() {
		"SKILL.md".to_string()
	} else {
		format!("{relative_dir}/SKILL.md")
	}
}

pub fn discover_repo_skills(
	repo_root: &Path,
	requested_skills: &[String],
	install_all: bool,
) -> Result<Vec<RepoDiscoveredSkill>, RepoDiscoveryError> {
	let scan_options = scan::ScanOptions {
		max_depth: 10,
		full_depth: true,
		respect_gitignore: true,
	};
	let paths = scan::scan_skills(repo_root, scan_options, vec![])?;

	let mut discovered = Vec::new();
	for path in paths {
		let parsed = match parser::parse(&path) {
			Ok(parsed) => parsed,
			Err(_) => continue,
		};
		discovered.push(RepoDiscoveredSkill {
			name: parsed.name,
			relative_dir: normalize_relative_repo_dir(repo_root, &path)?,
			full_path: path,
		});
	}

	if discovered.is_empty() {
		return Err(RepoDiscoveryError::NoSkillsFound);
	}

	if install_all || requested_skills.is_empty() {
		return Ok(discovered);
	}

	let mut selected = Vec::new();
	let mut missing = Vec::new();

	for requested in requested_skills {
		let requested_lower = requested.to_lowercase();
		match discovered
			.iter()
			.find(|skill| skill.name.to_lowercase() == requested_lower)
		{
			Some(skill) => selected.push(skill.clone()),
			None => missing.push(requested.clone()),
		}
	}

	if !missing.is_empty() {
		let available = discovered
			.iter()
			.map(|skill| skill.name.clone())
			.collect::<Vec<_>>()
			.join(", ");
		return Err(RepoDiscoveryError::SkillsNotFound {
			missing: missing.join(", "),
			available,
		});
	}

	Ok(selected)
}

pub fn write_global_install_lock(
	skill_name: &str,
	source: &InstallLockSource,
	skill_path: Option<String>,
	skill_folder_hash: Option<String>,
) -> std::io::Result<()> {
	global::add_skill_to_lock(
		skill_name,
		SkillLockEntry {
			source: source.source.clone(),
			source_type: source.source_type.clone(),
			source_url: source.source_url.clone(),
			ref_name: source.ref_name.clone(),
			skill_path,
			skill_folder_hash: skill_folder_hash
				.unwrap_or_else(|| EMPTY_SKILLS_LOCK_DIGEST.to_string()),
			installed_at: String::new(),
			updated_at: String::new(),
			plugin_name: None,
		},
	)
}

pub fn write_project_install_lock(
	skill_name: &str,
	source: &InstallLockSource,
	cwd: &Path,
) -> std::io::Result<()> {
	local::add_skill_to_local_lock(
		skill_name,
		local::LocalSkillLockEntry {
			source: source.source.clone(),
			ref_name: source.ref_name.clone(),
			source_type: source.source_type.clone(),
			computed_hash: EMPTY_SKILLS_LOCK_DIGEST.to_string(),
		},
		Some(cwd),
	)
}

#[cfg(test)]
mod tests {
	use super::*;
	use tempfile::TempDir;

	#[test]
	fn lock_skill_file_path_handles_root_skill() {
		assert_eq!(lock_skill_file_path(""), "SKILL.md");
		assert_eq!(
			lock_skill_file_path("skills/test-skill"),
			"skills/test-skill/SKILL.md"
		);
	}

	#[test]
	fn write_project_install_lock_uses_placeholder_hash() {
		let dir = TempDir::new().unwrap();
		write_project_install_lock(
			"my-skill",
			&InstallLockSource {
				source: "owner/repo".to_string(),
				source_type: "github".to_string(),
				source_url: "https://github.com/owner/repo.git".to_string(),
				ref_name: Some("main".to_string()),
			},
			dir.path(),
		)
		.unwrap();

		let lock = local::read_local_lock(Some(dir.path()));
		assert_eq!(
			lock.skills.get("my-skill").unwrap().computed_hash,
			EMPTY_SKILLS_LOCK_DIGEST
		);
	}
}
