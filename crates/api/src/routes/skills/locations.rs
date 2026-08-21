use aghub_core::{
	create_adapter, load_all_skill_target_locations,
	models::{AgentType, ResourceScope},
};
use rocket::http::Status;
use std::path::{Component, Path, PathBuf};

use crate::error::ApiError;

use super::{
	get_parent_folder, INVALID_SKILL_PATH, SKILL_PATH_NOT_FOUND,
	SKILL_PATH_OUTSIDE_ROOT,
};

pub(super) fn expand_tilde_path(path: &str) -> std::path::PathBuf {
	if path.starts_with("~/") {
		dirs::home_dir()
			.map(|home| home.join(&path[2..]))
			.unwrap_or_else(|| path.into())
	} else {
		path.into()
	}
}

pub(super) fn skill_path_error(
	status: Status,
	message: impl Into<String>,
	code: &'static str,
) -> ApiError {
	ApiError::new(status, message, code)
}

pub(super) fn canonical_existing(path: &Path) -> Result<PathBuf, ApiError> {
	if path.as_os_str().is_empty() {
		return Err(skill_path_error(
			Status::BadRequest,
			"Skill path cannot be empty",
			INVALID_SKILL_PATH,
		));
	}

	std::fs::canonicalize(path).map_err(|e| {
		let (status, code) = if e.kind() == std::io::ErrorKind::NotFound {
			(Status::NotFound, SKILL_PATH_NOT_FOUND)
		} else {
			(Status::BadRequest, INVALID_SKILL_PATH)
		};
		skill_path_error(
			status,
			format!("Failed to resolve skill path '{}': {e}", path.display()),
			code,
		)
	})
}

pub(super) fn canonical_existing_parent(
	path: &Path,
) -> Result<PathBuf, ApiError> {
	let parent = path.parent().ok_or_else(|| {
		skill_path_error(
			Status::BadRequest,
			format!("Skill path '{}' has no parent", path.display()),
			INVALID_SKILL_PATH,
		)
	})?;
	canonical_existing(parent)
}

pub(super) fn canonical_intended(path: &Path) -> Result<PathBuf, ApiError> {
	if path.exists() {
		return canonical_existing(path);
	}

	if path.as_os_str().is_empty() {
		return Err(skill_path_error(
			Status::BadRequest,
			"Skill path cannot be empty",
			INVALID_SKILL_PATH,
		));
	}

	if path.components().any(|c| matches!(c, Component::ParentDir)) {
		return Err(skill_path_error(
			Status::BadRequest,
			format!("Skill path '{}' contains '..'", path.display()),
			INVALID_SKILL_PATH,
		));
	}

	if let (Some(name), Ok(mut parent)) =
		(path.file_name(), canonical_existing_parent(path))
	{
		parent.push(name);
		return Ok(parent);
	}

	let mut missing = Vec::new();
	let mut current = path;
	while !current.exists() {
		let Some(name) = current.file_name() else {
			return Err(skill_path_error(
				Status::NotFound,
				format!(
					"No existing parent found for skill path '{}'",
					path.display()
				),
				SKILL_PATH_NOT_FOUND,
			));
		};
		missing.push(name.to_os_string());
		current = current.parent().ok_or_else(|| {
			skill_path_error(
				Status::NotFound,
				format!(
					"No existing parent found for skill path '{}'",
					path.display()
				),
				SKILL_PATH_NOT_FOUND,
			)
		})?;
	}

	let mut resolved = canonical_existing(current)?;
	for component in missing.iter().rev() {
		resolved.push(component);
	}
	Ok(resolved)
}

pub(super) fn is_within(child: &Path, root: &Path) -> bool {
	child == root || child.starts_with(root)
}

pub(super) fn canonical_skill_root(path: &Path) -> Result<PathBuf, ApiError> {
	if path.exists() {
		canonical_existing(path)
	} else {
		canonical_intended(path)
	}
}

pub(super) fn canonical_skill_roots_for_agent(
	agent: AgentType,
	resource_scope: ResourceScope,
	project_root: Option<&Path>,
) -> Result<Vec<PathBuf>, ApiError> {
	let adapter = create_adapter(agent);
	adapter
		.get_skills_paths(project_root, resource_scope)
		.into_iter()
		.map(|path| canonical_skill_root(&path))
		.collect()
}

pub(super) fn canonical_skill_roots_for_registered_agents(
	resource_scope: ResourceScope,
	project_root: Option<&Path>,
) -> Result<Vec<PathBuf>, ApiError> {
	let mut roots = Vec::new();
	for agent in AgentType::ALL {
		roots.extend(canonical_skill_roots_for_agent(
			*agent,
			resource_scope,
			project_root,
		)?);
	}
	roots.sort();
	roots.dedup();
	Ok(roots)
}

