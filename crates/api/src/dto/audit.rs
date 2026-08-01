//! DTOs mirroring `skill_audit::AuditReport` at the HTTP boundary, with ts-rs
//! bindings for the frontend. Kept separate so the skill-audit crate stays free
//! of ts-rs, matching how the other DTOs mirror core models.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use skill_audit::{
	AuditReport, Category, Confidence, Finding, FindingSource, Severity,
	Verdict,
};

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum VerdictDto {
	Benign,
	Suspicious,
	Malicious,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ConfidenceDto {
	Low,
	Medium,
	High,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum SeverityDto {
	Info,
	Low,
	Medium,
	High,
	Critical,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CategoryDto {
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

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum FindingSourceDto {
	Yara,
	Injection,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct FindingDto {
	pub rule_id: String,
	pub category: CategoryDto,
	pub severity: SeverityDto,
	pub file: String,
	pub line: Option<u32>,
	pub evidence: String,
	pub source: FindingSourceDto,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct AuditReportDto {
	pub verdict: VerdictDto,
	pub confidence: ConfidenceDto,
	pub findings: Vec<FindingDto>,
	pub summary: String,
	pub engine_version: String,
	pub content_digest: String,
	pub assessment_digest: String,
	pub confirmation_required: bool,
}

/// Request to audit one logical skill across all of its installed paths.
#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct AuditRequest {
	pub paths: Vec<String>,
}

impl From<Verdict> for VerdictDto {
	fn from(v: Verdict) -> Self {
		match v {
			Verdict::Benign => Self::Benign,
			Verdict::Suspicious => Self::Suspicious,
			Verdict::Malicious => Self::Malicious,
		}
	}
}

impl From<Confidence> for ConfidenceDto {
	fn from(c: Confidence) -> Self {
		match c {
			Confidence::Low => Self::Low,
			Confidence::Medium => Self::Medium,
			Confidence::High => Self::High,
		}
	}
}

impl From<Severity> for SeverityDto {
	fn from(s: Severity) -> Self {
		match s {
			Severity::Info => Self::Info,
			Severity::Low => Self::Low,
			Severity::Medium => Self::Medium,
			Severity::High => Self::High,
			Severity::Critical => Self::Critical,
		}
	}
}

impl From<Category> for CategoryDto {
	fn from(c: Category) -> Self {
		match c {
			Category::CredentialExfil => Self::CredentialExfil,
			Category::DataExfil => Self::DataExfil,
			Category::CommandInjection => Self::CommandInjection,
			Category::PromptInjection => Self::PromptInjection,
			Category::ToolChaining => Self::ToolChaining,
			Category::Persistence => Self::Persistence,
			Category::HostTamper => Self::HostTamper,
			Category::Obfuscation => Self::Obfuscation,
			Category::Other => Self::Other,
		}
	}
}

impl From<FindingSource> for FindingSourceDto {
	fn from(s: FindingSource) -> Self {
		match s {
			FindingSource::Yara => Self::Yara,
			FindingSource::Injection => Self::Injection,
		}
	}
}

impl From<Finding> for FindingDto {
	fn from(f: Finding) -> Self {
		Self {
			rule_id: f.rule_id,
			category: f.category.into(),
			severity: f.severity.into(),
			file: f.file,
			line: f.line,
			evidence: f.evidence,
			source: f.source.into(),
		}
	}
}

impl From<AuditReport> for AuditReportDto {
	fn from(r: AuditReport) -> Self {
		let confirmation_required =
			matches!(skill_audit::decide(&r), skill_audit::Action::Block);
		Self {
			verdict: r.verdict.into(),
			confidence: r.confidence.into(),
			findings: r.findings.into_iter().map(Into::into).collect(),
			summary: r.summary,
			engine_version: r.engine_version,
			content_digest: r.content_digest,
			assessment_digest: r.assessment_digest,
			confirmation_required,
		}
	}
}
