//! Map a verdict to a *suggested* action. Enforcement happens at the boundary
//! (CLI exit code / `--force-unsafe`, API `acknowledge` flag), never here.

use crate::report::{AuditReport, Verdict};
use serde::Serialize;

pub(crate) const POLICY_VERSION: &[u8] = b"skill-audit-block-policy-v2";

/// What the caller is advised to do. Advisory only — not enforced in this crate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
	/// Proceed silently.
	Allow,
	/// Proceed, but surface the findings to the user.
	Warn,
	/// Refuse by default; the caller may override (e.g. `--force-unsafe`).
	Block,
}

/// The suggested action for a report. CLI/API decide how to honor it.
pub fn decide(report: &AuditReport) -> Action {
	match report.verdict {
		Verdict::Benign => Action::Allow,
		Verdict::Suspicious => Action::Warn,
		Verdict::Malicious => Action::Block,
	}
}
