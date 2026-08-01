use crate::{eprintln_verbose, ResourceType};
use aghub_core::{
	manager::ConfigManager,
	models::{McpServer, Skill},
	SkillImportSnapshot,
};
use anyhow::{anyhow, Result};
use std::path::PathBuf;

use super::parse_mcp_transport;

#[allow(clippy::too_many_arguments)]
pub fn execute(
	manager: &mut ConfigManager,
	resource: ResourceType,
	name: Option<String>,
	from: Option<PathBuf>,
	command: Option<String>,
	url: Option<String>,
	transport: String,
	headers: Vec<String>,
	env_vars: Vec<String>,
	description: Option<String>,
	author: Option<String>,
	version: Option<String>,
	tools: Vec<String>,
	force_unsafe: bool,
) -> Result<()> {
	match resource {
		ResourceType::Skills => {
			if let Some(from_path) = from {
				let snapshot = SkillImportSnapshot::capture(&from_path)?;
				let audit_input =
					skill_audit::AuditInput::from_skill_path(snapshot.path())
						.map_err(|error| anyhow!("Skill audit failed: {error}"))?;
				let audit = skill_audit::audit(&audit_input)
					.map_err(|error| anyhow!("Skill audit failed: {error}"))?;
				handle_audit(&audit, force_unsafe)?;

				// Import skill from path (directory, .skill file, or SKILL.md)
				eprintln_verbose!(
					"Importing skill from: {}",
					from_path.display()
				);
				let skill = if let Some(custom_name) = name {
					eprintln_verbose!("Importing skill as '{}'", custom_name);
					manager.add_skill_from_snapshot_with_name(
						&snapshot,
						custom_name,
					)?
				} else {
					manager.add_skill_from_snapshot(&snapshot)?
				};

				eprintln_verbose!("Skill '{}' added successfully", skill.name);
				println!("{}", serde_json::to_string_pretty(&skill)?);
			} else {
				// Manual skill creation, name is required
				let skill_name = name.ok_or_else(|| {
					anyhow!("--name is required when not using --from")
				})?;
				eprintln_verbose!("Adding skill: {}", skill_name);
				let mut skill = Skill::new(skill_name);
				skill.description = description;
				skill.author = author;
				skill.version = version;
				skill.tools = tools;
				manager.add_skill(skill.clone())?;
				eprintln_verbose!("Skill added successfully");
				println!("{}", serde_json::to_string_pretty(&skill)?);
			}
		}
		ResourceType::Mcps => {
			// MCP requires name
			let mcp_name = name
				.ok_or_else(|| anyhow!("--name is required for MCP servers"))?;

			let mcp_transport = parse_mcp_transport(
				command, url, &transport, headers, env_vars, None,
			)?;

			let transport = mcp_transport.ok_or_else(|| {
				anyhow!("Either --command or --url must be specified for MCP servers")
			})?;

			eprintln_verbose!("Adding MCP server: {}", mcp_name);
			let mcp = McpServer::new(mcp_name, transport);
			manager.add_mcp(mcp.clone())?;
			eprintln_verbose!("MCP server added successfully");
			println!("{}", serde_json::to_string_pretty(&mcp)?);
		}
	}

	Ok(())
}

/// Error mapped to exit code 2 when a blocked review lacks confirmation.
#[derive(Debug)]
pub struct AuditBlocked;

impl std::fmt::Display for AuditBlocked {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		f.write_str(
			"# Refusing to install: skill needs review (re-run with --force-unsafe to confirm)",
		)
	}
}

impl std::error::Error for AuditBlocked {}

/// Print the verdict + findings to stderr, then apply the block policy.
/// Stdout stays reserved for the skill JSON, so audit output goes to stderr.
fn handle_audit(
	report: &skill_audit::AuditReport,
	force_unsafe: bool,
) -> Result<()> {
	use skill_audit::Action;
	match skill_audit::decide(report) {
		Action::Allow => {}
		Action::Warn => print_audit(report),
		Action::Block => {
			print_audit(report);
			if force_unsafe {
				eprintln!(
					"# --force-unsafe set: installing after audit confirmation"
				);
			} else {
				return Err(AuditBlocked.into());
			}
		}
	}
	Ok(())
}

fn print_audit(report: &skill_audit::AuditReport) {
	eprintln!(
		"# Skill audit: {:?} — {}",
		report.verdict,
		escape_terminal_text(&report.summary)
	);
	for f in &report.findings {
		eprintln!(
			"#   [{:?}/{:?}] {} in {}: {}",
			f.severity,
			f.category,
			escape_terminal_text(&f.rule_id),
			escape_terminal_text(&f.file),
			escape_terminal_text(&f.evidence)
		);
	}
}

fn escape_terminal_text(value: &str) -> String {
	value
		.chars()
		.flat_map(|character| {
			if is_terminal_format_character(character) {
				character.escape_unicode().collect::<Vec<_>>()
			} else {
				vec![character]
			}
		})
		.collect()
}

fn is_terminal_format_character(character: char) -> bool {
	character.is_control()
		|| matches!(
			character,
			'\u{061C}'
				| '\u{180B}'..='\u{180F}'
				| '\u{200B}'..='\u{200F}'
				| '\u{202A}'..='\u{202E}'
				| '\u{2060}'..='\u{206F}'
				| '\u{FE00}'..='\u{FE0F}'
				| '\u{FEFF}'
				| '\u{E0000}'..='\u{E007F}'
				| '\u{E0100}'..='\u{E01EF}'
		)
}

#[cfg(test)]
mod audit_output_tests {
	use super::escape_terminal_text;

	#[test]
	fn terminal_text_escapes_control_and_format_characters() {
		assert_eq!(
			escape_terminal_text("file\u{1b}]52;c;payload\u{7}\u{202e}.md"),
			"file\\u{1b}]52;c;payload\\u{7}\\u{202e}.md"
		);
	}
}
