//! TOML-based sub-agent I/O for Codex.
//!
//! Codex stores sub-agents as individual `*.toml` files inside a directory
//! (e.g. `~/.codex/agents/` or `.codex/agents/`).  Only `name`,
//! `description`, and `developer_instructions` (mapped to `instruction`)
//! are managed by aghub; all other TOML keys are preserved on round-trip.

use crate::errors::{ConfigError, Result};
use crate::models::{ResourceScope, SubAgent};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

// ── File parsing / formatting ────────────────────────────────────────────────

/// Parse a single Codex sub-agent TOML file.
///
/// Reads `name`, `description`, and `developer_instructions` from the TOML
/// document.  When `name` is absent or empty the file stem is used instead.
fn parse_file(path: &Path) -> Option<SubAgent> {
	let content = read_regular_file(path).ok()?;
	let stem = path
		.file_stem()
		.and_then(|n| n.to_str())
		.unwrap_or("unknown")
		.to_string();

	let table = match toml::from_str::<toml::Value>(&content) {
		Ok(toml::Value::Table(t)) => t,
		_ => return None,
	};

	let name = table
		.get("name")
		.and_then(|v| v.as_str())
		.filter(|s| !s.is_empty())
		.map(|s| s.to_string())
		.unwrap_or(stem);

	let description = table
		.get("description")
		.and_then(|v| v.as_str())
		.map(|s| s.to_string());

	let instruction = table
		.get("developer_instructions")
		.and_then(|v| v.as_str())
		.map(|s| s.to_string());

	Some(SubAgent {
		name,
		description,
		instruction,
		source_path: Some(path.to_string_lossy().into_owned()),
		config_source: None,
	})
}

/// Serialize a [`SubAgent`] as a Codex TOML sub-agent file.
///
/// When `original_content` is provided its unmanaged keys are preserved so
/// that fields like `model`, `sandbox_mode`, etc. survive a round-trip.
fn format(agent: &SubAgent, original_content: Option<&str>) -> Result<String> {
	let mut table: toml::map::Map<String, toml::Value> = match original_content
	{
		Some(s) if !s.trim().is_empty() => {
			match toml::from_str::<toml::Value>(s) {
				Ok(toml::Value::Table(t)) => t,
				_ => toml::map::Map::new(),
			}
		}
		_ => toml::map::Map::new(),
	};

	table.insert("name".to_string(), toml::Value::String(agent.name.clone()));

	match &agent.description {
		Some(desc) => {
			table.insert(
				"description".to_string(),
				toml::Value::String(desc.clone()),
			);
		}
		None => {
			table.remove("description");
		}
	}

	match &agent.instruction {
		Some(instr) => {
			table.insert(
				"developer_instructions".to_string(),
				toml::Value::String(instr.clone()),
			);
		}
		None => {
			table.remove("developer_instructions");
		}
	}

	toml::to_string_pretty(&toml::Value::Table(table))
		.map_err(|e| ConfigError::InvalidConfig(e.to_string()))
}

fn sanitize_filename(name: &str) -> String {
	let mapped: String = name
		.to_lowercase()
		.chars()
		.map(|c| {
			if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' {
				c
			} else {
				'-'
			}
		})
		.collect();
	// Split on '-', drop empty segments (handles consecutive hyphens and
	// leading/trailing hyphens) then rejoin — single pass, no reallocations.
	mapped
		.split('-')
		.filter(|s| !s.is_empty())
		.collect::<Vec<_>>()
		.join("-")
}

// ── Directory-level I/O ──────────────────────────────────────────────────────

fn load_from_dir(dir: &Path) -> Vec<SubAgent> {
	let Ok(entries) = fs::read_dir(dir) else {
		return Vec::new();
	};
	let mut agents: Vec<SubAgent> = entries
		.flatten()
		.filter(is_regular_toml_entry)
		.filter_map(|e| parse_file(&e.path()))
		.collect();
	agents.sort_by(|a, b| a.name.cmp(&b.name));
	agents
}

fn is_regular_toml_entry(entry: &fs::DirEntry) -> bool {
	if entry.path().extension().and_then(|x| x.to_str()) != Some("toml") {
		return false;
	}
	entry.file_type().map(|t| t.is_file()).unwrap_or(false)
}

fn safe_canonical_dir(dir: &Path) -> Result<PathBuf> {
	fs::create_dir_all(dir)?;
	let meta = fs::symlink_metadata(dir)?;
	if meta.file_type().is_symlink() || !meta.is_dir() {
		return Err(ConfigError::InvalidConfig(format!(
			"Codex sub-agent directory is not a real directory: {}",
			dir.display()
		)));
	}
	dir.canonicalize().map_err(ConfigError::from)
}

