//! Discovery and editing of agent instruction/rule files.
//!
//! A "rule file" is the freeform instruction document an agent reads from a
//! project or the user's home directory — `CLAUDE.md`, `AGENTS.md`,
//! `GEMINI.md`, `.github/copilot-instructions.md`, and the like. Each agent
//! declares its locations through `AgentDescriptor::rule_paths`; this module
//! turns those declarations into a flat, deduplicatable list and handles the
//! file I/O for reading and writing a single rule file.

use std::collections::BTreeSet;
use std::io::Write;
use std::path::{Path, PathBuf};

use aghub_agents::models::{ConfigSource, ResourceScope};
use aghub_agents::AgentDescriptor;

use crate::registry;

/// A single instruction/rule file location for one agent.
#[derive(Debug, Clone)]
pub struct RuleFile {
	pub agent: String,
	pub path: PathBuf,
	pub source: ConfigSource,
	pub exists: bool,
}

fn descriptor_rule_paths(
	descriptor: &AgentDescriptor,
	scope: ResourceScope,
	project_root: Option<&Path>,
) -> Vec<(PathBuf, ConfigSource)> {
	let mut paths = Vec::new();

	if matches!(scope, ResourceScope::GlobalOnly | ResourceScope::Both) {
		for path in descriptor.global_rule_paths() {
			paths.push((path, ConfigSource::Global));
		}
	}

	if matches!(scope, ResourceScope::ProjectOnly | ResourceScope::Both) {
		if let Some(root) = project_root {
			for path in descriptor.project_rule_paths(root) {
				paths.push((path, ConfigSource::Project));
			}
		}
	}

	paths
}

/// List the rule files declared by a single agent for the given scope.
pub fn list_rule_files(
	descriptor: &AgentDescriptor,
	scope: ResourceScope,
	project_root: Option<&Path>,
) -> Vec<RuleFile> {
	descriptor_rule_paths(descriptor, scope, project_root)
		.into_iter()
		.map(|(path, source)| RuleFile {
			agent: descriptor.id.to_string(),
			exists: path.is_file(),
			path,
			source,
		})
		.collect()
}

/// List rule files across every registered agent. Paths shared by multiple
/// agents (e.g. `AGENTS.md`) appear once per agent — callers dedup by path.
pub fn list_all_rule_files(
	scope: ResourceScope,
	project_root: Option<&Path>,
) -> Vec<RuleFile> {
	registry::iter_all()
		.flat_map(|descriptor| list_rule_files(descriptor, scope, project_root))
		.collect()
}

/// The set of every rule file path any agent declares for the scope. Used to
/// reject reads/writes of paths outside the managed rule files.
pub fn known_rule_paths(
	scope: ResourceScope,
	project_root: Option<&Path>,
) -> BTreeSet<PathBuf> {
	registry::iter_all()
		.flat_map(|descriptor| {
			descriptor_rule_paths(descriptor, scope, project_root)
				.into_iter()
				.map(|(path, _)| path)
		})
		.collect()
}

/// Read a rule file. A missing file is not an error — it reads as empty so the
/// editor can create it on first save.
pub fn read_rule_file(path: &Path) -> std::io::Result<String> {
	match std::fs::read_to_string(path) {
		Ok(content) => Ok(content),
		Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
			Ok(String::new())
		}
		Err(err) => Err(err),
	}
}

fn resolve_rule_write_target(path: &Path) -> std::io::Result<PathBuf> {
	match path.canonicalize() {
		Ok(target) => Ok(target),
		Err(canonicalize_error)
			if canonicalize_error.kind() == std::io::ErrorKind::NotFound =>
		{
			match path.symlink_metadata() {
				Ok(metadata) if metadata.file_type().is_symlink() => {
					let target = std::fs::read_link(path)?;
					if target.is_absolute() {
						Ok(target)
					} else {
						Ok(path
							.parent()
							.unwrap_or_else(|| Path::new("."))
							.join(target))
					}
				}
				Ok(_) => Err(canonicalize_error),
				Err(metadata_error)
					if metadata_error.kind()
						== std::io::ErrorKind::NotFound =>
				{
					Ok(path.to_path_buf())
				}
				Err(metadata_error) => Err(metadata_error),
			}
		}
		Err(error) => Err(error),
	}
}

