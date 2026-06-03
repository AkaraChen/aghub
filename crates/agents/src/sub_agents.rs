//! File-system helpers for agents that store sub-agents as `*.md` files.
//!
//! These functions are only relevant for agent implementations that persist
//! sub-agent definitions as individual markdown files in a directory (e.g.
//! Claude, OpenCode).  Generic infrastructure lives in `descriptor.rs`; only
//! the markdown-file-based I/O strategy lives here.

use crate::descriptor::{OptionalPathFn, OptionalProjectPathFn};
use crate::errors::{ConfigError, Result};
use crate::models::{ResourceScope, SubAgent};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

// ── Frontmatter schema ───────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Default)]
struct SubAgentFrontmatter {
	pub name: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub description: Option<String>,
}

// ── File parsing / formatting ────────────────────────────────────────────────

/// Parse a single sub-agent markdown file.
///
/// Reads YAML frontmatter (`name`, `description`) using the `aghub-markdown`
/// crate and uses the document body as the instruction.  When the file has no
/// frontmatter the file stem is used as the name.
pub fn parse_sub_agent_file(path: &Path) -> Option<SubAgent> {
	if ensure_no_symlink_components(path).is_err() || !is_regular_file(path) {
		return None;
	}
	let content = fs::read_to_string(path).ok()?;
	let stem = path
		.file_stem()
		.and_then(|n| n.to_str())
		.unwrap_or("unknown")
		.to_string();

	match aghub_markdown::parse_opt::<SubAgentFrontmatter>(&content) {
		Ok((Some(front), body)) => Some(SubAgent {
			name: if front.name.is_empty() {
				stem
			} else {
				front.name
			},
			description: front.description,
			instruction: Some(body.to_string()),
			source_path: Some(path.to_string_lossy().into_owned()),
			config_source: None,
		}),
		Ok((None, body)) => Some(SubAgent {
			name: stem,
			description: None,
			instruction: Some(body.to_string()),
			source_path: Some(path.to_string_lossy().into_owned()),
			config_source: None,
		}),
		Err(_) => Some(SubAgent {
			name: stem,
			description: None,
			instruction: Some(content),
			source_path: Some(path.to_string_lossy().into_owned()),
			config_source: None,
		}),
	}
}

/// Format a [`SubAgent`] as markdown with YAML frontmatter.
pub fn format_sub_agent(agent: &SubAgent) -> Result<String> {
	let front = SubAgentFrontmatter {
		name: agent.name.clone(),
		description: agent.description.clone(),
	};
	let default_body;
	let body: &str = if let Some(instruction) = &agent.instruction {
		instruction.as_str()
	} else {
		default_body = format!("\n# {}\n\n", agent.name);
		&default_body
	};
	aghub_markdown::render(&front, body)
		.map_err(|e| ConfigError::InvalidConfig(e.to_string()))
}

fn sanitize_filename(name: &str) -> String {
	let mut out = name
		.to_lowercase()
		.chars()
		.map(|c| {
			if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' {
				c
			} else {
				'-'
			}
		})
		.collect::<String>();
	while out.contains("--") {
		out = out.replace("--", "-");
	}
	out.trim_matches('-').to_string()
}

fn is_regular_file(path: &Path) -> bool {
	let Ok(meta) = fs::symlink_metadata(path) else {
		return false;
	};
	let file_type = meta.file_type();
	file_type.is_file() && !file_type.is_symlink()
}

fn ensure_no_symlink_components(path: &Path) -> Result<()> {
	let mut current = PathBuf::new();
	for component in path.components() {
		current.push(component.as_os_str());
		let Ok(meta) = fs::symlink_metadata(&current) else {
			continue;
		};
		if meta.file_type().is_symlink() {
			return Err(ConfigError::InvalidConfig(format!(
				"Refusing to use symlinked sub-agent path: {}",
				current.display()
			)));
		}
	}
	Ok(())
}

fn ensure_safe_sub_agent_dir(dir: &Path) -> Result<()> {
	ensure_no_symlink_components(dir)?;
	fs::create_dir_all(dir)?;
	ensure_no_symlink_components(dir)?;
	let meta = fs::symlink_metadata(dir)?;
	let file_type = meta.file_type();
	if !file_type.is_dir() || file_type.is_symlink() {
		return Err(ConfigError::InvalidConfig(format!(
			"Sub-agent path is not a regular directory: {}",
			dir.display()
		)));
	}
	Ok(())
}

