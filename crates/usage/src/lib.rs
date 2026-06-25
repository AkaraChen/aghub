//! Usage and rate-limit reporting for AI coding agents.
//!
//! Two independent data sources:
//!   * `summary` shells out to the bundled `ccusage` binary and normalizes its
//!     per-agent `--json` output into the unified [`UsageReportDto`].
//!   * `limits` queries each vendor's private OAuth usage endpoint for how much
//!     of the current rate-limit window is left, using tokens read from each
//!     agent's local credential store.
//!
//! ccusage is reused as-is (it owns parsing, dedup, pricing, format tracking);
//! this crate is only the adapter layer. Claude and Codex emit different JSON
//! shapes, so each has its own deserialization struct and mapping function.

mod dto;
pub use dto::*;

use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::path::PathBuf;
use std::time::Duration;

use serde::Deserialize;

const CCUSAGE_TIMEOUT: Duration = Duration::from_secs(30);
const LIMITS_TIMEOUT: Duration = Duration::from_secs(15);

/// Windows `CREATE_NO_WINDOW` process-creation flag. The desktop app runs
/// without a console, so an unflagged child would flash a console window on
/// every ccusage call; this suppresses it (same flag the api / cc-plugins
/// crates pass to their own child processes).
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Locate the ccusage binary. Preference order: an explicit path injected by the
/// caller (the desktop shell passes the bundled sidecar), then the
/// `AGHUB_CCUSAGE_BIN` env var (dev), then `ccusage` on `PATH`.
pub fn resolve_ccusage_bin(explicit: Option<PathBuf>) -> OsString {
	if let Some(path) = explicit {
		return path.into_os_string();
	}
	std::env::var_os("AGHUB_CCUSAGE_BIN")
		.unwrap_or_else(|| OsString::from("ccusage"))
}

async fn run_ccusage(
	bin: &OsStr,
	args: Vec<String>,
) -> Result<Vec<u8>, String> {
	let mut cmd = tokio::process::Command::new(bin);
	cmd.kill_on_drop(true).args(&args);
	// Suppress the console window Windows would otherwise pop for the child when
	// the spawning process (the desktop app) has none.
	#[cfg(target_os = "windows")]
	cmd.creation_flags(CREATE_NO_WINDOW);
	let output = tokio::time::timeout(CCUSAGE_TIMEOUT, cmd.output())
		.await
		.map_err(|_| "ccusage timed out after 30s".to_string())?
		.map_err(|e| format!("failed to spawn ccusage: {e}"))?;
	if !output.status.success() {
		return Err(format!(
			"ccusage {:?} exited with {}: {}",
			args,
			output.status,
			String::from_utf8_lossy(&output.stderr)
		));
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
	#[serde(default)]
	total_cost: Option<f64>,
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
	#[serde(default)]
	cost: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CcClaudeTotals {
	input_tokens: u64,
	output_tokens: u64,
	cache_creation_tokens: u64,
	cache_read_tokens: u64,
	total_tokens: u64,
	#[serde(default)]
	total_cost: Option<f64>,
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
	#[serde(default, rename = "costUSD")]
	cost_usd: Option<f64>,
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
	#[serde(default, rename = "costUSD")]
	cost_usd: Option<f64>,
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
			cost_usd: d.total_cost,
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
					cost_usd: m.cost,
				})
				.collect(),
		})
		.collect();

	AgentUsageDto {
		agent: UsageAgent::Claude,
		days,
		totals: UsageTotalsDto {
			input_tokens: report.totals.input_tokens,
			output_tokens: report.totals.output_tokens,
			cache_creation_tokens: report.totals.cache_creation_tokens,
			cache_read_tokens: report.totals.cache_read_tokens,
			reasoning_tokens: 0,
			total_tokens: report.totals.total_tokens,
			cost_usd: report.totals.total_cost,
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
			cost_usd: d.cost_usd,
			// ccusage's Codex per-model data is a HashMap, so iteration order is
			// nondeterministic; sort by model name for a stable API/CLI response
			// (Claude's per-model data is already an ordered Vec).
			models: {
				let mut models: Vec<UsageModelDto> = d
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
					.collect();
				models.sort_by(|a, b| a.model.cmp(&b.model));
				models
			},
		})
		.collect();

	AgentUsageDto {
		agent: UsageAgent::Codex,
		days,
		totals: UsageTotalsDto {
			input_tokens: report.totals.input_tokens,
			output_tokens: report.totals.output_tokens,
			cache_creation_tokens: 0,
			cache_read_tokens: report.totals.cached_input_tokens,
			reasoning_tokens: report.totals.reasoning_output_tokens,
			total_tokens: report.totals.total_tokens,
			cost_usd: report.totals.cost_usd,
		},
	}
}