/// Write a rule file, creating parent directories as needed.
///
/// Symlinked rule files (e.g. a CLAUDE.md linked into a dotfiles repo) are
/// resolved so the target is updated in place, and the write replaces the
/// file atomically (temp file + rename) so an incomplete write cannot truncate a
/// hand-authored file.
pub fn write_rule_file(path: &Path, content: &str) -> std::io::Result<()> {
	let target = resolve_rule_write_target(path)?;
	let parent = target.parent().unwrap_or_else(|| Path::new("."));
	std::fs::create_dir_all(parent)?;
	let existing_permissions = match target.metadata() {
		Ok(metadata) => Some(metadata.permissions()),
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
		Err(error) => return Err(error),
	};
	let file_name = target
		.file_name()
		.map(|name| name.to_string_lossy().into_owned())
		.unwrap_or_else(|| "rule".to_string());
	let temporary_prefix = format!(".{file_name}.");
	let mut temporary_builder = tempfile::Builder::new();
	temporary_builder.prefix(&temporary_prefix).suffix(".tmp");
	#[cfg(unix)]
	if existing_permissions.is_none() {
		use std::os::unix::fs::PermissionsExt;
		temporary_builder.permissions(std::fs::Permissions::from_mode(0o666));
	}
	let mut temporary = temporary_builder.tempfile_in(parent)?;
	temporary.write_all(content.as_bytes())?;
	if let Some(permissions) = existing_permissions {
		temporary.as_file().set_permissions(permissions)?;
	}
	temporary
		.persist(&target)
		.map(|_| ())
		.map_err(|error| error.error)
}

/// Expand a leading `~/` to the user's home directory.
pub fn expand_tilde(path: &str) -> PathBuf {
	if let Some(rest) = path.strip_prefix("~/") {
		if let Some(home) = dirs::home_dir() {
			return home.join(rest);
		}
	}
	PathBuf::from(path)
}

/// Format an absolute path for display, abbreviating the home directory to `~`.
pub fn display_path(path: &Path) -> String {
	crate::format_path_with_tilde(path)
		.unwrap_or_else(|| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
	use super::{read_rule_file, write_rule_file};

	#[test]
	fn write_creates_then_replaces() {
		let temp = tempfile::tempdir().unwrap();
		let path = temp.path().join("sub/CLAUDE.md");

		write_rule_file(&path, "first").unwrap();
		assert_eq!(read_rule_file(&path).unwrap(), "first");

		write_rule_file(&path, "second").unwrap();
		assert_eq!(read_rule_file(&path).unwrap(), "second");
	}

	#[test]
	fn write_ignores_stale_shared_temp_path() {
		let temp = tempfile::tempdir().unwrap();
		let path = temp.path().join("CLAUDE.md");
		std::fs::create_dir(temp.path().join(".CLAUDE.md.tmp")).unwrap();

		write_rule_file(&path, "updated").unwrap();

		assert_eq!(read_rule_file(&path).unwrap(), "updated");
	}

	#[cfg(unix)]
	#[test]
	fn write_preserves_existing_permissions() {
		use std::os::unix::fs::PermissionsExt;

		let temp = tempfile::tempdir().unwrap();
		let path = temp.path().join("CLAUDE.md");
		std::fs::write(&path, "original").unwrap();
		std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o640))
			.unwrap();

		write_rule_file(&path, "updated").unwrap();

		let mode = path.metadata().unwrap().permissions().mode() & 0o777;
		assert_eq!(mode, 0o640);
	}

	#[cfg(unix)]
	#[test]
	fn write_new_file_uses_normal_creation_permissions() {
		use std::os::unix::fs::PermissionsExt;

		let temp = tempfile::tempdir().unwrap();
		let expected = temp.path().join("expected.md");
		let path = temp.path().join("CLAUDE.md");
		std::fs::write(&expected, "expected").unwrap();

		write_rule_file(&path, "created").unwrap();

		let expected_mode =
			expected.metadata().unwrap().permissions().mode() & 0o777;
		let actual_mode = path.metadata().unwrap().permissions().mode() & 0o777;
		assert_eq!(actual_mode, expected_mode);
	}

	#[cfg(unix)]
	#[test]
	fn write_updates_symlink_target_in_place() {
		let temp = tempfile::tempdir().unwrap();
		let target = temp.path().join("dotfiles/CLAUDE.md");
		std::fs::create_dir_all(target.parent().unwrap()).unwrap();
		std::fs::write(&target, "original").unwrap();
		let link = temp.path().join("CLAUDE.md");
		std::os::unix::fs::symlink(&target, &link).unwrap();

		write_rule_file(&link, "updated").unwrap();

		assert_eq!(std::fs::read_to_string(&target).unwrap(), "updated");
		assert!(link.symlink_metadata().unwrap().file_type().is_symlink());
	}

	#[cfg(unix)]
	#[test]
	fn write_creates_missing_symlink_target_in_place() {
		let temp = tempfile::tempdir().unwrap();
		let target = temp.path().join("dotfiles/CLAUDE.md");
		let link = temp.path().join("CLAUDE.md");
		std::os::unix::fs::symlink(&target, &link).unwrap();

		write_rule_file(&link, "created").unwrap();

		assert_eq!(std::fs::read_to_string(&target).unwrap(), "created");
		assert!(link.symlink_metadata().unwrap().file_type().is_symlink());
	}
}
