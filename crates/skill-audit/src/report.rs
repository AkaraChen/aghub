//! The audit result types — pure facts, no policy.

use crate::input::AuditInput;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fmt::Write;

const CONTENT_DIGEST_DOMAIN: &[u8] = b"aghub-skill-audit-content-v1";
const COMBINED_DIGEST_DOMAIN: &[u8] = b"aghub-skill-audit-combined-v1";
const ASSESSMENT_DIGEST_DOMAIN: &[u8] = b"aghub-skill-audit-assessment-v1";

/// Final classification of a skill.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
	Benign,
	Suspicious,
	Malicious,
}

/// Severity of a single finding. Ordered: `Info < Low < Medium < High < Critical`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
	Info,
	Low,
	Medium,
	High,
	Critical,
}

/// How sure we are about the verdict.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Confidence {
	Low,
	Medium,
	High,
}

/// Threat family a finding belongs to (mirrors the `category` meta on YARA rules).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Category {
	CredentialExfil,
	DataExfil,
	CommandInjection,
	PromptInjection,
	ToolChaining,
	Persistence,
	HostTamper,
	Obfuscation,
	Other,
}

impl Category {
	/// Parse the `category` meta value from a YARA rule.
	pub fn from_meta(s: &str) -> Self {
		match s {
			"credential_exfil" => Self::CredentialExfil,
			"data_exfil" => Self::DataExfil,
			"command_injection" => Self::CommandInjection,
			"prompt_injection" => Self::PromptInjection,
			"tool_chaining" => Self::ToolChaining,
			"persistence" => Self::Persistence,
			"host_tamper" => Self::HostTamper,
			"obfuscation" => Self::Obfuscation,
			_ => Self::Other,
		}
	}

	/// Map cisco's free-text `threat_type` meta to a category.
	pub fn from_threat_type(s: &str) -> Self {
		let s = s.to_ascii_lowercase();
		if s.contains("credential") {
			Self::CredentialExfil
		} else if s.contains("chaining") {
			Self::ToolChaining
		} else if s.contains("command injection")
			|| s.contains("code execution")
		{
			Self::CommandInjection
		} else if s.contains("injection") || s.contains("steganography") {
			Self::PromptInjection
		} else if s.contains("supply") || s.contains("trust") {
			Self::HostTamper
		} else if s.contains("manipulation") || s.contains("autonomy") {
			Self::Persistence
		} else {
			Self::Other
		}
	}
}

impl Severity {
	/// Parse the `severity` meta value from a YARA rule.
	pub fn from_meta(s: &str) -> Self {
		match s.to_ascii_lowercase().as_str() {
			"critical" => Self::Critical,
			"high" => Self::High,
			"medium" => Self::Medium,
			"low" => Self::Low,
			_ => Self::Info,
		}
	}
}

/// Where a finding came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FindingSource {
	/// L1 YARA rule match.
	Yara,
	/// L2 injection-signal detector.
	Injection,
}

/// Data-flow role of a finding. Used to correlate a "reads secrets" source with
/// a "sends to network" sink across files (behavioral-lite — co-occurrence, not
/// taint tracking).
#[derive(
	Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Default,
)]
#[serde(rename_all = "snake_case")]
pub enum Flow {
	#[default]
	None,
	Source,
	Sink,
}

impl Flow {
	/// Parse the `flow` meta value from a YARA rule.
	pub fn from_meta(s: &str) -> Self {
		match s {
			"source" => Self::Source,
			"sink" => Self::Sink,
			_ => Self::None,
		}
	}
}

/// A single thing the audit flagged.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct Finding {
	/// Rule identifier (YARA rule name or injection detector id).
	pub rule_id: String,
	pub category: Category,
	pub severity: Severity,
	/// File the match was found in, relative to the skill root.
	pub file: String,
	/// 1-based line number, when known.
	pub line: Option<u32>,
	/// Short, redacted snippet or human explanation of the match.
	pub evidence: String,
	pub source: FindingSource,
	/// Data-flow role, for cross-file source→sink correlation.
	#[serde(default, skip_serializing_if = "is_flow_none")]
	pub flow: Flow,
}

