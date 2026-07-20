//! Usage routes: thin handlers over the `aghub-usage` crate, which owns the
//! ccusage shell-out, normalization, and vendor limit-endpoint logic.
//!
//! The summary and limits handlers degrade gracefully: a failing agent
//! (ccusage missing, vendor endpoint down, not logged in) lands in the report's
//! `warnings` rather than producing an HTTP error, so the dashboard still
//! renders whatever is available. Clients must therefore treat a 200 with
//! empty `agents` and a non-empty `warnings` list as a degraded state, not as
//! success.

use rocket::http::Status;
use rocket::serde::json::Json;
use rocket::State;

use std::path::PathBuf;
use std::time::Duration;

use aghub_usage::{
	CcusageRuntimeDto, InstallCcusageRuntimeRequest, SetCcusageRuntimeRequest,
	UsageLimitsReportDto, UsageQuery, UsageReportDto, UsageStatusDto,
};

use crate::auth::ApiAuth;
use crate::error::{ApiError, ApiResult};
use crate::extractors::TrustedLocalOrigin;
use crate::state::UsageState;

/// Query params for [`usage_summary`]. Grouped so the handler stays under
/// Rocket's per-param argument count.
#[derive(rocket::FromForm)]
pub struct UsageSummaryParams {
	since: Option<String>,
	until: Option<String>,
	timezone: Option<String>,
	offline: Option<bool>,
	config: Option<String>,
	timeout_secs: Option<u64>,
	/// Whitespace-separated power-user ccusage flags appended verbatim.
	args: Option<String>,
}

/// `GET /api/v1/usage/summary` — daily token/cost usage for every ccusage agent
/// that has local data.
///
/// `offline`/`config`/`timeout_secs`/`args` map onto ccusage flags; omitted ones
/// keep the [`UsageQuery`] defaults (cached offline pricing, 30s timeout).
#[get("/usage/summary?<params..>")]
pub async fn usage_summary(
	_auth: ApiAuth,
	usage: &State<UsageState>,
	params: UsageSummaryParams,
) -> Json<UsageReportDto> {
	let query = UsageQuery {
		since: params.since,
		until: params.until,
		timezone: params.timezone,
		offline: params.offline.unwrap_or(true),
		config: params.config.map(PathBuf::from),
		timeout: Duration::from_secs(
			params
				.timeout_secs
				.filter(|s| *s > 0)
				.unwrap_or(aghub_usage::DEFAULT_TIMEOUT_SECS),
		),
		extra_args: params
			.args
			.map(|s| s.split_whitespace().map(String::from).collect())
			.unwrap_or_default(),
	};
	let report = match usage.runtime.snapshot().await {
		Ok(executable) => {
			aghub_usage::summary(executable.path.as_os_str(), &query).await
		}
		Err(error) => UsageReportDto {
			agents: Vec::new(),
			generated_at: chrono::Utc::now().to_rfc3339(),
			ccusage_version: "unavailable".to_string(),
			warnings: vec![format!(
				"ccusage unavailable: {}",
				error.client_message()
			)],
		},
	};
	Json(report)
}

/// `GET /api/v1/usage/limits` — remaining rate-limit quota for Claude and Codex.
#[get("/usage/limits")]
pub async fn usage_limits(_auth: ApiAuth) -> Json<UsageLimitsReportDto> {
	Json(aghub_usage::limits().await)
}

/// `GET /api/v1/usage/status` — ccusage version, health, and update hint.
#[get("/usage/status")]
pub async fn usage_status(
	_auth: ApiAuth,
	usage: &State<UsageState>,
) -> Json<UsageStatusDto> {
	Json(usage.runtime.status().await)
}

#[get("/usage/runtime")]
pub async fn ccusage_runtime(
	_auth: ApiAuth,
	usage: &State<UsageState>,
) -> ApiResult<CcusageRuntimeDto> {
	usage
		.runtime
		.describe()
		.await
		.map(Json)
		.map_err(runtime_error)
}

#[put("/usage/runtime", data = "<body>")]
pub async fn set_ccusage_runtime(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	usage: &State<UsageState>,
	body: Json<SetCcusageRuntimeRequest>,
) -> ApiResult<CcusageRuntimeDto> {
	usage
		.runtime
		.select(body.into_inner())
		.await
		.map(Json)
		.map_err(runtime_error)
}

#[post("/usage/runtime/install", data = "<body>")]
pub async fn install_ccusage_runtime(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	usage: &State<UsageState>,
	body: Json<InstallCcusageRuntimeRequest>,
) -> ApiResult<CcusageRuntimeDto> {
	usage
		.runtime
		.install(body.into_inner())
		.await
		.map(Json)
		.map_err(runtime_error)
}

#[post("/usage/runtime/update")]
pub async fn update_ccusage_runtime(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	usage: &State<UsageState>,
) -> ApiResult<CcusageRuntimeDto> {
	usage
		.runtime
		.update()
		.await
		.map(Json)
		.map_err(runtime_error)
}

#[post("/usage/runtime/refresh")]
pub async fn refresh_ccusage_runtime(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	usage: &State<UsageState>,
) -> ApiResult<CcusageRuntimeDto> {
	usage
		.runtime
		.refresh()
		.await
		.map(Json)
		.map_err(runtime_error)
}

fn runtime_error(error: aghub_usage::runtime::CcusageRuntimeError) -> ApiError {
	use aghub_usage::runtime::CcusageRuntimeError;

	let message = error.client_message();
	let (status, code) = match error {
		CcusageRuntimeError::ManualPathRequired
		| CcusageRuntimeError::EnvironmentCannotBeSelected
		| CcusageRuntimeError::SourceCannotInstall(_)
		| CcusageRuntimeError::SourceCannotUpdate(_)
		| CcusageRuntimeError::InvalidBinary(_)
		| CcusageRuntimeError::UnsupportedPlatform { .. } => {
			(Status::UnprocessableEntity, "CCUSAGE_INVALID_RUNTIME")
		}
		CcusageRuntimeError::NoRuntime
		| CcusageRuntimeError::SourceUnavailable(_)
		| CcusageRuntimeError::SourceNotInstalled(_) => {
			(Status::Conflict, "CCUSAGE_RUNTIME_UNAVAILABLE")
		}
		CcusageRuntimeError::Http(_) => {
			(Status::BadGateway, "CCUSAGE_REGISTRY_UNAVAILABLE")
		}
		CcusageRuntimeError::InstallTimedOut(_)
		| CcusageRuntimeError::RuntimeOperationTimedOut => {
			(Status::GatewayTimeout, "CCUSAGE_RUNTIME_TIMEOUT")
		}
		_ => (Status::InternalServerError, "CCUSAGE_RUNTIME_ERROR"),
	};
	ApiError::new(status, message, code)
}

#[cfg(test)]
mod tests {
	use super::*;
	use aghub_usage::runtime::CcusageRuntimeError;
	use aghub_usage::CcusageRuntimeSource;

	#[test]
	fn runtime_timeouts_map_to_gateway_timeout() {
		for error in [
			CcusageRuntimeError::InstallTimedOut(CcusageRuntimeSource::Npm),
			CcusageRuntimeError::RuntimeOperationTimedOut,
		] {
			let response = runtime_error(error);
			assert_eq!(response.status, Status::GatewayTimeout);
			assert_eq!(response.body.code, "CCUSAGE_RUNTIME_TIMEOUT");
		}
	}
}
