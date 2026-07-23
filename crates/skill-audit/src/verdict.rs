//! Fold raw findings into a single verdict — the security stance of the crate.
//!
//! This is the one place that encodes "how paranoid are we". Everything else is
//! plumbing (read files, run YARA, serialize). Keep the logic here small and
//! readable so the stance stays auditable.

use crate::report::{Finding, FindingSource, Severity, Verdict};

pub(crate) const VERDICT_VERSION: &[u8] = b"skill-audit-verdict-v1";

/// Aggregate findings into a [`Verdict`] (plan "a").
///
/// Stance:
/// - any **Critical** finding → `Malicious` (Critical is reserved, by the rules
///   themselves, for low-false-positive patterns like `ssh key + curl`).
/// - a single **High**, **two or more** Medium findings, or any L2
///   injection signal → `Suspicious`.
/// - otherwise → `Benign`.
///
/// False positives are tolerated on purpose: an extra warning is cheaper than
/// a missed malicious skill, while Critical is kept deliberately narrow.
pub fn aggregate(findings: &[Finding]) -> Verdict {
	// TODO(akarachen): this is THE security-stance knob — review/tune to taste.
	// Tweak the thresholds below (e.g. require 2+ Medium, or treat a lone Medium
	// as Benign) until it matches how aggressive you want the gate to be.
	if findings.iter().any(|f| f.severity == Severity::Critical) {
		return Verdict::Malicious;
	}

	let has_high = findings.iter().any(|f| f.severity == Severity::High);
	let medium_count = findings
		.iter()
		.filter(|f| f.severity == Severity::Medium)
		.count();
	let has_injection = findings
		.iter()
		.any(|f| f.source == FindingSource::Injection);

	if has_high || medium_count >= 2 || has_injection {
		Verdict::Suspicious
	} else {
		Verdict::Benign
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::report::{Category, Flow};

	fn medium_finding(rule_id: &str) -> Finding {
		Finding {
			rule_id: rule_id.to_string(),
			category: Category::Other,
			severity: Severity::Medium,
			file: "SKILL.md".to_string(),
			line: None,
			evidence: "test".to_string(),
			source: FindingSource::Yara,
			flow: Flow::None,
		}
	}

	#[test]
	fn two_medium_findings_in_one_category_are_suspicious() {
		let findings = [medium_finding("first"), medium_finding("second")];

		assert_eq!(aggregate(&findings), Verdict::Suspicious);
	}
}