async fn fetch_claude_usage(
	bin: &OsStr,
	args: Vec<String>,
) -> Result<AgentUsageDto, String> {
	let raw = run_ccusage(bin, args).await?;
	let report: CcClaudeReport = serde_json::from_slice(&raw)
		.map_err(|e| format!("parse claude usage json: {e}"))?;
	Ok(claude_to_agent(report))
}

async fn fetch_codex_usage(
	bin: &OsStr,
	args: Vec<String>,
) -> Result<AgentUsageDto, String> {
	let raw = run_ccusage(bin, args).await?;
	let report: CcCodexReport = serde_json::from_slice(&raw)
		.map_err(|e| format!("parse codex usage json: {e}"))?;
	Ok(codex_to_agent(report))
}

/// Daily token/cost usage for Claude and Codex.
///
/// Degrades gracefully: if one agent's ccusage call fails (not installed, no
/// data, malformed output) it is reported in `warnings` instead of failing the
/// whole request, so the home page can still render whatever is available.
pub async fn summary(
	bin: &OsStr,
	since: Option<String>,
	until: Option<String>,
	timezone: Option<String>,
) -> UsageReportDto {
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
		ccusage_version(bin),
		fetch_claude_usage(bin, build_args("claude")),
		fetch_codex_usage(bin, build_args("codex")),
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

	UsageReportDto {
		agents,
		generated_at: chrono::Utc::now().to_rfc3339(),
		ccusage_version: version,
		warnings,
	}
}

// ---- remaining-quota (limits) ----------------------------------------------
//
// Local credential stores hold the OAuth token each agent already uses; we
// reuse it to call the vendor's private usage endpoint. No new login flow.

fn home_dir() -> Result<PathBuf, String> {
	dirs::home_dir().ok_or_else(|| "cannot resolve home directory".to_string())
}

/// Parse Claude Code's credential JSON (keychain blob or file) into the access
/// token. Extracted from [`claude_access_token`] so the vendor key names can be
/// pinned by a unit test without a keychain or the filesystem.
fn parse_claude_credentials(json: &str) -> Result<String, String> {
	#[derive(Deserialize)]
	struct CredFile {
		#[serde(rename = "claudeAiOauth")]
		oauth: OauthBlock,
	}
	#[derive(Deserialize)]
	struct OauthBlock {
		#[serde(rename = "accessToken")]
		access_token: String,
	}
	serde_json::from_str::<CredFile>(json)
		.map(|c| c.oauth.access_token)
		.map_err(|e| format!("parse claude credentials: {e}"))
}

/// Claude Code's OAuth access token. macOS keeps it in the login keychain
/// (service `Claude Code-credentials`); other platforms use the JSON file.
fn claude_access_token() -> Result<String, String> {
	// macOS: try the keychain first, but treat *any* miss as "fall through to
	// the file" — keychain item absent, ACL-protected for another binary, or
	// `USER` unset. GUI launches can have a stripped environment (the app
	// already ships `fix-path-env` for the same reason), so a hard failure here
	// would skip the documented `~/.claude/.credentials.json` fallback.
	#[cfg(target_os = "macos")]
	if let Some(token) = macos_keychain_token() {
		return Ok(token);
	}

	let path = home_dir()?.join(".claude/.credentials.json");
	let json = std::fs::read_to_string(&path)
		.map_err(|e| format!("read claude credentials: {e}"))?;
	parse_claude_credentials(&json)
}

/// Best-effort read of Claude Code's token from the macOS login keychain.
/// Returns `None` on any failure so the caller falls back to the file.
#[cfg(target_os = "macos")]
fn macos_keychain_token() -> Option<String> {
	let user = std::env::var("USER").ok()?;
	let entry = keyring::Entry::new("Claude Code-credentials", &user).ok()?;
	let json = entry.get_password().ok()?;
	parse_claude_credentials(&json).ok()
}

/// Parse Codex's `auth.json` into (access token, optional ChatGPT account id).
/// Extracted from [`codex_auth`] so the token / account-id key names can be
/// pinned by a unit test without touching the filesystem.
fn parse_codex_auth(json: &str) -> Result<(String, Option<String>), String> {
	#[derive(Deserialize)]
	struct AuthFile {
		tokens: Tokens,
	}
	#[derive(Deserialize)]
	struct Tokens {
		access_token: String,
		#[serde(default)]
		account_id: Option<String>,
	}
	serde_json::from_str::<AuthFile>(json)
		.map(|a| (a.tokens.access_token, a.tokens.account_id))
		.map_err(|e| format!("parse codex auth: {e}"))
}

