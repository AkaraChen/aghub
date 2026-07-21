//! ts-rs–exported usage & rate-limit DTOs — the wire contract for
//! `GET /api/v1/usage/{summary,limits}`, regenerated into the desktop app's
//! `generated/dto` via `crates/api/src/bin/export-dto.rs`. These types are the
//! deliverable: every `pub` here has a TypeScript consumer.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The ccusage agent id a usage/limits row belongs to (e.g. "claude", "codex",
/// "opencode"). Open set: ccusage reports token usage for many agents, only some
/// of which ("claude", "codex") also expose an OAuth rate-limit endpoint.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct UsageAgent(pub String);

impl UsageAgent {
	pub(crate) fn new(id: impl Into<String>) -> Self {
		Self(id.into())
	}
}

/// Unified usage report across agents, returned by `GET /api/v1/usage/summary`.
///
/// ccusage emits a different JSON shape per agent (claude has cache-creation,
/// codex has reasoning, cost keys differ); this DTO is the normalized shape the
/// frontend consumes. The mapping from each ccusage shape lives in
/// `claude_to_agent` / `codex_to_agent`.
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct UsageReportDto {
	pub agents: Vec<AgentUsageDto>,
	pub generated_at: String,
	pub ccusage_version: String,
	/// Non-fatal notes (e.g. an agent had no data, a model had no pricing).
	pub warnings: Vec<String>,
}

/// ccusage runtime health + version, returned by `GET /api/v1/usage/status`.
/// Runtime selection and acquisition details are returned by
/// `GET /api/v1/usage/runtime` without exposing local filesystem paths.
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct UsageStatusDto {
	/// `ccusage --version` output, or `null` when it could not run.
	pub version: Option<String>,
	/// Whether `ccusage --version` succeeded.
	pub reachable: bool,
	/// Error text when `reachable` is false.
	pub error: Option<String>,
	/// Latest ccusage version on npm, when the registry check succeeded.
	pub latest_version: Option<String>,
	/// `true` when `latest_version` is newer than the running `version`.
	pub update_available: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CcusageRuntimeSource {
	Auto,
	Environment,
	Manual,
	Path,
	Bun,
	Npm,
	Download,
	Bundled,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SetCcusageRuntimeRequest {
	pub source: CcusageRuntimeSource,
	pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InstallCcusageRuntimeRequest {
	pub source: CcusageRuntimeSource,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct CcusageRuntimeExecutableDto {
	pub source: CcusageRuntimeSource,
	pub path: String,
	pub version: String,
	pub can_update: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct CcusageRuntimeCandidateDto {
	pub source: CcusageRuntimeSource,
	pub installed: bool,
	pub path: Option<String>,
	pub version: Option<String>,
	pub can_install: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct CcusageRuntimeDto {
	pub preference: CcusageRuntimeSource,
	pub active: Option<CcusageRuntimeExecutableDto>,
	pub candidates: Vec<CcusageRuntimeCandidateDto>,
	pub latest_version: Option<String>,
	pub update_available: bool,
	pub error: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct AgentUsageDto {
	pub agent: UsageAgent,
	pub days: Vec<UsageDayDto>,
	pub totals: UsageTotalsDto,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct UsageDayDto {
	/// "YYYY-MM-DD"
	pub date: String,
	pub input_tokens: u64,
	pub output_tokens: u64,
	/// Cache write tokens (claude only; 0 for codex).
	pub cache_creation_tokens: u64,
	/// Cache read tokens (claude `cacheRead`, codex `cachedInput`).
	pub cache_read_tokens: u64,
	/// Reasoning tokens (codex only; 0 for claude).
	pub reasoning_tokens: u64,
	pub total_tokens: u64,
	/// USD cost. `None` when ccusage could not price it (unknown model).
	pub cost_usd: Option<f64>,
	pub models: Vec<UsageModelDto>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct UsageModelDto {
	pub model: String,
	pub input_tokens: u64,
	pub output_tokens: u64,
	pub cache_creation_tokens: u64,
	pub cache_read_tokens: u64,
	pub reasoning_tokens: u64,
	pub total_tokens: u64,
	/// USD cost. `None` for codex (its per-model map carries no cost).
	pub cost_usd: Option<f64>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct UsageTotalsDto {
	pub input_tokens: u64,
	pub output_tokens: u64,
	pub cache_creation_tokens: u64,
	pub cache_read_tokens: u64,
	pub reasoning_tokens: u64,
	pub total_tokens: u64,
	pub cost_usd: Option<f64>,
}

/// Remaining-quota report across agents, returned by `GET /api/v1/usage/limits`.
///
/// Unlike [`UsageReportDto`] (consumed tokens from local ccusage data), this
/// queries each vendor's private OAuth usage endpoint for how much of the
/// current rate-limit window is left. Auth tokens are read from each agent's
/// local credential store.
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct UsageLimitsReportDto {
	pub agents: Vec<AgentLimitsDto>,
	pub generated_at: String,
	/// Non-fatal notes (e.g. an agent is not logged in, or its endpoint failed).
	pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct AgentLimitsDto {
	pub agent: UsageAgent,
	pub windows: Vec<LimitWindowDto>,
}

/// Which rate-limit window a [`LimitWindowDto`] describes. `weekly_opus` /
/// `weekly_sonnet` are Claude-only and omitted when the endpoint doesn't report
/// them; Codex maps `primary`/`secondary` onto `5h`/`weekly`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, TS)]
#[ts(export)]
pub enum LimitWindowKind {
	#[serde(rename = "5h")]
	FiveHour,
	#[serde(rename = "weekly")]
	Weekly,
	#[serde(rename = "weekly_opus")]
	WeeklyOpus,
	#[serde(rename = "weekly_sonnet")]
	WeeklySonnet,
}

/// One rate-limit window for an agent.
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct LimitWindowDto {
	pub kind: LimitWindowKind,
	/// Percent of the window consumed, 0-100 (Codex's `percent_left` is
	/// converted to `100 - percent_left` here so all windows share a meaning).
	pub utilization_pct: f64,
	/// ISO-8601 reset time, when the endpoint reports one.
	pub resets_at: Option<String>,
}
