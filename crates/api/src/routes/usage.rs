//! Usage monitoring: shells out to the bundled `ccusage` binary and normalizes
//! its per-agent `--json` output into the unified [`UsageReportDto`].
//!
//! ccusage is reused as-is (it owns parsing, dedup, pricing, format tracking);
//! this module is only the adapter layer. Claude and Codex emit different JSON
//! shapes, so each has its own deserialization struct and mapping function.

use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::time::Duration;

use rocket::serde::json::Json;
use rocket::State;
use serde::Deserialize;

use crate::dto::usage::{
	AgentUsageDto, UsageDayDto, UsageModelDto, UsageReportDto, UsageTotalsDto,
};
use crate::error::ApiError;
use crate::state::UsageState;

const CCUSAGE_TIMEOUT: Duration = Duration::from_secs(30);

/// Locate the ccusage binary. Preference order: the sidecar path injected by
/// the desktop shell (`UsageState`), then the `AGHUB_CCUSAGE_BIN` env var (dev),
/// then `ccusage` on `PATH`.
fn ccusage_bin(state: &UsageState) -> OsString {
	if let Some(path) = &state.ccusage_bin {
		return path.clone().into_os_string();
	}
	std::env::var_os("AGHUB_CCUSAGE_BIN")
		.unwrap_or_else(|| OsString::from("ccusage"))
}

async fn run_ccusage(
	bin: &OsStr,
	args: Vec<String>,
) -> Result<Vec<u8>, ApiError> {
	let run = tokio::process::Command::new(bin).args(&args).output();
	let output = tokio::time::timeout(CCUSAGE_TIMEOUT, run)
		.await
		.map_err(|_| ApiError::internal("ccusage timed out after 30s"))?
		.map_err(|e| {
			ApiError::internal(format!(
				"failed to spawn ccusage ({}): {e}",
				bin.to_string_lossy()
			))
		})?;
	if !output.status.success() {
		return Err(ApiError::internal(format!(
			"ccusage {:?} exited with {}: {}",
			args,
			output.status,
			String::from_utf8_lossy(&output.stderr)
		)));
	}
	Ok(output.stdout)
}

/// `ccusage --version` → e.g. "ccusage 20.0.6"; "unknown" if it can't be read.
async fn ccusage_version(bin: &OsStr) -> String {
	run_ccusage(bin, vec!["--version".to_string()])
		.await
		.ok()
		.and_then(|out| String::from_utf8(out).ok())
		.map(|s| s.trim().to_string())
		.filter(|s| !s.is_empty())
		.unwrap_or_else(|| "unknown".to_string())
}

// ---- ccusage `claude daily --json` shape -----------------------------------