fn validate_existing_file(file: &Path, canonical_dir: &Path) -> Result<()> {
	let meta = fs::symlink_metadata(file)?;
	if meta.file_type().is_symlink() {
		return Err(ConfigError::InvalidConfig(format!(
			"Refusing to follow Codex sub-agent symlink: {}",
			file.display()
		)));
	}
	if !meta.is_file() {
		return Err(ConfigError::InvalidConfig(format!(
			"Codex sub-agent path is not a regular file: {}",
			file.display()
		)));
	}
	let canonical_file = file.canonicalize()?;
	if !canonical_file.starts_with(canonical_dir) {
		return Err(ConfigError::InvalidConfig(format!(
			"Codex sub-agent path escapes agents directory: {}",
			file.display()
		)));
	}
	Ok(())
}

fn read_regular_file(path: &Path) -> Result<String> {
	let canonical_dir = path
		.parent()
		.and_then(|p| p.canonicalize().ok())
		.ok_or_else(|| {
			ConfigError::InvalidConfig(format!(
				"Codex sub-agent path has no parent: {}",
				path.display()
			))
		})?;
	validate_existing_file(path, &canonical_dir)?;
	let mut content = String::new();
	open_no_follow(path)?.read_to_string(&mut content)?;
	Ok(content)
}

fn read_original(file: &Path, canonical_dir: &Path) -> Result<Option<String>> {
	match fs::symlink_metadata(file) {
		Ok(_) => {}
		Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
			return Ok(None);
		}
		Err(e) => return Err(e.into()),
	}
	validate_existing_file(file, canonical_dir)?;
	let mut content = String::new();
	open_no_follow(file)?.read_to_string(&mut content)?;
	Ok(Some(content))
}

#[cfg(unix)]
fn open_no_follow(path: &Path) -> std::io::Result<File> {
	use std::os::unix::fs::OpenOptionsExt;

	OpenOptions::new()
		.read(true)
		.custom_flags(libc::O_NOFOLLOW)
		.open(path)
}

#[cfg(not(unix))]
fn open_no_follow(path: &Path) -> std::io::Result<File> {
	OpenOptions::new().read(true).open(path)
}

fn write_replace(file: &Path, content: &str) -> Result<()> {
	let dir = file.parent().ok_or_else(|| {
		ConfigError::InvalidConfig(format!(
			"Codex sub-agent path has no parent: {}",
			file.display()
		))
	})?;
	let file_name =
		file.file_name().and_then(|n| n.to_str()).ok_or_else(|| {
			ConfigError::InvalidConfig(format!(
				"Codex sub-agent path has invalid filename: {}",
				file.display()
			))
		})?;
	let suffix = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|d| d.as_nanos())
		.unwrap_or_default();
	let tmp = dir.join(format!(".{file_name}.{suffix}.tmp"));
	let result = (|| -> Result<()> {
		let mut handle =
			OpenOptions::new().write(true).create_new(true).open(&tmp)?;
		handle.write_all(content.as_bytes())?;
		handle.sync_all()?;
		drop(handle);
		fs::rename(&tmp, file)?;
		Ok(())
	})();
	if result.is_err() {
		let _ = fs::remove_file(&tmp);
	}
	result
}

fn save_to_dir(dir: &Path, agent: &SubAgent) -> Result<()> {
	let canonical_dir = safe_canonical_dir(dir)?;
	let safe = sanitize_filename(&agent.name);
	let file = dir.join(format!("{safe}.toml"));
	let original = read_original(&file, &canonical_dir)?;
	let content = format(agent, original.as_deref())?;
	write_replace(&file, &content)?;
	let canonical_file = file.canonicalize()?;
	if !canonical_file.starts_with(&canonical_dir) {
		return Err(ConfigError::InvalidConfig(format!(
			"Codex sub-agent path escapes agents directory: {}",
			file.display()
		)));
	}
	Ok(())
}

// ── Scoped load / save (called from mod.rs) ──────────────────────────────────

pub(super) fn global_dir() -> Option<std::path::PathBuf> {
	crate::descriptor::home_dir().map(|home| home.join(".codex/agents"))
}

pub(super) fn project_dir(root: &Path) -> Option<std::path::PathBuf> {
	Some(root.join(".codex/agents"))
}

pub(super) fn load(
	project_root: Option<&Path>,
	scope: ResourceScope,
) -> Result<Vec<SubAgent>> {
	match scope {
		ResourceScope::GlobalOnly => {
			let Some(dir) = global_dir() else {
				return Ok(Vec::new());
			};
			Ok(load_from_dir(&dir))
		}
		ResourceScope::ProjectOnly => {
			let Some(dir) = project_root.and_then(project_dir) else {
				return Ok(Vec::new());
			};
			Ok(load_from_dir(&dir))
		}
		ResourceScope::Both => Err(ConfigError::InvalidConfig(
			"Sub-agent load unavailable for Both scope".to_string(),
		)),
	}
}

