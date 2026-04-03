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
use std::path::Path;

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
	let content = fs::read_to_string(path).ok()?;
	let stem = path
		.file_stem()
		.and_then(|n| n.to_str())
		.unwrap_or("unknown")
		.to_string();

	match aghub_markdown::parse_opt::<SubAgentFrontmatter>(&content) {
		Ok((Some(front), body)) => Some(SubAgent {
			name: if front.name.is_empty() { stem } else { front.name },
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

// ── Directory-level I/O ──────────────────────────────────────────────────────

/// Load sub-agents from a directory of `*.md` files.
pub fn load_sub_agents_from_dir(dir: &Path) -> Vec<SubAgent> {
	let Ok(entries) = fs::read_dir(dir) else {
		return Vec::new();
	};
	let mut agents: Vec<SubAgent> = entries
		.flatten()
		.filter(|e| {
			e.path().extension().and_then(|x| x.to_str()) == Some("md")
		})
		.filter_map(|e| parse_sub_agent_file(&e.path()))
		.collect();
	agents.sort_by(|a, b| a.name.cmp(&b.name));
	agents
}

/// Write a single sub-agent to `dir` as a `*.md` file.
///
/// The directory is created if absent.
pub fn save_sub_agent_to_dir(dir: &Path, agent: &SubAgent) -> Result<()> {
	fs::create_dir_all(dir)?;
	let safe = sanitize_filename(&agent.name);
	let file = dir.join(format!("{safe}.md"));
	fs::write(&file, format_sub_agent(agent)?)?;
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
			let Some(dir) = project_root
				.and_then(|root| project_dir.and_then(|f| f(root)))
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
			project_root
				.and_then(|root| project_dir.and_then(|f| f(root)))
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
		assert_eq!(
			agent.description,
			Some("does stuff".to_string())
		);
		assert_eq!(
			agent.instruction,
			Some("Do the thing.".to_string())
		);
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
		assert_eq!(
			loaded[0].description,
			Some("desc: with colon".to_string())
		);
		assert_eq!(loaded[0].instruction, Some("Do X.".to_string()));
	}

	#[test]
	fn sanitize_filename_basic() {
		assert_eq!(sanitize_filename("My Agent!"), "my-agent-");
		let result = sanitize_filename("hello world");
		assert!(!result.contains(' '));
	}
}
