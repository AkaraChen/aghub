//! Usage routes: thin handlers over the `aghub-usage` crate, which owns the
//! ccusage shell-out, normalization, and vendor limit-endpoint logic.
//!
//! Both handlers degrade gracefully: a failing agent (ccusage missing, vendor
//! endpoint down, not logged in) lands in the report's `warnings` rather than
//! producing an HTTP error, so the dashboard still renders whatever is
//! available. Clients must therefore treat a 200 with empty `agents` and a
//! non-empty `warnings` list as a degraded state, not as success.

use rocket::serde::json::Json;
use rocket::State;

use std::path::PathBuf;
use std::time::Duration;

use aghub_usage::{UsageLimitsReportDto, UsageQuery, UsageReportDto};

use crate::auth::ApiAuth;
use crate::state::UsageState;

/// `GET /api/v1/usage/summary` — daily token/cost usage for Claude and Codex.
///
/// `offline`/`config`/`timeout_secs` map onto ccusage flags; omitted ones keep
/// the [`UsageQuery`] defaults (cached offline pricing, 30s timeout).
#[get(
	"/usage/summary?<since>&<until>&<timezone>&<offline>&<config>&<timeout_secs>"
)]
pub async fn usage_summary(
	_auth: ApiAuth,
	usage: &State<UsageState>,
	since: Option<String>,
	until: Option<String>,
	timezone: Option<String>,
	offline: Option<bool>,
	config: Option<String>,
	timeout_secs: Option<u64>,
) -> Json<UsageReportDto> {
	let bin = aghub_usage::resolve_ccusage_bin(usage.ccusage_bin.clone());
	let query = UsageQuery {
		since,
		until,
		timezone,
		offline: offline.unwrap_or(true),
		config: config.map(PathBuf::from),
		timeout: Duration::from_secs(
			timeout_secs
				.filter(|s| *s > 0)
				.unwrap_or(aghub_usage::DEFAULT_TIMEOUT_SECS),
		),
	};
	Json(aghub_usage::summary(&bin, &query).await)
}

/// `GET /api/v1/usage/limits` — remaining rate-limit quota for Claude and Codex.
#[get("/usage/limits")]
pub async fn usage_limits(_auth: ApiAuth) -> Json<UsageLimitsReportDto> {
	Json(aghub_usage::limits().await)
}