pub(super) fn save(
	project_root: Option<&Path>,
	scope: ResourceScope,
	agents: &[SubAgent],
) -> Result<()> {
	let dir = match scope {
		ResourceScope::GlobalOnly => global_dir(),
		ResourceScope::ProjectOnly => project_root.and_then(project_dir),
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
		save_to_dir(&dir, agent)?;
	}
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;
	use tempfile::TempDir;

	#[test]
	fn parse_toml_with_all_fields() {
		let dir = TempDir::new().unwrap();
		let path = dir.path().join("reviewer.toml");
		fs::write(
			&path,
			concat!(
				"name = \"reviewer\"\n",
				"description = \"PR reviewer\"\n",
				"developer_instructions = \"Review code like an owner.\"\n",
				"model = \"gpt-5.4\"\n",
			),
		)
		.unwrap();

		let agent = parse_file(&path).unwrap();
		assert_eq!(agent.name, "reviewer");
		assert_eq!(agent.description, Some("PR reviewer".to_string()));
		assert_eq!(
			agent.instruction,
			Some("Review code like an owner.".to_string())
		);
	}

	#[test]
	fn parse_toml_uses_file_stem_when_no_name() {
		let dir = TempDir::new().unwrap();
		let path = dir.path().join("my-agent.toml");
		fs::write(&path, "developer_instructions = \"Do something.\"\n")
			.unwrap();

		let agent = parse_file(&path).unwrap();
		assert_eq!(agent.name, "my-agent");
		assert_eq!(agent.instruction, Some("Do something.".to_string()));
	}

	#[test]
	fn format_preserves_extra_fields() {
		let original = concat!(
			"name = \"reviewer\"\n",
			"description = \"PR reviewer\"\n",
			"developer_instructions = \"Review code.\"\n",
			"model = \"gpt-5.4\"\n",
			"sandbox_mode = \"read-only\"\n",
		);
		let updated = SubAgent {
			name: "reviewer".to_string(),
			description: Some("Updated desc".to_string()),
			instruction: Some("New instructions.".to_string()),
			source_path: None,
			config_source: None,
		};

		let out = format(&updated, Some(original)).unwrap();
		assert!(out.contains("Updated desc"));
		assert!(out.contains("New instructions."));
		assert!(out.contains("gpt-5.4"));
		assert!(out.contains("read-only"));
	}

	#[test]
	fn roundtrip_save_load() {
		let dir = TempDir::new().unwrap();
		let agent = SubAgent {
			name: "Test Agent".to_string(),
			description: Some("A test agent".to_string()),
			instruction: Some("Do X.".to_string()),
			source_path: None,
			config_source: None,
		};
		save_to_dir(dir.path(), &agent).unwrap();

		let loaded = load_from_dir(dir.path());
		assert_eq!(loaded.len(), 1);
		assert_eq!(loaded[0].name, "Test Agent");
		assert_eq!(loaded[0].description, Some("A test agent".to_string()));
		assert_eq!(loaded[0].instruction, Some("Do X.".to_string()));
	}

	#[cfg(unix)]
	#[test]
	fn load_ignores_symlinked_toml_files() {
		use std::os::unix::fs::symlink;

		let dir = TempDir::new().unwrap();
		let outside = dir.path().join("outside.toml");
		fs::write(
			&outside,
			concat!(
				"name = \"outside\"\n",
				"developer_instructions = \"secret\"\n",
			),
		)
		.unwrap();
		let agents_dir = dir.path().join("agents");
		fs::create_dir(&agents_dir).unwrap();
		symlink(&outside, agents_dir.join("evil.toml")).unwrap();

		let loaded = load_from_dir(&agents_dir);
		assert!(loaded.is_empty());
	}

	#[cfg(unix)]
	#[test]
	fn save_rejects_symlinked_target_without_clobbering_victim() {
		use std::os::unix::fs::symlink;

		let dir = TempDir::new().unwrap();
		let agents_dir = dir.path().join("agents");
		fs::create_dir(&agents_dir).unwrap();
		let victim = dir.path().join("victim.txt");
		fs::write(&victim, "do not overwrite").unwrap();
		symlink(&victim, agents_dir.join("evil.toml")).unwrap();
		let agent = SubAgent {
			name: "evil".to_string(),
			description: Some("malicious".to_string()),
			instruction: Some("clobber".to_string()),
			source_path: None,
			config_source: None,
		};

		let err = save_to_dir(&agents_dir, &agent).unwrap_err();
		assert!(err.to_string().contains("symlink"));
		assert_eq!(fs::read_to_string(&victim).unwrap(), "do not overwrite");
	}

	#[test]
	fn sanitize_filename_basic() {
		assert_eq!(sanitize_filename("My Agent!"), "my-agent");
		assert_eq!(sanitize_filename("hello  world"), "hello-world");
		assert_eq!(sanitize_filename("--leading"), "leading");
		assert_eq!(sanitize_filename("trailing--"), "trailing");
		assert_eq!(sanitize_filename("a---b"), "a-b");
		let result = sanitize_filename("hello world");
		assert!(!result.contains(' '));
	}
}
