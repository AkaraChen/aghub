//! L1 static layer: run the YARA rule set over one artifact.

use crate::report::{Category, Finding, FindingSource, Flow, Severity};
use crate::rules::rules;
use crate::AuditError;
use yara_x::Scanner;

/// Scan one file's bytes, emitting one [`Finding`] per matching rule.
///
/// Severity and category come from each rule's `meta` block; a rule with no
/// `severity` meta defaults to `High` (a rule fired, so it is not nothing).
pub fn scan(file: &str, content: &[u8]) -> Result<Vec<Finding>, AuditError> {
	let rules = rules()?;
	let mut scanner = Scanner::new(rules);
	let results = scanner.scan(content).map_err(|error| AuditError::Scan {
		file: file.to_string(),
		message: error.to_string(),
	})?;

	let mut findings = Vec::new();
	for rule in results.matching_rules() {
		findings.push(finding_from_rule(file, content, &rule));
	}
	Ok(findings)
}

fn finding_from_rule(
	file: &str,
	content: &[u8],
	rule: &yara_x::Rule,
) -> Finding {
	let mut severity: Option<Severity> = None;
	let mut category: Option<Category> = None;
	let mut threat_type: Option<String> = None;
	let mut flow = Flow::None;
	let mut evidence = String::new();

	// Two meta conventions: clawhub uses `severity`/`category`; cisco uses
	// free-text `threat_type` without an explicit severity.
	for (key, value) in rule.metadata() {
		if let yara_x::MetaValue::String(s) = value {
			match key {
				"severity" => severity = Some(Severity::from_meta(s)),
				"category" => category = Some(Category::from_meta(s)),
				"threat_type" => threat_type = Some(s.to_string()),
				"flow" => flow = Flow::from_meta(s),
				"description" => evidence = s.to_string(),
				_ => {}
			}
		}
	}

	let severity = severity.unwrap_or(Severity::High);

	// Category: explicit `category` wins; else map cisco's `threat_type`.
	let category = category
		.or_else(|| threat_type.as_deref().map(Category::from_threat_type))
		.unwrap_or(Category::Other);

	// Earliest match offset across the rule's patterns → 1-based line number.
	let line = rule
		.patterns()
		.flat_map(|pattern| pattern.matches())
		.map(|m| m.range().start)
		.min()
		.map(|offset| byte_offset_to_line(content, offset));

	Finding {
		rule_id: rule.identifier().to_string(),
		category,
		severity,
		file: file.to_string(),
		line,
		evidence,
		source: FindingSource::Yara,
		flow,
	}
}

/// Convert a 0-based byte offset into a 1-based line number.
fn byte_offset_to_line(content: &[u8], offset: usize) -> u32 {
	let end = offset.min(content.len());
	content[..end].iter().filter(|&&byte| byte == b'\n').count() as u32 + 1
}
