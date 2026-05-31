use serde::Serialize;
use ts_rs::TS;

/// Unified usage report across agents, returned by `GET /api/v1/usage/summary`.
///
/// ccusage emits a different JSON shape per agent (claude has cache-creation,
/// codex has reasoning, cost keys differ); this DTO is the normalized shape the
/// frontend consumes. The mapping from each ccusage shape lives in
/// `routes::usage`.
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
