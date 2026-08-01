//! Security audit for AI agent skills.
//!
//! Two offline layers — no network, no API key, no external process:
//! - **L1 static**: YARA rules (cisco + clawhub) over SKILL.md and resource files.
//! - **L2 injection**: zero-width / bidi chars, hidden comments, prompt-override phrases.
//!
//! The crate only produces *facts* ([`AuditReport`]) and a suggested [`Action`].
//! Enforcement (block / override / exit code) is the caller's job — see [`policy`].

pub mod engine;
pub mod input;
pub mod policy;
pub mod report;
pub mod rules;
pub mod verdict;

pub use input::{AuditInput, ResourceFile};
pub use policy::{decide, Action};
pub use report::{
	combine_reports, AuditReport, Category, Confidence, Finding, FindingSource,
	Severity, Verdict,
};

/// Failure to run the audit engine.
#[derive(Debug, thiserror::Error)]
pub enum AuditError {
	#[error("bundled YARA rules could not be compiled: {0}")]
	RuleCompilation(String),
	#[error("YARA could not scan '{file}': {message}")]
	Scan { file: String, message: String },
}

/// Run the offline audit (L1 YARA + L2 injection) over a prepared input.
/// No I/O — it only inspects the bytes already in `input`.
pub fn audit(input: &AuditInput) -> Result<AuditReport, AuditError> {
	engine::run(input)
}