/// Codex's OAuth token plus the ChatGPT account id its usage endpoint needs.
fn codex_auth() -> Result<(String, Option<String>), String> {
	let path = home_dir()?.join(".codex/auth.json");
	let json = std::fs::read_to_string(&path)
		.map_err(|e| format!("read codex auth: {e}"))?;
	parse_codex_auth(&json)
}

// ---- Anthropic `GET /api/oauth/usage` shape --------------------------------

#[derive(Deserialize)]
struct ClaudeOauthUsage {
	#[serde(default)]
	five_hour: Option<ClaudeWindow>,
	#[serde(default)]
	seven_day: Option<ClaudeWindow>,
	#[serde(default)]
	seven_day_opus: Option<ClaudeWindow>,
	#[serde(default)]
	seven_day_sonnet: Option<ClaudeWindow>,
}

#[derive(Deserialize)]
struct ClaudeWindow {
	utilization: f64,
	#[serde(default)]
	resets_at: Option<String>,
}

async fn fetch_claude_limits() -> Result<AgentLimitsDto, String> {
	let token = claude_access_token()?;
	let client = reqwest::Client::builder()
		.timeout(LIMITS_TIMEOUT)
		.build()
		.map_err(|e| e.to_string())?;
	let resp = client
		.get("https://api.anthropic.com/api/oauth/usage")
		.bearer_auth(token)
		.header("anthropic-beta", "oauth-2025-04-20")
		.send()
		.await
		.map_err(|e| format!("claude usage request: {e}"))?;
	if !resp.status().is_success() {
		return Err(format!(
			"claude usage endpoint returned {}",
			resp.status()
		));
	}
	let usage: ClaudeOauthUsage = resp
		.json()
		.await
		.map_err(|e| format!("parse claude usage: {e}"))?;

	let windows = claude_windows(usage);
	if windows.is_empty() {
		// Mirror the Codex path: a 200 with no recognizable windows (logged out,
		// endpoint shape drift) is a degraded warning, not a silent empty agent.
		return Err(
			"claude usage response had no recognizable rate-limit windows"
				.to_string(),
		);
	}

	Ok(AgentLimitsDto {
		agent: UsageAgent::Claude,
		windows,
	})
}

/// Map the Anthropic usage response into the unified windows. Pulled out of
/// [`fetch_claude_limits`] so the scale handling is unit-testable.
fn claude_windows(usage: ClaudeOauthUsage) -> Vec<LimitWindowDto> {
	[
		(LimitWindowKind::FiveHour, usage.five_hour),
		(LimitWindowKind::Weekly, usage.seven_day),
		(LimitWindowKind::WeeklyOpus, usage.seven_day_opus),
		(LimitWindowKind::WeeklySonnet, usage.seven_day_sonnet),
	]
	.into_iter()
	.filter_map(|(kind, w)| {
		w.map(|w| LimitWindowDto {
			kind,
			// Anthropic's /api/oauth/usage reports `utilization` already as a
			// 0-100 percent (confirmed against a live response), matching the
			// DTO contract; clamp defensively in case it ever returns otherwise.
			utilization_pct: w.utilization.clamp(0.0, 100.0),
			resets_at: w.resets_at,
		})
	})
	.collect()
}

/// Codex's usage shape is undocumented and field names vary across versions, so
/// we extract defensively: `used_percent` directly, or `percent_left` inverted;
/// reset as an ISO string, or seconds-from-now, or epoch millis.
fn codex_window(
	value: &serde_json::Value,
	kind: LimitWindowKind,
) -> Option<LimitWindowDto> {
	let obj = value.as_object()?;
	let utilization_pct = obj
		.get("used_percent")
		.and_then(serde_json::Value::as_f64)
		.or_else(|| {
			obj.get("percent_left")
				.and_then(serde_json::Value::as_f64)
				.map(|left| 100.0 - left)
		})?
		// The Codex shape is undocumented; keep utilization within the 0-100
		// the DTO promises rather than emitting an out-of-range value.
		.clamp(0.0, 100.0);
	let resets_at = obj
		.get("resets_at")
		.and_then(serde_json::Value::as_str)
		.map(str::to_string)
		.or_else(|| {
			obj.get("resets_in_seconds")
				.and_then(serde_json::Value::as_i64)
				.map(|secs| {
					(chrono::Utc::now() + chrono::Duration::seconds(secs))
						.to_rfc3339()
				})
		})
		.or_else(|| {
			obj.get("reset_time_ms")
				.and_then(serde_json::Value::as_i64)
				.and_then(chrono::DateTime::from_timestamp_millis)
				.map(|dt| dt.to_rfc3339())
		});
	Some(LimitWindowDto {
		kind,
		utilization_pct,
		resets_at,
	})
}

