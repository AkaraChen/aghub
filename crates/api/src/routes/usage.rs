//! Usage routes: thin handlers over the `aghub-usage` crate, which owns the
//! ccusage shell-out, normalization, and vendor limit-endpoint logic.

use rocket::serde::json::Json;
use rocket::State;

use aghub_usage::{UsageLimitsReportDto, UsageReportDto};

use crate::state::UsageState;

/// `GET /api/v1/usage/summary` — daily token/cost usage for Claude and Codex.
#[get("/usage/summary?<since>&<until>&<timezone>")]
pub async fn usage_summary(
	usage: &State<UsageState>,
	since: Option<String>,
	until: Option<String>,
	timezone: Option<String>,
) -> Json<UsageReportDto> {
	let bin = aghub_usage::resolve_ccusage_bin(usage.ccusage_bin.clone());
	Json(aghub_usage::summary(&bin, since, until, timezone).await)
}

/// `GET /api/v1/usage/limits` — remaining rate-limit quota for Claude and Codex.
#[get("/usage/limits")]
pub async fn usage_limits() -> Json<UsageLimitsReportDto> {
	Json(aghub_usage::limits().await)
}
