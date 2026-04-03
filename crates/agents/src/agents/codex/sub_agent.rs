//! TOML-based sub-agent I/O for Codex.
//!
//! Codex stores sub-agents as individual `*.toml` files inside a directory
//! (e.g. `~/.codex/agents/` or `.codex/agents/`).  Only `name`,
//! `description`, and `developer_instructions` (mapped to `instruction`)
//! are managed by aghub; all other TOML keys are preserved on round-trip.

use crate::errors::{ConfigError, Result};
use crate::models::{ResourceScope, SubAgent};
use std::fs;
use std::path::Path;

// ── File parsing / formatting ────────────────────────────────────────────────

/// Parse a single Codex sub-agent TOML file.
///
/// Reads `name`, `description`, and `developer_instructions` from the TOML
/// document.  When `name` is absent or empty the file stem is used instead.
fn parse_file(path: &Path) -> Option<SubAgent> {
	let content = fs::read_to_string(path).ok()?;
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
	let mut table: toml::map::Map<String, toml::Value> =
		match original_content {
			Some(s) if !s.trim().is_empty() => {
				match toml::from_str::<toml::Value>(s) {
					Ok(toml::Value::Table(t)) => t,
					_ => toml::map::Map::new(),
				}
			}
			_ => toml::map::Map::new(),
		};

	table.insert(
		"name".to_string(),
		toml::Value::String(agent.name.clone()),
	);

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
		.filter(|e| {
			e.path().extension().and_then(|x| x.to_str()) == Some("toml")
		})
		.filter_map(|e| parse_file(&e.path()))
		.collect();
	agents.sort_by(|a, b| a.name.cmp(&b.name));
	agents
}

fn save_to_dir(dir: &Path, agent: &SubAgent) -> Result<()> {
	fs::create_dir_all(dir)?;
	let safe = sanitize_filename(&agent.name);
	let file = dir.join(format!("{safe}.toml"));
	let original = fs::read_to_string(&file).ok();
	fs::write(&file, format(agent, original.as_deref())?)?;
	Ok(())
}

// ── Scoped load / save (called from mod.rs) ──────────────────────────────────

pub(super) fn global_dir() -> Option<std::path::PathBuf> {
	crate::descriptor::home_dir()
		.map(|home| home.join(".codex/agents"))
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
		ResourceScope::ProjectOnly => {
			project_root.and_then(project_dir)
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
		fs::write(
			&path,
			"developer_instructions = \"Do something.\"\n",
		)
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
