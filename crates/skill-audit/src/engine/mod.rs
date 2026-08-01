//! Audit orchestration: L1 YARA + L2 injection → findings → verdict → report.

mod injection;
mod yara;

use std::sync::OnceLock;

use crate::input::AuditInput;
use crate::report::{
	assessment_digest, content_digest, hash_part, AuditReport, Category,
	Confidence, Finding, FindingSource, Flow, Severity, Verdict,
};
use crate::verdict::aggregate;
use crate::AuditError;
use sha2::{Digest, Sha256};

const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");
const DETECTOR_VERSION: &[u8] = b"skill-audit-detectors-v2";
const DETECTOR_FINGERPRINT_DOMAIN: &[u8] =
	b"aghub-skill-audit-detector-fingerprint-v1";
static DETECTOR_FINGERPRINT: OnceLock<[u8; 32]> = OnceLock::new();

/// Run every offline layer over `input` and assemble the report.
pub fn run(input: &AuditInput) -> Result<AuditReport, AuditError> {
	let mut findings = Vec::new();

	// L1 — static YARA over SKILL.md and each resource file.
	findings.extend(yara::scan("SKILL.md", input.skill_md.as_bytes())?);
	for res in &input.resources {
		findings.extend(yara::scan(&res.path, &res.content)?);
	}

	// L2 — injection signals over the raw text inputs.
	findings.extend(injection::scan("SKILL.md", &input.skill_md));
	for res in &input.resources {
		if let Ok(content) = std::str::from_utf8(&res.content) {
			findings.extend(injection::scan(&res.path, content));
		}
	}

	// Behavioral-lite: a secret-reading source + a network sink anywhere in the
	// skill (even in different files) implies a possible exfiltration chain.
	if let Some(chain) = dataflow_chain(&findings) {
		findings.push(chain);
	}

	let verdict = aggregate(&findings);
	let confidence = confidence_for(verdict, &findings);
	let summary = summarize(verdict, &findings, &input.name);
	let content_digest = content_digest(input);
	let assessment_digest =
		assessment_digest(&content_digest, ENGINE_VERSION, verdict, &findings);

	Ok(AuditReport {
		verdict,
		confidence,
		findings,
		summary,
		engine_version: ENGINE_VERSION.to_string(),
		content_digest,
		assessment_digest,
	})
}

pub(crate) fn detector_fingerprint() -> &'static [u8; 32] {
	DETECTOR_FINGERPRINT
		.get_or_init(|| detector_fingerprint_for_version(DETECTOR_VERSION))
}

pub(crate) fn detector_fingerprint_for_version(version: &[u8]) -> [u8; 32] {
	let mut hasher = Sha256::new();
	hash_part(&mut hasher, DETECTOR_FINGERPRINT_DOMAIN);
	hash_part(&mut hasher, version);
	hash_part(&mut hasher, crate::rules::fingerprint());
	hash_part(&mut hasher, crate::verdict::VERDICT_VERSION);
	hasher.finalize().into()
}

/// Correlate a `Source` finding (reads secrets) with a `Sink` finding (network
/// egress) into one chain finding, even across files. No taint tracking — pure
/// co-occurrence, so it warns (High → Suspicious) rather than blocks.
fn dataflow_chain(findings: &[Finding]) -> Option<Finding> {
	let source = findings.iter().find(|f| f.flow == Flow::Source)?;
	let sink = findings.iter().find(|f| f.flow == Flow::Sink)?;
	let location = if source.file == sink.file {
		source.file.clone()
	} else {
		format!("{} → {}", source.file, sink.file)
	};
	Some(Finding {
		rule_id: "aghub_dataflow_chain".to_string(),
		category: Category::DataExfil,
		severity: Severity::High,
		file: location,
		line: None,
		evidence: format!(
			"reads secrets in `{}` and sends to network in `{}` — possible exfiltration chain",
			source.file, sink.file
		),
		source: FindingSource::Yara,
		flow: Flow::None,
	})
}

fn confidence_for(verdict: Verdict, findings: &[Finding]) -> Confidence {
	match (verdict, findings.len()) {
		(Verdict::Benign, _) => Confidence::High,
		(_, n) if n >= 2 => Confidence::High,
		_ => Confidence::Medium,
	}
}

fn summarize(verdict: Verdict, findings: &[Finding], name: &str) -> String {
	let n = findings.len();
	match verdict {
		Verdict::Benign => format!("'{name}' looks clean — no concerns found."),
		Verdict::Suspicious => {
			format!("'{name}' has {n} finding(s) worth reviewing before installing.")
		}
		Verdict::Malicious => {
			format!("'{name}' triggered {n} finding(s), including high-severity ones.")
		}
	}
}
