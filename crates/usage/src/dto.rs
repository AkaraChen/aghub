use serde::Serialize;
use ts_rs::TS;

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

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct AgentUsageDto {
	/// "claude" | "codex"
	pub agent: String,
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
	/// "claude" | "codex"
	pub agent: String,
	pub windows: Vec<LimitWindowDto>,
}

/// One rate-limit window for an agent.
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct LimitWindowDto {
	/// "5h" | "weekly" | "weekly_opus" | "weekly_sonnet"
	pub kind: String,
	/// Percent of the window consumed, 0-100 (Codex's `percent_left` is
	/// converted to `100 - percent_left` here so all windows share a meaning).
	pub utilization_pct: f64,
	/// ISO-8601 reset time, when the endpoint reports one.
	pub resets_at: Option<String>,
}