fn assert_safe_destination(file: &Path) -> Result<bool> {
	match fs::symlink_metadata(file) {
		Ok(meta) => {
			let file_type = meta.file_type();
			if !file_type.is_file() || file_type.is_symlink() {
				return Err(ConfigError::InvalidConfig(format!(
					"Refusing to overwrite unsafe sub-agent file: {}",
					file.display()
				)));
			}
			Ok(true)
		}
		Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
		Err(e) => Err(e.into()),
	}
}

fn unique_temp_path(dir: &Path, safe: &str) -> PathBuf {
	let nanos = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|d| d.as_nanos())
		.unwrap_or_default();
	dir.join(format!(".{safe}.{}.{}.tmp", std::process::id(), nanos))
}

fn write_sub_agent_file(file: &Path, content: &str) -> Result<()> {
	let dir = file.parent().ok_or_else(|| {
		ConfigError::InvalidConfig(format!(
			"Sub-agent file has no parent directory: {}",
			file.display()
		))
	})?;
	let existed = assert_safe_destination(file)?;
	let safe = file
		.file_stem()
		.and_then(|n| n.to_str())
		.unwrap_or("sub-agent");
	let temp = unique_temp_path(dir, safe);
	let mut handle = fs::OpenOptions::new()
		.write(true)
		.create_new(true)
		.open(&temp)?;
	handle.write_all(content.as_bytes())?;
	handle.sync_all()?;
	drop(handle);

	if existed {
		assert_safe_destination(file)?;
		fs::remove_file(file)?;
	}
	if let Err(e) = fs::rename(&temp, file) {
		let _ = fs::remove_file(&temp);
		return Err(e.into());
	}
	Ok(())
}

// ── Directory-level I/O ──────────────────────────────────────────────────────

/// Load sub-agents from a directory of `*.md` files.
pub fn load_sub_agents_from_dir(dir: &Path) -> Vec<SubAgent> {
	if ensure_no_symlink_components(dir).is_err() {
		return Vec::new();
	}
	let Ok(meta) = fs::symlink_metadata(dir) else {
		return Vec::new();
	};
	let file_type = meta.file_type();
	if !file_type.is_dir() || file_type.is_symlink() {
		return Vec::new();
	}
	let Ok(entries) = fs::read_dir(dir) else {
		return Vec::new();
	};
	let mut agents: Vec<SubAgent> = entries
		.flatten()
		.filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("md"))
		.filter_map(|e| parse_sub_agent_file(&e.path()))
		.collect();
	agents.sort_by(|a, b| a.name.cmp(&b.name));
	agents
}

/// Write a single sub-agent to `dir` as a `*.md` file.
///
/// The directory is created if absent.
pub fn save_sub_agent_to_dir(dir: &Path, agent: &SubAgent) -> Result<()> {
	ensure_safe_sub_agent_dir(dir)?;
	let safe = sanitize_filename(&agent.name);
	let file = dir.join(format!("{safe}.md"));
	write_sub_agent_file(&file, &format_sub_agent(agent)?)?;
	Ok(())
}

// ── Scoped load / save ───────────────────────────────────────────────────────

/// Load sub-agents from the directory determined by `scope`.
pub fn load_scoped_sub_agents(
	project_root: Option<&Path>,
	scope: ResourceScope,
	global_dir: Option<OptionalPathFn>,
	project_dir: Option<OptionalProjectPathFn>,
) -> Result<Vec<SubAgent>> {
	match scope {
		ResourceScope::GlobalOnly => {
			let Some(dir) = global_dir.and_then(|f| f()) else {
				return Ok(Vec::new());
			};
			Ok(load_sub_agents_from_dir(&dir))
		}
		ResourceScope::ProjectOnly => {
			let Some(dir) =
				project_root.and_then(|root| project_dir.and_then(|f| f(root)))
			else {
				return Ok(Vec::new());
			};
			Ok(load_sub_agents_from_dir(&dir))
		}
		ResourceScope::Both => Err(ConfigError::InvalidConfig(
			"Sub-agent load unavailable for Both scope".to_string(),
		)),
	}
}