fn is_flow_none(flow: &Flow) -> bool {
	*flow == Flow::None
}

/// The full audit result for one skill.
#[derive(Debug, Clone, Serialize)]
pub struct AuditReport {
	pub verdict: Verdict,
	pub confidence: Confidence,
	pub findings: Vec<Finding>,
	/// One-line, user-facing summary.
	pub summary: String,
	pub engine_version: String,
	/// SHA-256 identity of the audited name, paths, and file bytes.
	pub content_digest: String,
	/// Confirmation token bound to content, detectors, policy, and verdict.
	pub assessment_digest: String,
}

/// Select the worst report and bind it to the whole audited selection.
///
/// A single report is returned unchanged. For multiple reports, findings are
/// merged, sorted, and deduplicated. The digest is derived from the sorted
/// content digests, so caller order cannot change the confirmation identity.
/// Ties use the lexicographically greatest digest.
pub fn combine_reports(mut reports: Vec<AuditReport>) -> Option<AuditReport> {
	match reports.len() {
		0 => return None,
		1 => return reports.pop(),
		_ => {}
	}

	reports
		.sort_by(|left, right| left.content_digest.cmp(&right.content_digest));
	let content_digest = combined_content_digest(&reports);
	let mut findings: Vec<_> = reports
		.iter()
		.flat_map(|report| report.findings.iter().cloned())
		.collect();
	findings.sort();
	findings.dedup();
	let worst = reports
		.iter()
		.enumerate()
		.max_by_key(|(_, report)| verdict_rank(report.verdict))
		.map(|(index, _)| index)
		.expect("multiple reports are present");
	let mut report = reports.swap_remove(worst);
	report.findings = findings;
	report.verdict = crate::verdict::aggregate(&report.findings);
	report.confidence =
		selection_confidence(report.verdict, report.findings.len());
	report.summary = selection_summary(report.verdict, report.findings.len());
	report.content_digest = content_digest;
	report.assessment_digest = assessment_digest(
		&report.content_digest,
		&report.engine_version,
		report.verdict,
		&report.findings,
	);
	Some(report)
}

fn selection_confidence(verdict: Verdict, finding_count: usize) -> Confidence {
	match (verdict, finding_count) {
		(Verdict::Benign, _) => Confidence::High,
		(_, 2..) => Confidence::High,
		_ => Confidence::Medium,
	}
}

fn selection_summary(verdict: Verdict, finding_count: usize) -> String {
	match verdict {
		Verdict::Benign => {
			"Audited selection looks clean — no concerns found.".to_string()
		}
		Verdict::Suspicious => format!(
			"Audited selection has {finding_count} finding(s) worth \
			 reviewing before installing."
		),
		Verdict::Malicious => format!(
			"Audited selection triggered {finding_count} finding(s), \
			 including high-severity ones."
		),
	}
}

pub(crate) fn content_digest(input: &AuditInput) -> String {
	let mut hasher = Sha256::new();
	hash_part(&mut hasher, CONTENT_DIGEST_DOMAIN);
	hash_part(&mut hasher, input.name.as_bytes());

	let mut files = Vec::with_capacity(input.resources.len() + 1);
	files.push(("SKILL.md", input.skill_md.as_bytes()));
	files.extend(
		input.resources.iter().map(|resource| {
			(resource.path.as_str(), resource.content.as_slice())
		}),
	);
	files.sort_by(|left, right| {
		left.0
			.as_bytes()
			.cmp(right.0.as_bytes())
			.then_with(|| left.1.cmp(right.1))
	});

	for (path, bytes) in files {
		hash_part(&mut hasher, path.as_bytes());
		hash_part(&mut hasher, bytes);
	}
	finalize_digest(hasher)
}

pub(crate) fn assessment_digest(
	content_digest: &str,
	engine_version: &str,
	verdict: Verdict,
	findings: &[Finding],
) -> String {
	assessment_digest_with_versions(
		content_digest,
		engine_version,
		verdict,
		findings,
		crate::engine::detector_fingerprint(),
		crate::policy::POLICY_VERSION,
	)
}