pub(super) fn canonical_skill_read_roots(
	resource_scope: ResourceScope,
	project_root: Option<&Path>,
) -> Result<Vec<PathBuf>, ApiError> {
	let mut roots = canonical_skill_roots_for_registered_agents(
		resource_scope,
		project_root,
	)?;
	if let Some(home) = dirs::home_dir() {
		append_existing_root(&mut roots, &home.join(".codex/plugins"));
	}
	roots.sort();
	roots.dedup();
	Ok(roots)
}

fn append_existing_root(roots: &mut Vec<PathBuf>, path: &Path) {
	if let Ok(root) = std::fs::canonicalize(path) {
		roots.push(root);
	}
}

pub(super) fn ensure_path_under_roots(
	path: &Path,
	roots: &[PathBuf],
) -> Result<(), ApiError> {
	if roots.iter().any(|root| is_within(path, root)) {
		return Ok(());
	}

	Err(skill_path_error(
		Status::Forbidden,
		format!(
			"Skill path '{}' is outside configured roots",
			path.display()
		),
		SKILL_PATH_OUTSIDE_ROOT,
	))
}

pub(super) fn requested_skill_dir(path: &Path) -> PathBuf {
	if path.is_dir() {
		return path.to_path_buf();
	}

	if path.is_file()
		|| path.file_name().and_then(|name| name.to_str()) == Some("SKILL.md")
	{
		return get_parent_folder(path.to_path_buf());
	}

	path.to_path_buf()
}

pub(super) fn remove_skill_dir_or_symlink(path: &Path) -> std::io::Result<()> {
	let metadata = std::fs::symlink_metadata(path)?;
	if metadata.file_type().is_symlink() {
		std::fs::remove_file(path)
	} else {
		std::fs::remove_dir_all(path)
	}
}

#[derive(Debug)]
pub(super) struct KnownSkillPath {
	source_file: PathBuf,
	source_dir: PathBuf,
	file: PathBuf,
	dir: PathBuf,
	link_target: Option<PathBuf>,
}

pub(super) fn known_skill_paths(
	resource_scope: ResourceScope,
	project_root: Option<&Path>,
) -> Vec<KnownSkillPath> {
	load_all_skill_target_locations(resource_scope, project_root)
		.into_iter()
		.flat_map(|resources| resources.skills)
		.filter_map(|skill| {
			let source_file = expand_tilde_path(skill.source_path.as_deref()?);
			let source_dir = requested_skill_dir(&source_file);
			let target_file = skill
				.canonical_path
				.as_deref()
				.map(expand_tilde_path)
				.unwrap_or_else(|| source_file.clone());
			let file = canonical_existing(&target_file).ok()?;
			let dir =
				canonical_existing(&requested_skill_dir(&target_file)).ok()?;
			let link_target =
				skill.canonical_path.as_ref().map(|_| dir.clone());
			Some(KnownSkillPath {
				source_file,
				source_dir,
				file,
				dir,
				link_target,
			})
		})
		.collect()
}

pub(super) fn known_skill_link_target(
	known: &[KnownSkillPath],
	requested_dir: &Path,
) -> Option<PathBuf> {
	known
		.iter()
		.find(|path| {
			path.source_dir == requested_dir
				|| path.source_file == requested_dir.join("SKILL.md")
		})
		.and_then(|path| path.link_target.clone())
}

pub(super) fn ensure_skill_file_allowed(
	file: &Path,
	roots: &[PathBuf],
	known: &[KnownSkillPath],
) -> Result<(), ApiError> {
	if roots.iter().any(|root| is_within(file, root))
		|| known.iter().any(|path| path.file == file)
	{
		return Ok(());
	}

	Err(skill_path_error(
		Status::Forbidden,
		format!(
			"Skill file '{}' is outside configured roots",
			file.display()
		),
		SKILL_PATH_OUTSIDE_ROOT,
	))
}

pub(super) fn ensure_skill_tree_allowed(
	dir: &Path,
	roots: &[PathBuf],
	known: &[KnownSkillPath],
) -> Result<(), ApiError> {
	if roots.iter().any(|root| is_within(dir, root))
		|| known.iter().any(|path| is_within(dir, &path.dir))
	{
		return Ok(());
	}

	Err(skill_path_error(
		Status::Forbidden,
		format!(
			"Skill directory '{}' is outside configured roots",
			dir.display()
		),
		SKILL_PATH_OUTSIDE_ROOT,
	))
}

#[cfg(test)]
mod tests {
	use super::*;
	use tempfile::tempdir;

	#[test]
	fn appends_existing_codex_plugin_cache_as_read_only_root() {
		let temp = tempdir().unwrap();
		let plugins = temp.path().join(".codex/plugins");
		std::fs::create_dir_all(&plugins).unwrap();
		let mut roots = Vec::new();

		append_existing_root(&mut roots, &plugins);

		assert_eq!(roots, vec![std::fs::canonicalize(plugins).unwrap()]);
	}
}