async fn fetch_codex_limits() -> Result<AgentLimitsDto, String> {
	let (token, account_id) = codex_auth()?;
	let client = reqwest::Client::builder()
		.timeout(LIMITS_TIMEOUT)
		.build()
		.map_err(|e| e.to_string())?;
	let mut req = client
		.get("https://chatgpt.com/backend-api/wham/usage")
		.bearer_auth(token);
	if let Some(id) = account_id {
		req = req.header("ChatGPT-Account-Id", id);
	}
	let resp = req
		.send()
		.await
		.map_err(|e| format!("codex usage request: {e}"))?;
	if !resp.status().is_success() {
		return Err(format!("codex usage endpoint returned {}", resp.status()));
	}
	let body: serde_json::Value = resp
		.json()
		.await
		.map_err(|e| format!("parse codex usage: {e}"))?;

	// Codex exposes a `primary` (5h) and `secondary` (weekly) window, possibly
	// nested under `rate_limits`.
	let root = body.get("rate_limits").unwrap_or(&body);
	let windows: Vec<LimitWindowDto> = [
		("primary", LimitWindowKind::FiveHour),
		("secondary", LimitWindowKind::Weekly),
	]
	.into_iter()
	.filter_map(|(key, kind)| root.get(key).and_then(|v| codex_window(v, kind)))
	.collect();
	if windows.is_empty() {
		return Err(
			"codex usage response had no recognizable rate-limit windows"
				.to_string(),
		);
	}

	Ok(AgentLimitsDto {
		agent: UsageAgent::Codex,
		windows,
	})
}