fn assessment_digest_with_versions(
	content_digest: &str,
	engine_version: &str,
	verdict: Verdict,
	findings: &[Finding],
	detector_fingerprint: &[u8],
	policy_version: &[u8],
) -> String {
	let mut hasher = Sha256::new();
	hash_part(&mut hasher, ASSESSMENT_DIGEST_DOMAIN);
	hash_part(&mut hasher, content_digest.as_bytes());
	hash_part(&mut hasher, engine_version.as_bytes());
	hash_part(&mut hasher, detector_fingerprint);
	hash_part(&mut hasher, policy_version);
	hash_part(&mut hasher, verdict_token(verdict));
	hash_findings(&mut hasher, findings);
	finalize_digest(hasher)
}

fn hash_findings(hasher: &mut Sha256, findings: &[Finding]) {
	let mut findings = findings.iter().collect::<Vec<_>>();
	findings.sort();
	hash_part(hasher, &(findings.len() as u64).to_be_bytes());
	for finding in findings {
		hash_part(hasher, finding.rule_id.as_bytes());
		hash_part(hasher, category_token(finding.category));
		hash_part(hasher, severity_token(finding.severity));
		hash_part(hasher, finding.file.as_bytes());
		match finding.line {
			Some(line) => {
				hash_part(hasher, b"some");
				hash_part(hasher, &line.to_be_bytes());
			}
			None => hash_part(hasher, b"none"),
		}
		hash_part(hasher, finding.evidence.as_bytes());
		hash_part(hasher, source_token(finding.source));
		hash_part(hasher, flow_token(finding.flow));
	}
}

fn combined_content_digest(reports: &[AuditReport]) -> String {
	let mut hasher = Sha256::new();
	hash_part(&mut hasher, COMBINED_DIGEST_DOMAIN);
	for report in reports {
		hash_part(&mut hasher, report.content_digest.as_bytes());
	}
	finalize_digest(hasher)
}

fn finalize_digest(hasher: Sha256) -> String {
	let digest = hasher.finalize();
	let mut encoded = String::with_capacity(digest.len() * 2);
	for byte in digest {
		write!(&mut encoded, "{byte:02x}")
			.expect("writing to a String cannot fail");
	}
	encoded
}

pub(crate) fn hash_part(hasher: &mut Sha256, bytes: &[u8]) {
	hasher.update((bytes.len() as u64).to_be_bytes());
	hasher.update(bytes);
}

fn verdict_rank(verdict: Verdict) -> u8 {
	match verdict {
		Verdict::Benign => 0,
		Verdict::Suspicious => 1,
		Verdict::Malicious => 2,
	}
}

fn verdict_token(verdict: Verdict) -> &'static [u8] {
	match verdict {
		Verdict::Benign => b"benign",
		Verdict::Suspicious => b"suspicious",
		Verdict::Malicious => b"malicious",
	}
}

fn category_token(category: Category) -> &'static [u8] {
	match category {
		Category::CredentialExfil => b"credential_exfil",
		Category::DataExfil => b"data_exfil",
		Category::CommandInjection => b"command_injection",
		Category::PromptInjection => b"prompt_injection",
		Category::ToolChaining => b"tool_chaining",
		Category::Persistence => b"persistence",
		Category::HostTamper => b"host_tamper",
		Category::Obfuscation => b"obfuscation",
		Category::Other => b"other",
	}
}

fn severity_token(severity: Severity) -> &'static [u8] {
	match severity {
		Severity::Info => b"info",
		Severity::Low => b"low",
		Severity::Medium => b"medium",
		Severity::High => b"high",
		Severity::Critical => b"critical",
	}
}

fn source_token(source: FindingSource) -> &'static [u8] {
	match source {
		FindingSource::Yara => b"yara",
		FindingSource::Injection => b"injection",
	}
}