/// Persist a full sub-agent list to the scoped directory.
///
/// The directory is created if absent.  Files for removed entries are
/// **not** deleted here — that is handled by `remove_sub_agent` in the
/// manager.
pub fn save_scoped_sub_agents(
	project_root: Option<&Path>,
	scope: ResourceScope,
	agents: &[SubAgent],
	global_dir: Option<OptionalPathFn>,
	project_dir: Option<OptionalProjectPathFn>,
) -> Result<()> {
	let dir = match scope {
		ResourceScope::GlobalOnly => global_dir.and_then(|f| f()),
		ResourceScope::ProjectOnly => {
			project_root.and_then(|root| project_dir.and_then(|f| f(root)))
		}
		ResourceScope::Both => {
			return Err(ConfigError::InvalidConfig(
				"Sub-agent save unavailable for Both scope".to_string(),
			))
		}
	}
	.ok_or_else(|| {
		ConfigError::InvalidConfig(format!(
			"Sub-agent directory unavailable for {:?} scope",
			scope
		))
	})?;
	for agent in agents {
		save_sub_agent_to_dir(&dir, agent)?;
	}
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;
	use tempfile::TempDir;

	#[test]
	fn parse_file_with_frontmatter() {
		let dir = TempDir::new().unwrap();
		let path = dir.path().join("my-agent.md");
		fs::write(
			&path,
			"---\nname: My Agent\ndescription: does stuff\n---\nDo the thing.",
		)
		.unwrap();

		let agent = parse_sub_agent_file(&path).unwrap();
		assert_eq!(agent.name, "My Agent");
		assert_eq!(agent.description, Some("does stuff".to_string()));
		assert_eq!(agent.instruction, Some("Do the thing.".to_string()));
	}

	#[test]
	fn parse_file_without_frontmatter() {
		let dir = TempDir::new().unwrap();
		let path = dir.path().join("plain.md");
		fs::write(&path, "Just plain text.").unwrap();

		let agent = parse_sub_agent_file(&path).unwrap();
		assert_eq!(agent.name, "plain"); // file stem
		assert_eq!(agent.instruction, Some("Just plain text.".to_string()));
	}

	#[test]
	fn roundtrip_save_load() {
		let dir = TempDir::new().unwrap();
		let agent = SubAgent {
			name: "Test Agent".to_string(),
			description: Some("desc: with colon".to_string()),
			instruction: Some("Do X.".to_string()),
			source_path: None,
			config_source: None,
		};
		save_sub_agent_to_dir(dir.path(), &agent).unwrap();

		let loaded = load_sub_agents_from_dir(dir.path());
		assert_eq!(loaded.len(), 1);
		assert_eq!(loaded[0].name, "Test Agent");
		assert_eq!(loaded[0].description, Some("desc: with colon".to_string()));
		assert_eq!(loaded[0].instruction, Some("Do X.".to_string()));
	}

	#[cfg(unix)]
	#[test]
	fn load_ignores_symlinked_markdown_files() {
		use std::os::unix::fs::symlink;

		let dir = TempDir::new().unwrap();
		let target = dir.path().join("secret.md");
		let agents_dir = dir.path().join("agents");
		fs::create_dir(&agents_dir).unwrap();
		fs::write(&target, "TOP_SECRET").unwrap();
		symlink(&target, agents_dir.join("leak.md")).unwrap();

		let loaded = load_sub_agents_from_dir(&agents_dir);

		assert!(loaded.is_empty());
	}

	#[cfg(unix)]
	#[test]
	fn save_refuses_to_overwrite_symlinked_markdown_files() {
		use std::os::unix::fs::symlink;

		let dir = TempDir::new().unwrap();
		let target = dir.path().join("victim.md");
		fs::write(&target, "ORIGINAL").unwrap();
		symlink(&target, dir.path().join("evil.md")).unwrap();
		let agent = SubAgent {
			name: "evil".to_string(),
			description: None,
			instruction: Some("OVERWRITE".to_string()),
			source_path: None,
			config_source: None,
		};

		let result = save_sub_agent_to_dir(dir.path(), &agent);

		assert!(result.is_err());
		assert_eq!(fs::read_to_string(&target).unwrap(), "ORIGINAL");
	}

	#[test]
	fn sanitize_filename_basic() {
		assert_eq!(sanitize_filename("My Agent!"), "my-agent");
		let result = sanitize_filename("hello world");
		assert!(!result.contains(' '));
	}
}
