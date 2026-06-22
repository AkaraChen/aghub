//! Discovery and editing of agent instruction/rule files.
//!
//! A "rule file" is the freeform instruction document an agent reads from a
//! project or the user's home directory — `CLAUDE.md`, `AGENTS.md`,
//! `GEMINI.md`, `.github/copilot-instructions.md`, and the like. Each agent
//! declares its locations through `AgentDescriptor::rule_paths`; this module
//! turns those declarations into a flat, deduplicatable list and handles the
//! file I/O for reading and writing a single rule file.

use std::collections::BTreeSet;
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

/// Write a rule file, creating parent directories as needed.
pub fn write_rule_file(path: &Path, content: &str) -> std::io::Result<()> {
	if let Some(parent) = path.parent() {
		std::fs::create_dir_all(parent)?;
	}
	std::fs::write(path, content)
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