fn flow_token(flow: Flow) -> &'static [u8] {
	match flow {
		Flow::None => b"none",
		Flow::Source => b"source",
		Flow::Sink => b"sink",
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn finding() -> Finding {
		Finding {
			rule_id: "rule".to_string(),
			category: Category::PromptInjection,
			severity: Severity::High,
			file: "SKILL.md".to_string(),
			line: Some(7),
			evidence: "evidence".to_string(),
			source: FindingSource::Injection,
			flow: Flow::Source,
		}
	}

	#[test]
	fn assessment_changes_with_every_bound_dimension() {
		let findings = [finding()];
		let current = assessment_digest_with_versions(
			"content",
			"engine-v2",
			Verdict::Suspicious,
			&findings,
			b"detector-v2",
			b"policy-v2",
		);

		for changed in [
			assessment_digest_with_versions(
				"changed-content",
				"engine-v2",
				Verdict::Suspicious,
				&findings,
				b"detector-v2",
				b"policy-v2",
			),
			assessment_digest_with_versions(
				"content",
				"engine-v1",
				Verdict::Suspicious,
				&findings,
				b"detector-v2",
				b"policy-v2",
			),
			assessment_digest_with_versions(
				"content",
				"engine-v2",
				Verdict::Suspicious,
				&findings,
				b"detector-v1",
				b"policy-v2",
			),
			assessment_digest_with_versions(
				"content",
				"engine-v2",
				Verdict::Suspicious,
				&findings,
				b"detector-v2",
				b"policy-v1",
			),
			assessment_digest_with_versions(
				"content",
				"engine-v2",
				Verdict::Malicious,
				&findings,
				b"detector-v2",
				b"policy-v2",
			),
		] {
			assert_ne!(current, changed);
		}
	}

	#[test]
	fn assessment_changes_with_detector_version() {
		let digest = |version| {
			let fingerprint =
				crate::engine::detector_fingerprint_for_version(version);
			assessment_digest_with_versions(
				"content",
				"engine",
				Verdict::Suspicious,
				&[finding()],
				&fingerprint,
				b"policy",
			)
		};

		assert_ne!(
			digest(b"skill-audit-detectors-v1"),
			digest(b"skill-audit-detectors-v2")
		);
	}

	#[test]
	fn assessment_covers_every_finding_field() {
		let original = finding();
		let digest = |finding: Finding| {
			assessment_digest_with_versions(
				"content",
				"engine",
				Verdict::Suspicious,
				&[finding],
				b"detector",
				b"policy",
			)
		};
		let current = digest(original.clone());
		let mut changes = Vec::new();

		let mut changed = original.clone();
		changed.rule_id = "other-rule".to_string();
		changes.push(changed);
		let mut changed = original.clone();
		changed.category = Category::DataExfil;
		changes.push(changed);
		let mut changed = original.clone();
		changed.severity = Severity::Critical;
		changes.push(changed);
		let mut changed = original.clone();
		changed.file = "scripts/run.sh".to_string();
		changes.push(changed);
		let mut changed = original.clone();
		changed.line = None;
		changes.push(changed);
		let mut changed = original.clone();
		changed.evidence = "other evidence".to_string();
		changes.push(changed);
		let mut changed = original.clone();
		changed.source = FindingSource::Yara;
		changes.push(changed);
		let mut changed = original;
		changed.flow = Flow::Sink;
		changes.push(changed);

		for changed in changes {
			assert_ne!(current, digest(changed));
		}
	}

	#[test]
	fn assessment_is_stable_across_finding_order() {
		let first = finding();
		let mut second = finding();
		second.rule_id = "second-rule".to_string();

		let forward = assessment_digest_with_versions(
			"content",
			"engine",
			Verdict::Suspicious,
			&[first.clone(), second.clone()],
			b"detector",
			b"policy",
		);
		let reverse = assessment_digest_with_versions(
			"content",
			"engine",
			Verdict::Suspicious,
			&[second, first],
			b"detector",
			b"policy",
		);

		assert_eq!(forward, reverse);
	}
}