#[derive(Deserialize)]
struct CcClaudeReport {
	daily: Vec<CcClaudeDay>,
	totals: CcClaudeTotals,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CcClaudeDay {
	date: String,
	input_tokens: u64,
	output_tokens: u64,
	cache_creation_tokens: u64,
	cache_read_tokens: u64,
	total_tokens: u64,
	total_cost: f64,
	#[serde(default)]
	model_breakdowns: Vec<CcClaudeModel>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CcClaudeModel {
	model_name: String,
	input_tokens: u64,
	output_tokens: u64,
	cache_creation_tokens: u64,
	cache_read_tokens: u64,
	cost: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CcClaudeTotals {
	input_tokens: u64,
	output_tokens: u64,
	cache_creation_tokens: u64,
	cache_read_tokens: u64,
	total_tokens: u64,
	total_cost: f64,
}

// ---- ccusage `codex daily --json` shape ------------------------------------

#[derive(Deserialize)]
struct CcCodexReport {
	daily: Vec<CcCodexDay>,
	totals: CcCodexTotals,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CcCodexDay {
	date: String,
	input_tokens: u64,
	cached_input_tokens: u64,
	output_tokens: u64,
	reasoning_output_tokens: u64,
	total_tokens: u64,
	#[serde(rename = "costUSD")]
	cost_usd: f64,
	#[serde(default)]
	models: HashMap<String, CcCodexModel>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CcCodexModel {
	input_tokens: u64,
	cached_input_tokens: u64,
	output_tokens: u64,
	reasoning_output_tokens: u64,
	total_tokens: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CcCodexTotals {
	input_tokens: u64,
	cached_input_tokens: u64,
	output_tokens: u64,
	reasoning_output_tokens: u64,
	total_tokens: u64,
	#[serde(rename = "costUSD")]
	cost_usd: f64,
}

// ---- normalization ---------------------------------------------------------
//
// Decisions baked in here (worth a review):
//   * Claude has no reasoning tokens -> reasoning_tokens = 0.
//   * Codex has no cache-creation -> cache_creation_tokens = 0, and its
//     `cachedInputTokens` maps onto the unified `cache_read_tokens`.
//   * Codex's per-model map carries no cost, so per-model cost_usd = None
//     (only the day/total cost is known); Claude's per-model cost is Some.
//   * Claude's per-model breakdown has no totalTokens field, so we sum it.

fn claude_to_agent(report: CcClaudeReport) -> AgentUsageDto {
	let days = report
		.daily
		.into_iter()
		.map(|d| UsageDayDto {
			date: d.date,
			input_tokens: d.input_tokens,
			output_tokens: d.output_tokens,
			cache_creation_tokens: d.cache_creation_tokens,
			cache_read_tokens: d.cache_read_tokens,
			reasoning_tokens: 0,
			total_tokens: d.total_tokens,
			cost_usd: Some(d.total_cost),
			models: d
				.model_breakdowns
				.into_iter()
				.map(|m| UsageModelDto {
					total_tokens: m.input_tokens
						+ m.output_tokens + m.cache_creation_tokens
						+ m.cache_read_tokens,
					model: m.model_name,
					input_tokens: m.input_tokens,
					output_tokens: m.output_tokens,
					cache_creation_tokens: m.cache_creation_tokens,
					cache_read_tokens: m.cache_read_tokens,
					reasoning_tokens: 0,
					cost_usd: Some(m.cost),
				})
				.collect(),
		})
		.collect();

	AgentUsageDto {
		agent: "claude".to_string(),
		days,
		totals: UsageTotalsDto {
			input_tokens: report.totals.input_tokens,
			output_tokens: report.totals.output_tokens,
			cache_creation_tokens: report.totals.cache_creation_tokens,
			cache_read_tokens: report.totals.cache_read_tokens,
			reasoning_tokens: 0,
			total_tokens: report.totals.total_tokens,
			cost_usd: Some(report.totals.total_cost),
		},
	}
}

fn codex_to_agent(report: CcCodexReport) -> AgentUsageDto {
	let days = report
		.daily
		.into_iter()
		.map(|d| UsageDayDto {
			date: d.date,
			input_tokens: d.input_tokens,
			output_tokens: d.output_tokens,
			cache_creation_tokens: 0,
			cache_read_tokens: d.cached_input_tokens,
			reasoning_tokens: d.reasoning_output_tokens,
			total_tokens: d.total_tokens,
			cost_usd: Some(d.cost_usd),
			models: d
				.models
				.into_iter()
				.map(|(name, m)| UsageModelDto {
					model: name,
					input_tokens: m.input_tokens,
					output_tokens: m.output_tokens,
					cache_creation_tokens: 0,
					cache_read_tokens: m.cached_input_tokens,
					reasoning_tokens: m.reasoning_output_tokens,
					total_tokens: m.total_tokens,
					cost_usd: None,
				})
				.collect(),
		})
		.collect();

	AgentUsageDto {
		agent: "codex".to_string(),
		days,
		totals: UsageTotalsDto {
			input_tokens: report.totals.input_tokens,
			output_tokens: report.totals.output_tokens,
			cache_creation_tokens: 0,
			cache_read_tokens: report.totals.cached_input_tokens,
			reasoning_tokens: report.totals.reasoning_output_tokens,
			total_tokens: report.totals.total_tokens,
			cost_usd: Some(report.totals.cost_usd),
		},
	}
}

async fn fetch_claude_usage(
	bin: &OsStr,
	args: Vec<String>,
) -> Result<AgentUsageDto, String> {
	let raw = run_ccusage(bin, args).await.map_err(|e| e.body.error)?;
	let report: CcClaudeReport = serde_json::from_slice(&raw)
		.map_err(|e| format!("parse claude usage json: {e}"))?;
	Ok(claude_to_agent(report))
}

async fn fetch_codex_usage(
	bin: &OsStr,
	args: Vec<String>,
) -> Result<AgentUsageDto, String> {
	let raw = run_ccusage(bin, args).await.map_err(|e| e.body.error)?;
	let report: CcCodexReport = serde_json::from_slice(&raw)
		.map_err(|e| format!("parse codex usage json: {e}"))?;
	Ok(codex_to_agent(report))
}

/// `GET /api/v1/usage/summary` — daily token/cost usage for Claude and Codex.
///
/// Degrades gracefully: if one agent's ccusage call fails (not installed, no
/// data, malformed output) it is reported in `warnings` instead of failing the
/// whole request, so the home page can still render whatever is available.
#[get("/usage/summary?<since>&<until>&<timezone>")]
pub async fn usage_summary(
	usage: &State<UsageState>,
	since: Option<String>,
	until: Option<String>,
	timezone: Option<String>,
) -> Json<UsageReportDto> {
	let bin = ccusage_bin(usage);
	let build_args = |agent: &str| -> Vec<String> {
		let mut args = vec![
			agent.to_string(),
			"daily".to_string(),
			"--json".to_string(),
			"--offline".to_string(),
		];
		if let Some(s) = &since {
			args.push("--since".to_string());
			args.push(s.clone());
		}
		if let Some(u) = &until {
			args.push("--until".to_string());
			args.push(u.clone());
		}
		if let Some(tz) = &timezone {
			args.push("--timezone".to_string());
			args.push(tz.clone());
		}
		args
	};

	let (version, claude_res, codex_res) = tokio::join!(
		ccusage_version(&bin),
		fetch_claude_usage(&bin, build_args("claude")),
		fetch_codex_usage(&bin, build_args("codex")),
	);

	let mut agents = Vec::new();
	let mut warnings = Vec::new();
	match claude_res {
		Ok(agent) => agents.push(agent),
		Err(e) => warnings.push(format!("claude usage unavailable: {e}")),
	}
	match codex_res {
		Ok(agent) => agents.push(agent),
		Err(e) => warnings.push(format!("codex usage unavailable: {e}")),
	}

	Json(UsageReportDto {
		agents,
		generated_at: chrono::Utc::now().to_rfc3339(),
		ccusage_version: version,
		warnings,
	})
}