/// Remaining rate-limit quota for Claude and Codex.
///
/// Degrades like [`summary`]: a not-logged-in or failing agent becomes a
/// `warnings` entry instead of failing the whole request.
pub async fn limits() -> UsageLimitsReportDto {
	let (claude_res, codex_res) =
		tokio::join!(fetch_claude_limits(), fetch_codex_limits());

	let mut agents = Vec::new();
	let mut warnings = Vec::new();
	match claude_res {
		Ok(agent) => agents.push(agent),
		Err(e) => warnings.push(format!("claude limits unavailable: {e}")),
	}
	match codex_res {
		Ok(agent) => agents.push(agent),
		Err(e) => warnings.push(format!("codex limits unavailable: {e}")),
	}

	UsageLimitsReportDto {
		agents,
		generated_at: chrono::Utc::now().to_rfc3339(),
		warnings,
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::json;

	#[test]
	fn codex_window_reads_used_percent() {
		let w = codex_window(
			&json!({ "used_percent": 42.5 }),
			LimitWindowKind::FiveHour,
		)
		.unwrap();
		assert_eq!(w.kind, LimitWindowKind::FiveHour);
		assert_eq!(w.utilization_pct, 42.5);
		assert_eq!(w.resets_at, None);
	}

	#[test]
	fn codex_window_inverts_percent_left() {
		let w = codex_window(
			&json!({ "percent_left": 30.0 }),
			LimitWindowKind::Weekly,
		)
		.unwrap();
		assert_eq!(w.utilization_pct, 70.0);
	}

	#[test]
	fn codex_window_resolves_resets_in_seconds() {
		let w = codex_window(
			&json!({ "used_percent": 10.0, "resets_in_seconds": 3600 }),
			LimitWindowKind::FiveHour,
		)
		.unwrap();
		assert!(w.resets_at.is_some());
	}

	#[test]
	fn codex_window_none_without_utilization() {
		assert!(
			codex_window(&json!({ "foo": 1 }), LimitWindowKind::FiveHour)
				.is_none()
		);
		assert!(codex_window(
			&json!("not an object"),
			LimitWindowKind::FiveHour
		)
		.is_none());
	}

	#[test]
	fn claude_normalization_zeroes_reasoning_and_sums_model_tokens() {
		let report = CcClaudeReport {
			daily: vec![CcClaudeDay {
				date: "2026-06-01".to_string(),
				input_tokens: 100,
				output_tokens: 50,
				cache_creation_tokens: 5,
				cache_read_tokens: 3,
				total_tokens: 158,
				total_cost: Some(1.25),
				model_breakdowns: vec![CcClaudeModel {
					model_name: "claude-opus-4".to_string(),
					input_tokens: 100,
					output_tokens: 50,
					cache_creation_tokens: 5,
					cache_read_tokens: 3,
					cost: Some(1.25),
				}],
			}],
			totals: CcClaudeTotals {
				input_tokens: 100,
				output_tokens: 50,
				cache_creation_tokens: 5,
				cache_read_tokens: 3,
				total_tokens: 158,
				total_cost: Some(1.25),
			},
		};
		let agent = claude_to_agent(report);
		assert_eq!(agent.agent, UsageAgent::Claude);
		assert_eq!(agent.totals.reasoning_tokens, 0);
		let model = &agent.days[0].models[0];
		assert_eq!(model.total_tokens, 158);
		assert_eq!(model.cost_usd, Some(1.25));
	}

	#[test]
	fn codex_normalization_maps_cached_input_and_drops_model_cost() {
		let mut models = HashMap::new();
		models.insert(
			"gpt-5".to_string(),
			CcCodexModel {
				input_tokens: 200,
				cached_input_tokens: 40,
				output_tokens: 80,
				reasoning_output_tokens: 20,
				total_tokens: 340,
			},
		);
		let report = CcCodexReport {
			daily: vec![CcCodexDay {
				date: "2026-06-01".to_string(),
				input_tokens: 200,
				cached_input_tokens: 40,
				output_tokens: 80,
				reasoning_output_tokens: 20,
				total_tokens: 340,
				cost_usd: Some(0.5),
				models,
			}],
			totals: CcCodexTotals {
				input_tokens: 200,
				cached_input_tokens: 40,
				output_tokens: 80,
				reasoning_output_tokens: 20,
				total_tokens: 340,
				cost_usd: Some(0.5),
			},
		};
		let agent = codex_to_agent(report);
		assert_eq!(agent.agent, UsageAgent::Codex);
		assert_eq!(agent.totals.cache_creation_tokens, 0);
		assert_eq!(agent.totals.cache_read_tokens, 40);
		assert_eq!(agent.days[0].models[0].cost_usd, None);
	}

	#[test]
	fn claude_tolerates_null_cost() {
		// ccusage emits null cost for models it can't price; the whole report
		// must survive instead of failing deserialization and dropping the agent.
		let raw = json!({
			"daily": [{
				"date": "2026-06-01",
				"inputTokens": 100,
				"outputTokens": 50,
				"cacheCreationTokens": 0,
				"cacheReadTokens": 0,
				"totalTokens": 150,
				"totalCost": null,
				"modelBreakdowns": [{
					"modelName": "claude-future",
					"inputTokens": 100,
					"outputTokens": 50,
					"cacheCreationTokens": 0,
					"cacheReadTokens": 0,
					"cost": null
				}]
			}],
			"totals": {
				"inputTokens": 100,
				"outputTokens": 50,
				"cacheCreationTokens": 0,
				"cacheReadTokens": 0,
				"totalTokens": 150,
				"totalCost": null
			}
		});
		let report: CcClaudeReport = serde_json::from_value(raw).unwrap();
		let agent = claude_to_agent(report);
		assert_eq!(agent.days[0].cost_usd, None);
		assert_eq!(agent.days[0].models[0].cost_usd, None);
		assert_eq!(agent.totals.cost_usd, None);
	}

	#[test]
	fn parse_claude_credentials_reads_renamed_keys() {
		let json = r#"{"claudeAiOauth":{"accessToken":"sk-tok"}}"#;
		assert_eq!(parse_claude_credentials(json).unwrap(), "sk-tok");
		assert!(parse_claude_credentials(r#"{"other":1}"#).is_err());
	}

	#[test]
	fn parse_codex_auth_reads_token_and_optional_account_id() {
		let with_id =
			r#"{"tokens":{"access_token":"at","account_id":"acc-1"}}"#;
		assert_eq!(
			parse_codex_auth(with_id).unwrap(),
			("at".to_string(), Some("acc-1".to_string()))
		);
		let without_id = r#"{"tokens":{"access_token":"at"}}"#;
		assert_eq!(
			parse_codex_auth(without_id).unwrap(),
			("at".to_string(), None)
		);
		assert!(parse_codex_auth(r#"{"tokens":{}}"#).is_err());
	}

	#[test]
	fn resolve_ccusage_bin_prefers_explicit_path() {
		let explicit = PathBuf::from("/opt/ccusage");
		assert_eq!(
			resolve_ccusage_bin(Some(explicit.clone())),
			explicit.into_os_string()
		);
	}

	#[test]
	fn resolve_ccusage_bin_falls_back_to_env_then_default() {
		// No other test in this crate touches AGHUB_CCUSAGE_BIN, so mutating it
		// here is race-free.
		std::env::remove_var("AGHUB_CCUSAGE_BIN");
		assert_eq!(resolve_ccusage_bin(None), OsString::from("ccusage"));
		std::env::set_var("AGHUB_CCUSAGE_BIN", "/from/env");
		assert_eq!(resolve_ccusage_bin(None), OsString::from("/from/env"));
		std::env::remove_var("AGHUB_CCUSAGE_BIN");
	}

	#[test]
	fn claude_windows_maps_and_clamps() {
		let usage = ClaudeOauthUsage {
			five_hour: Some(ClaudeWindow {
				utilization: 42.0,
				resets_at: Some("2026-06-09T12:00:00+00:00".to_string()),
			}),
			seven_day: Some(ClaudeWindow {
				utilization: 150.0,
				resets_at: None,
			}),
			seven_day_opus: None,
			seven_day_sonnet: None,
		};
		let windows = claude_windows(usage);
		assert_eq!(windows.len(), 2);
		assert_eq!(windows[0].kind, LimitWindowKind::FiveHour);
		assert_eq!(windows[0].utilization_pct, 42.0);
		// out-of-range utilization is clamped to the documented 0-100
		assert_eq!(windows[1].kind, LimitWindowKind::Weekly);
		assert_eq!(windows[1].utilization_pct, 100.0);
	}

	#[test]
	fn claude_windows_empty_when_all_absent() {
		let usage = ClaudeOauthUsage {
			five_hour: None,
			seven_day: None,
			seven_day_opus: None,
			seven_day_sonnet: None,
		};
		assert!(claude_windows(usage).is_empty());
	}

	#[test]
	fn codex_window_clamps_out_of_range() {
		// percent_left below 0 inverts to > 100; clamp keeps the contract.
		let w = codex_window(
			&json!({ "percent_left": -20.0 }),
			LimitWindowKind::FiveHour,
		)
		.unwrap();
		assert_eq!(w.utilization_pct, 100.0);
		let w = codex_window(
			&json!({ "used_percent": 250.0 }),
			LimitWindowKind::FiveHour,
		)
		.unwrap();
		assert_eq!(w.utilization_pct, 100.0);
	}

	#[test]
	fn codex_window_resolves_resets_at_string_and_epoch_ms() {
		let w = codex_window(
			&json!({ "used_percent": 1.0, "resets_at": "2026-06-09T12:00:00+00:00" }),
			LimitWindowKind::Weekly,
		)
		.unwrap();
		assert_eq!(w.resets_at.as_deref(), Some("2026-06-09T12:00:00+00:00"));

		let w = codex_window(
			&json!({ "used_percent": 1.0, "reset_time_ms": 1_780_000_000_000i64 }),
			LimitWindowKind::FiveHour,
		)
		.unwrap();
		assert!(w.resets_at.is_some());
	}

	#[test]
	fn codex_models_sorted_by_name() {
		let mut models = HashMap::new();
		for name in ["zeta", "alpha", "mid"] {
			models.insert(
				name.to_string(),
				CcCodexModel {
					input_tokens: 1,
					cached_input_tokens: 0,
					output_tokens: 1,
					reasoning_output_tokens: 0,
					total_tokens: 2,
				},
			);
		}
		let report = CcCodexReport {
			daily: vec![CcCodexDay {
				date: "2026-06-01".to_string(),
				input_tokens: 3,
				cached_input_tokens: 0,
				output_tokens: 3,
				reasoning_output_tokens: 0,
				total_tokens: 6,
				cost_usd: None,
				models,
			}],
			totals: CcCodexTotals {
				input_tokens: 3,
				cached_input_tokens: 0,
				output_tokens: 3,
				reasoning_output_tokens: 0,
				total_tokens: 6,
				cost_usd: None,
			},
		};
		let agent = codex_to_agent(report);
		let names: Vec<&str> = agent.days[0]
			.models
			.iter()
			.map(|m| m.model.as_str())
			.collect();
		assert_eq!(names, ["alpha", "mid", "zeta"]);
	}
}
