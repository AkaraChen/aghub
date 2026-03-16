//! Generate <available_skills> XML prompt block for agent system prompts.

use crate::parser::{find_skill_md, read_properties};

/// Escape special XML characters.
fn xml_escape(s: &str) -> String {
	s.replace('&', "&amp;")
		.replace('<', "&lt;")
		.replace('>', "&gt;")
		.replace('"', "&quot;")
		.replace('\'', "&apos;")
}

/// Generate the <available_skills> XML block for inclusion in agent prompts.
///
/// This XML format is what Anthropic uses and recommends for Claude models.
/// Skill Clients may format skill information differently to suit their
/// models or preferences.
///
/// # Arguments
/// * `skill_dirs` - List of paths to skill directories
///
/// # Returns
/// XML string with <available_skills> block containing each skill's
/// name, description, and location.
///
/// # Example output
/// ```xml
/// <available_skills>
/// <skill>
/// <name>pdf-reader</name>
/// <description>Read and extract text from PDF files</description>
/// <location>/path/to/pdf-reader/SKILL.md</location>
/// </skill>
/// </available_skills>
/// ```
pub fn to_prompt(
	skill_dirs: &[std::path::PathBuf],
) -> Result<String, Box<dyn crate::errors::SkillError>> {
	if skill_dirs.is_empty() {
		return Ok("<available_skills>\n</available_skills>".to_string());
	}

	let mut lines = vec!["<available_skills>".to_string()];

	for skill_dir in skill_dirs {
		let skill_dir = skill_dir
			.canonicalize()
			.unwrap_or_else(|_| skill_dir.clone());
		let props = read_properties(&skill_dir)?;

		lines.push("<skill>".to_string());
		lines.push("<name>".to_string());
		lines.push(xml_escape(&props.name));
		lines.push("</name>".to_string());
		lines.push("<description>".to_string());
		lines.push(xml_escape(&props.description));
		lines.push("</description>".to_string());

		if let Some(skill_md_path) = find_skill_md(&skill_dir) {
			lines.push("<location>".to_string());
			lines.push(skill_md_path.to_string_lossy().to_string());
			lines.push("</location>".to_string());
		}

		lines.push("</skill>".to_string());
	}

	lines.push("</available_skills>".to_string());

	Ok(lines.join("\n"))
}
