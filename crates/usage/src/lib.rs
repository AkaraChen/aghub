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
//! this crate adapts its specialized Claude and Codex reports plus the shared
//! report shape used by the other known agents.

mod dto;
pub use dto::*;
pub mod runtime;

use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::future::Future;
use std::path::PathBuf;
use std::time::Duration;

use futures::stream::{self, StreamExt};
use serde::{Deserialize, Deserializer};

/// Default ccusage spawn timeout, in seconds; overridable per [`UsageQuery`].
pub const DEFAULT_TIMEOUT_SECS: u64 = 30;
/// Upper bound accepted for a ccusage summary request.
pub const MAX_TIMEOUT_SECS: u64 = 60 * 60;
const CCUSAGE_TIMEOUT: Duration = Duration::from_secs(DEFAULT_TIMEOUT_SECS);
/// Short cap for the `--version` probe (it runs beside the data fetches).
const VERSION_TIMEOUT: Duration = Duration::from_secs(10);
const LIMITS_TIMEOUT: Duration = Duration::from_secs(15);
// Daily JSON is normally well below 8 MiB. These caps and the fan-out limit
// keep usage probes under a known memory bound while retaining failure output.
const MAX_CCUSAGE_STDOUT_BYTES: usize = 8 * 1024 * 1024;
const MAX_CCUSAGE_STDERR_BYTES: usize = 64 * 1024;
const MAX_CONCURRENT_AGENT_PROBES: usize = 4;

/// Options for a ccusage `daily` query. [`Default`] reproduces the previous
/// hard-coded behaviour: cached offline pricing, no config override, 30s timeout.
#[derive(Debug, Clone)]
pub struct UsageQuery {
	pub since: Option<String>,
	pub until: Option<String>,
	pub timezone: Option<String>,
	/// Canonical aghub agent ids to probe. `None` probes every known source;
	/// an empty list probes none.
	pub agents: Option<Vec<String>>,
	/// `true` uses ccusage's cached pricing (`--offline`); `false` fetches live
	/// pricing (`--no-offline`).
	pub offline: bool,
	/// Optional ccusage config file, passed as `--config`.
	pub config: Option<PathBuf>,
	/// Total summary deadline and per-process upper bound.
	pub timeout: Duration,
	/// Extra ccusage arguments supplied as individual values.
	pub extra_args: Vec<String>,
}

impl Default for UsageQuery {
	fn default() -> Self {
		Self {
			since: None,
			until: None,
			timezone: None,
			agents: None,
			offline: true,
			config: None,
			timeout: CCUSAGE_TIMEOUT,
			extra_args: Vec::new(),
		}
	}
}

/// The ccusage command id and aghub agent id for each usage source. The two ids
/// differ where ccusage still uses a product's former CLI name.
const KNOWN_USAGE_AGENTS: &[(&str, &str)] = &[
	("claude", "claude"),
	("codex", "codex"),
	("opencode", "opencode"),
	("amp", "amp"),
	("droid", "factory"),
	("codebuff", "codebuff"),
	("hermes", "hermes"),
	("pi", "pi"),
	("goose", "goose"),
	("kilo", "kilocode"),
	("copilot", "copilot"),
	("gemini", "gemini"),
	("kimi", "kimi"),
	("qwen", "qwen"),
	("openclaw", "openclaw"),
];

pub fn known_usage_agents() -> Vec<UsageAgent> {
	KNOWN_USAGE_AGENTS
		.iter()
		.map(|(_, agent_id)| UsageAgent::new(*agent_id))
		.collect()
}

pub fn is_known_usage_agent(id: &str) -> bool {
	KNOWN_USAGE_AGENTS
		.iter()
		.any(|(_, agent_id)| *agent_id == id)
}

fn selected_usage_agents(
	selected: Option<&[String]>,
) -> impl Iterator<Item = (&'static str, &'static str)> + '_ {
	KNOWN_USAGE_AGENTS
		.iter()
		.copied()
		.filter(move |(_, agent_id)| {
			selected
				.map(|ids| ids.iter().any(|id| id == agent_id))
				.unwrap_or(true)
		})
}

/// Locate the ccusage binary. Preference order: an explicit path injected by the
/// caller, then the `AGHUB_CCUSAGE_BIN` environment variable, then `ccusage` on
/// `PATH`.
pub fn resolve_ccusage_bin(explicit: Option<PathBuf>) -> OsString {
	resolve_ccusage_bin_with_environment(
		explicit,
		std::env::var_os("AGHUB_CCUSAGE_BIN"),
	)
}

fn resolve_ccusage_bin_with_environment(
	explicit: Option<PathBuf>,
	environment: Option<OsString>,
) -> OsString {
	explicit
		.map(PathBuf::into_os_string)
		.or(environment)
		.unwrap_or_else(|| OsString::from("ccusage"))
}

async fn run_ccusage(
	bin: &OsStr,
	args: Vec<String>,
	timeout: Duration,
) -> Result<Vec<u8>, String> {
	run_ccusage_with_limits(
		bin,
		args,
		timeout,
		MAX_CCUSAGE_STDOUT_BYTES,
		MAX_CCUSAGE_STDERR_BYTES,
	)
	.await
}

async fn run_ccusage_with_limits(
	bin: &OsStr,
	args: Vec<String>,
	timeout: Duration,
	stdout_limit: usize,
	stderr_limit: usize,
) -> Result<Vec<u8>, String> {
	let mut cmd = tokio::process::Command::new(bin);
	cmd.args(&args);
	let output = match runtime::process::run_bounded(
		&mut cmd,
		timeout,
		stdout_limit,
		stderr_limit,
	)
	.await
	{
		Ok(output) => output,
		Err(runtime::process::BoundedProcessError::Spawn(error)) => {
			return Err(format!("failed to spawn ccusage: {error}"));
		}
		Err(runtime::process::BoundedProcessError::Read(error)) => {
			return Err(format!("failed to read ccusage: {error}"));
		}
		Err(runtime::process::BoundedProcessError::TimedOut) => {
			return Err(format!(
				"ccusage timed out after {}s",
				timeout.as_secs()
			));
		}
	};
	if output.stdout.truncated {
		return Err(format!("ccusage output exceeded {stdout_limit} bytes"));
	}
	if !output.status.success() {
		let suffix = output.stderr.truncated.then_some(" (truncated)");
		return Err(format!(
			"ccusage exited with {}: {}{}",
			output.status,
			String::from_utf8_lossy(&output.stderr.bytes),
			suffix.unwrap_or_default(),
		));
	}
	Ok(output.stdout.bytes)
}

/// `ccusage --version` → e.g. "ccusage 20.0.6"; "unknown" if it can't be read.
async fn ccusage_version(bin: &OsStr) -> String {
	run_ccusage(bin, vec!["--version".to_string()], VERSION_TIMEOUT)
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
	// ccusage renamed codex's `cachedInputTokens` -> `cacheReadTokens` (+ added
	// `cacheCreationTokens`) after the pinned 20.0.6 sidecar; the alias + default
	// keep both that and a newer global ccusage parsing.
	#[serde(alias = "cachedInputTokens")]
	cache_read_tokens: u64,
	#[serde(default)]
	cache_creation_tokens: u64,
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
	#[serde(alias = "cachedInputTokens")]
	cache_read_tokens: u64,
	#[serde(default)]
	cache_creation_tokens: u64,
	output_tokens: u64,
	reasoning_output_tokens: u64,
	total_tokens: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CcCodexTotals {
	input_tokens: u64,
	#[serde(alias = "cachedInputTokens")]
	cache_read_tokens: u64,
	#[serde(default)]
	cache_creation_tokens: u64,
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
//   * Codex's cache-read tokens come from `cacheReadTokens` (older ccusage:
//     `cachedInputTokens`); `cacheCreationTokens` is 0 on older output.
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
		agent: UsageAgent::new("claude"),
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
			cache_creation_tokens: d.cache_creation_tokens,
			cache_read_tokens: d.cache_read_tokens,
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
						cache_creation_tokens: m.cache_creation_tokens,
						cache_read_tokens: m.cache_read_tokens,
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
		agent: UsageAgent::new("codex"),
		days,
		totals: UsageTotalsDto {
			input_tokens: report.totals.input_tokens,
			output_tokens: report.totals.output_tokens,
			cache_creation_tokens: report.totals.cache_creation_tokens,
			cache_read_tokens: report.totals.cache_read_tokens,
			reasoning_tokens: report.totals.reasoning_output_tokens,
			total_tokens: report.totals.total_tokens,
			cost_usd: report.totals.cost_usd,
		},
	}
}

// ---- generic agent shape (opencode, gemini, kimi, …) -----------------------
//
// Most ccusage agents share Claude's summary fields. Some add metadata such as
// credits/messageCount or omit model breakdowns. This tolerant struct parses
// the common token/cost contract; an incompatible report becomes a warning,
// and an agent with no data is skipped.

#[derive(Deserialize)]
struct CcAgentReport {
	daily: Vec<CcAgentDay>,
	// ccusage uses null for known no-data sources; omitting the key is drift.
	#[serde(deserialize_with = "deserialize_agent_totals")]
	totals: Option<CcAgentTotals>,
}

fn deserialize_agent_totals<'de, D>(
	deserializer: D,
) -> Result<Option<CcAgentTotals>, D::Error>
where
	D: Deserializer<'de>,
{
	Option::deserialize(deserializer)
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CcAgentTotals {
	input_tokens: u64,
	output_tokens: u64,
	cache_creation_tokens: u64,
	#[serde(alias = "cachedInputTokens")]
	cache_read_tokens: u64,
	#[serde(default)]
	reasoning_output_tokens: u64,
	total_tokens: u64,
	#[serde(default, alias = "costUSD")]
	total_cost: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CcAgentDay {
	date: String,
	input_tokens: u64,
	output_tokens: u64,
	cache_creation_tokens: u64,
	#[serde(alias = "cachedInputTokens")]
	cache_read_tokens: u64,
	#[serde(default)]
	reasoning_output_tokens: u64,
	total_tokens: u64,
	#[serde(default, alias = "costUSD")]
	total_cost: Option<f64>,
	#[serde(default)]
	model_breakdowns: Vec<CcAgentModel>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CcAgentModel {
	model_name: String,
	input_tokens: u64,
	output_tokens: u64,
	cache_creation_tokens: u64,
	#[serde(alias = "cachedInputTokens")]
	cache_read_tokens: u64,
	#[serde(default)]
	reasoning_output_tokens: u64,
	#[serde(default)]
	total_tokens: u64,
	#[serde(default)]
	cost: Option<f64>,
}

fn generic_to_agent(id: &str, report: CcAgentReport) -> AgentUsageDto {
	let days = report
		.daily
		.into_iter()
		.map(|d| UsageDayDto {
			date: d.date,
			input_tokens: d.input_tokens,
			output_tokens: d.output_tokens,
			cache_creation_tokens: d.cache_creation_tokens,
			cache_read_tokens: d.cache_read_tokens,
			reasoning_tokens: d.reasoning_output_tokens,
			total_tokens: d.total_tokens,
			cost_usd: d.total_cost,
			models: d
				.model_breakdowns
				.into_iter()
				.map(|m| UsageModelDto {
					total_tokens: if m.total_tokens > 0 {
						m.total_tokens
					} else {
						m.input_tokens
							+ m.output_tokens + m.cache_creation_tokens
							+ m.cache_read_tokens
					},
					model: m.model_name,
					input_tokens: m.input_tokens,
					output_tokens: m.output_tokens,
					cache_creation_tokens: m.cache_creation_tokens,
					cache_read_tokens: m.cache_read_tokens,
					reasoning_tokens: m.reasoning_output_tokens,
					cost_usd: m.cost,
				})
				.collect(),
		})
		.collect();
	let totals = report.totals.unwrap_or_default();
	AgentUsageDto {
		agent: UsageAgent::new(id),
		days,
		totals: UsageTotalsDto {
			input_tokens: totals.input_tokens,
			output_tokens: totals.output_tokens,
			cache_creation_tokens: totals.cache_creation_tokens,
			cache_read_tokens: totals.cache_read_tokens,
			reasoning_tokens: totals.reasoning_output_tokens,
			total_tokens: totals.total_tokens,
			cost_usd: totals.total_cost,
		},
	}
}

/// Fetch + normalize one agent's daily usage. `Ok(None)` = ccusage ran but the
/// agent has no data (skip it); `Err` = the call or parse failed (a warning).
async fn fetch_agent_usage(
	bin: &OsStr,
	ccusage_id: &str,
	agent_id: &str,
	args: Vec<String>,
	timeout: Duration,
) -> Result<Option<AgentUsageDto>, String> {
	let raw = run_ccusage(bin, args, timeout).await?;
	let agent = match ccusage_id {
		"claude" => {
			let r: CcClaudeReport = serde_json::from_slice(&raw)
				.map_err(|e| format!("parse claude usage json: {e}"))?;
			claude_to_agent(r)
		}
		"codex" => {
			let r: CcCodexReport = serde_json::from_slice(&raw)
				.map_err(|e| format!("parse codex usage json: {e}"))?;
			codex_to_agent(r)
		}
		_ => {
			let r: CcAgentReport = serde_json::from_slice(&raw)
				.map_err(|e| format!("parse {ccusage_id} usage json: {e}"))?;
			generic_to_agent(agent_id, r)
		}
	};
	Ok((agent.totals.total_tokens > 0).then_some(agent))
}

/// Build the ccusage argv for one agent's `daily` report from a [`UsageQuery`].
fn build_ccusage_args(agent: &str, query: &UsageQuery) -> Vec<String> {
	let mut args = vec![
		agent.to_string(),
		"daily".to_string(),
		"--json".to_string(),
		if query.offline {
			"--offline"
		} else {
			"--no-offline"
		}
		.to_string(),
	];
	if let Some(cfg) = &query.config {
		args.push("--config".to_string());
		args.push(cfg.to_string_lossy().into_owned());
	}
	if let Some(s) = &query.since {
		args.push("--since".to_string());
		args.push(s.clone());
	}
	if let Some(u) = &query.until {
		args.push("--until".to_string());
		args.push(u.clone());
	}
	if let Some(tz) = &query.timezone {
		args.push("--timezone".to_string());
		args.push(tz.clone());
	}
	args.extend(query.extra_args.iter().cloned());
	args
}

/// Daily token/cost usage across every ccusage agent that has local data.
///
/// Probes [`KNOWN_USAGE_AGENTS`] concurrently. Degrades gracefully: an agent
/// that isn't installed or whose output is malformed lands in `warnings`; one
/// with no data is skipped; neither fails the whole request, so the page still
/// renders whatever is available.
pub async fn summary(bin: &OsStr, query: &UsageQuery) -> UsageReportDto {
	let (version, (results, timed_out)) =
		tokio::join!(ccusage_version(bin), probe_agent_usage(bin, query),);
	usage_report(version, results, timed_out, query.timeout)
}

/// Build a summary when the caller has already probed the active runtime.
pub async fn summary_with_version(
	bin: &OsStr,
	query: &UsageQuery,
	version: &str,
) -> UsageReportDto {
	let (results, timed_out) = probe_agent_usage(bin, query).await;
	usage_report(version.to_string(), results, timed_out, query.timeout)
}

async fn probe_agent_usage<'a>(
	bin: &'a OsStr,
	query: &'a UsageQuery,
) -> (Vec<(String, Result<Option<AgentUsageDto>, String>)>, bool) {
	let mut probes = Vec::with_capacity(KNOWN_USAGE_AGENTS.len());
	for (index, (ccusage_id, agent_id)) in
		selected_usage_agents(query.agents.as_deref()).enumerate()
	{
		let ccusage_id = ccusage_id.to_string();
		let agent_id = agent_id.to_string();
		probes.push(async move {
			let args = build_ccusage_args(&ccusage_id, query);
			let result = fetch_agent_usage(
				bin,
				&ccusage_id,
				&agent_id,
				args,
				query.timeout,
			)
			.await;
			(index, (agent_id, result))
		});
	}
	collect_agent_probes(probes, query.timeout).await
}

async fn collect_agent_probes<I, F, T>(
	probes: I,
	timeout: Duration,
) -> (Vec<T>, bool)
where
	I: IntoIterator<Item = F>,
	F: Future<Output = (usize, T)>,
{
	let deadline = tokio::time::Instant::now() + timeout;
	let mut pending =
		stream::iter(probes).buffer_unordered(MAX_CONCURRENT_AGENT_PROBES);
	let mut completed = Vec::new();
	loop {
		match tokio::time::timeout_at(deadline, pending.next()).await {
			Ok(Some(result)) => completed.push(result),
			Ok(None) => break,
			Err(_) => {
				completed.sort_unstable_by_key(|(index, _)| *index);
				return (
					completed.into_iter().map(|(_, result)| result).collect(),
					true,
				);
			}
		}
	}
	completed.sort_unstable_by_key(|(index, _)| *index);
	(
		completed.into_iter().map(|(_, result)| result).collect(),
		false,
	)
}

fn usage_report(
	version: String,
	results: Vec<(String, Result<Option<AgentUsageDto>, String>)>,
	timed_out: bool,
	timeout: Duration,
) -> UsageReportDto {
	let mut agents = Vec::new();
	let mut warnings = Vec::new();
	for (id, res) in results {
		match res {
			Ok(Some(agent)) => agents.push(agent),
			Ok(None) => {}
			Err(e) => warnings.push(format!("{id} usage unavailable: {e}")),
		}
	}
	if timed_out {
		warnings.push(format!(
			"ccusage agent probes timed out after {}s",
			timeout.as_secs()
		));
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
		#[serde(default)]
		tokens: Option<Tokens>,
	}
	#[derive(Deserialize)]
	struct Tokens {
		access_token: String,
		#[serde(default)]
		account_id: Option<String>,
	}
	let auth: AuthFile = serde_json::from_str(json)
		.map_err(|e| format!("parse codex auth: {e}"))?;
	let tokens = auth.tokens.ok_or_else(|| {
		"codex is not logged in via ChatGPT (no rate-limit data for API-key logins)"
			.to_string()
	})?;
	Ok((tokens.access_token, tokens.account_id))
}

/// Codex's OAuth token plus the ChatGPT account id its usage endpoint needs.
/// Codex's config/auth root: `CODEX_HOME` if set, else `~/.codex`. Matches how
/// the rest of the repo resolves Codex paths (`crates/inference/src/codex`), so
/// a non-default `CODEX_HOME` doesn't make `limits` miss the auth file.
fn codex_home() -> Result<PathBuf, String> {
	if let Some(dir) = std::env::var_os("CODEX_HOME") {
		return Ok(PathBuf::from(dir));
	}
	Ok(home_dir()?.join(".codex"))
}

fn codex_auth() -> Result<(String, Option<String>), String> {
	let path = codex_home()?.join("auth.json");
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
		agent: UsageAgent::new("claude"),
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
		w.map(|w| {
			if !(0.0..=100.0).contains(&w.utilization) {
				log::warn!(
					"claude usage returned out-of-range utilization: {}",
					w.utilization
				);
			}
			LimitWindowDto {
				kind,
				utilization_pct: w.utilization.clamp(0.0, 100.0),
				resets_at: w.resets_at,
			}
		})
	})
	.collect()
}

/// Codex's usage shape is undocumented and field names vary across versions, so
/// we extract defensively: `used_percent` directly, or `percent_left` inverted;
/// reset as an ISO string, or seconds-from-now, or epoch millis.
fn codex_window(
	value: &serde_json::Value,
	fallback_kind: LimitWindowKind,
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
	// Prefer the window's own duration over the positional fallback: ChatGPT's
	// `limit_window_seconds` distinguishes the short (5h) from the longer window.
	let kind = obj
		.get("limit_window_seconds")
		.and_then(serde_json::Value::as_i64)
		.map(|secs| {
			if secs <= 6 * 3600 {
				LimitWindowKind::FiveHour
			} else {
				LimitWindowKind::Weekly
			}
		})
		.unwrap_or(fallback_kind);
	let resets_at = obj
		.get("resets_at")
		.and_then(serde_json::Value::as_str)
		.map(str::to_string)
		.or_else(|| {
			obj.get("reset_at")
				.and_then(serde_json::Value::as_i64)
				.and_then(|secs| chrono::DateTime::from_timestamp(secs, 0))
				.map(|dt| dt.to_rfc3339())
		})
		.or_else(|| {
			obj.get("resets_in_seconds")
				.or_else(|| obj.get("reset_after_seconds"))
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

	// ChatGPT's usage endpoint returns `rate_limit` (singular) with
	// `primary_window`/`secondary_window`; older output used
	// `rate_limits.{primary,secondary}`. Read whichever the account returns; the
	// window kind comes from each window's own `limit_window_seconds`, falling
	// back to the positional 5h/weekly when absent.
	let root = body
		.get("rate_limit")
		.or_else(|| body.get("rate_limits"))
		.unwrap_or(&body);
	let windows: Vec<LimitWindowDto> = [
		("primary_window", "primary", LimitWindowKind::FiveHour),
		("secondary_window", "secondary", LimitWindowKind::Weekly),
	]
	.into_iter()
	.filter_map(|(new_key, old_key, fallback)| {
		root.get(new_key)
			.or_else(|| root.get(old_key))
			.and_then(|v| codex_window(v, fallback))
	})
	.collect();
	if windows.is_empty() {
		return Err(
			"codex usage response had no recognizable rate-limit windows"
				.to_string(),
		);
	}

	Ok(AgentLimitsDto {
		agent: UsageAgent::new("codex"),
		windows,
	})
}

/// Remaining rate-limit quota for Claude and Codex.
///
/// Degrades like [`summary`]: a not-logged-in or failing agent becomes a
/// `warnings` entry instead of failing the whole request.
pub async fn limits() -> UsageLimitsReportDto {
	limits_for_agents(None).await
}

pub async fn limits_for_agents(
	selected: Option<&[String]>,
) -> UsageLimitsReportDto {
	let include_claude = selected
		.map(|ids| ids.iter().any(|id| id == "claude"))
		.unwrap_or(true);
	let include_codex = selected
		.map(|ids| ids.iter().any(|id| id == "codex"))
		.unwrap_or(true);
	let (claude_res, codex_res) = tokio::join!(
		async {
			if include_claude {
				Some(fetch_claude_limits().await)
			} else {
				None
			}
		},
		async {
			if include_codex {
				Some(fetch_codex_limits().await)
			} else {
				None
			}
		}
	);

	let mut agents = Vec::new();
	let mut warnings = Vec::new();
	if let Some(result) = claude_res {
		match result {
			Ok(agent) => agents.push(agent),
			Err(e) => warnings.push(format!("claude limits unavailable: {e}")),
		}
	}
	if let Some(result) = codex_res {
		match result {
			Ok(agent) => agents.push(agent),
			Err(e) => warnings.push(format!("codex limits unavailable: {e}")),
		}
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
	use std::sync::atomic::{AtomicUsize, Ordering};
	use std::sync::Arc;

	#[cfg(unix)]
	#[tokio::test]
	async fn rejects_ccusage_output_over_the_limit() {
		use std::os::unix::fs::PermissionsExt;

		let root = tempfile::tempdir().unwrap();
		let executable = root.path().join("ccusage");
		std::fs::write(
			&executable,
			b"#!/bin/sh\nprintf 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'\n",
		)
		.unwrap();
		std::fs::set_permissions(
			&executable,
			std::fs::Permissions::from_mode(0o755),
		)
		.unwrap();

		let error = run_ccusage_with_limits(
			executable.as_os_str(),
			Vec::new(),
			// This test covers output limits, so leave room for a loaded CI worker.
			Duration::from_secs(5),
			32,
			32,
		)
		.await
		.expect_err("oversized output rejected");

		assert!(
			error.contains("output exceeded 32 bytes"),
			"unexpected ccusage error: {error}"
		);
	}

	#[tokio::test]
	async fn agent_probes_use_bounded_concurrency() {
		let active = Arc::new(AtomicUsize::new(0));
		let peak = Arc::new(AtomicUsize::new(0));
		let probes = (0..12).map(|index| {
			let active = active.clone();
			let peak = peak.clone();
			async move {
				let current = active.fetch_add(1, Ordering::SeqCst) + 1;
				peak.fetch_max(current, Ordering::SeqCst);
				tokio::time::sleep(Duration::from_millis(10)).await;
				active.fetch_sub(1, Ordering::SeqCst);
				(index, index)
			}
		});

		let (results, timed_out) =
			collect_agent_probes(probes, Duration::from_secs(1)).await;
		assert_eq!(results, (0..12).collect::<Vec<_>>());
		assert!(!timed_out);
		assert_eq!(peak.load(Ordering::SeqCst), MAX_CONCURRENT_AGENT_PROBES);
	}

	#[tokio::test]
	async fn agent_probe_deadline_preserves_completed_results() {
		let probes = (0..6).map(|index| async move {
			if index != 0 {
				std::future::pending::<()>().await;
			}
			(index, index)
		});

		let (results, timed_out) =
			collect_agent_probes(probes, Duration::from_millis(20)).await;
		assert_eq!(results, vec![0]);
		assert!(timed_out);
	}

	#[test]
	fn ccusage_cli_aliases_use_aghub_agent_ids() {
		assert!(KNOWN_USAGE_AGENTS.contains(&("droid", "factory")));
		assert!(KNOWN_USAGE_AGENTS.contains(&("kilo", "kilocode")));
	}

	#[test]
	fn selected_usage_agents_use_canonical_aghub_ids() {
		let selected = vec!["kilocode".to_string(), "claude".to_string()];
		let agents = selected_usage_agents(Some(&selected)).collect::<Vec<_>>();

		assert_eq!(agents, vec![("claude", "claude"), ("kilo", "kilocode")]);
	}

	#[test]
	fn an_empty_usage_agent_selection_disables_all_probes() {
		assert_eq!(selected_usage_agents(Some(&[])).count(), 0);
		assert_eq!(
			selected_usage_agents(None).count(),
			KNOWN_USAGE_AGENTS.len()
		);
	}

	#[tokio::test]
	async fn empty_agent_selections_do_not_spawn_usage_sources() {
		let query = UsageQuery {
			agents: Some(Vec::new()),
			..UsageQuery::default()
		};
		let summary = summary_with_version(
			OsStr::new("missing-ccusage"),
			&query,
			"ccusage test",
		)
		.await;
		assert!(summary.agents.is_empty());
		assert!(summary.warnings.is_empty());

		let limits = limits_for_agents(Some(&[])).await;
		assert!(limits.agents.is_empty());
		assert!(limits.warnings.is_empty());
	}

	#[cfg(unix)]
	#[tokio::test]
	async fn known_runtime_version_avoids_a_second_version_probe() {
		use std::os::unix::fs::PermissionsExt;

		let root = tempfile::tempdir().unwrap();
		let executable = root.path().join("ccusage");
		let marker = root.path().join("version-probed");
		let script = format!(
			"#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf called > '{}'; fi\nexit 1\n",
			marker.display()
		);
		std::fs::write(&executable, script).unwrap();
		std::fs::set_permissions(
			&executable,
			std::fs::Permissions::from_mode(0o755),
		)
		.unwrap();

		let report = summary_with_version(
			executable.as_os_str(),
			&UsageQuery::default(),
			"ccusage 20.0.18",
		)
		.await;
		assert_eq!(report.ccusage_version, "ccusage 20.0.18");
		assert_eq!(report.warnings.len(), KNOWN_USAGE_AGENTS.len());
		assert!(!marker.exists());
	}

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
	fn claude_normalization_matches_ccusage_summary_json() {
		let report: CcClaudeReport = serde_json::from_value(json!({
			"daily": [{
				"date": "2026-01-02",
				"inputTokens": 1234,
				"outputTokens": 567,
				"cacheCreationTokens": 89,
				"cacheReadTokens": 10,
				"totalTokens": 1900,
				"totalCost": 0.42,
				"modelsUsed": [
					"gpt-5.2-codex",
					"claude-sonnet-4-20250514"
				],
				"modelBreakdowns": [{
					"modelName": "gpt-5.2-codex",
					"inputTokens": 900,
					"outputTokens": 300,
					"cacheCreationTokens": 50,
					"cacheReadTokens": 10,
					"cost": 0.3
				}, {
					"modelName": "claude-sonnet-4-20250514",
					"inputTokens": 334,
					"outputTokens": 267,
					"cacheCreationTokens": 39,
					"cacheReadTokens": 0,
					"cost": 0.12
				}]
			}],
			"totals": {
				"inputTokens": 1234,
				"outputTokens": 567,
				"cacheCreationTokens": 89,
				"cacheReadTokens": 10,
				"totalTokens": 1900,
				"totalCost": 0.42
			}
		}))
		.unwrap();
		let agent = claude_to_agent(report);
		assert_eq!(agent.agent, UsageAgent::new("claude"));
		assert_eq!(agent.totals.reasoning_tokens, 0);
		assert_eq!(agent.totals.total_tokens, 1900);
		assert_eq!(agent.days[0].models[0].total_tokens, 1260);
		assert_eq!(agent.days[0].models[1].total_tokens, 640);
		assert_eq!(agent.totals.cost_usd, Some(0.42));
	}

	#[test]
	fn codex_normalization_matches_ccusage_daily_json() {
		let report: CcCodexReport = serde_json::from_value(json!({
			"daily": [{
				"date": "2026-01-02",
				"inputTokens": 100,
				"cacheReadTokens": 110,
				"cacheCreationTokens": 0,
				"outputTokens": 15,
				"reasoningOutputTokens": 2,
				"totalTokens": 227,
				"costUSD": 0.00040425,
				"models": {
					"gpt-5.3-codex": {
						"inputTokens": 100,
						"cacheReadTokens": 110,
						"cacheCreationTokens": 0,
						"outputTokens": 15,
						"reasoningOutputTokens": 2,
						"totalTokens": 227,
						"isFallback": true
					}
				}
			}],
			"totals": {
				"inputTokens": 100,
				"cacheReadTokens": 110,
				"cacheCreationTokens": 0,
				"outputTokens": 15,
				"reasoningOutputTokens": 2,
				"totalTokens": 227,
				"costUSD": 0.00040425
			}
		}))
		.unwrap();
		let agent = codex_to_agent(report);
		assert_eq!(agent.agent, UsageAgent::new("codex"));
		assert_eq!(agent.totals.cache_creation_tokens, 0);
		assert_eq!(agent.totals.cache_read_tokens, 110);
		assert_eq!(agent.totals.reasoning_tokens, 2);
		assert_eq!(agent.totals.total_tokens, 227);
		assert_eq!(agent.days[0].models[0].model, "gpt-5.3-codex");
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
	fn codex_report_parses_both_ccusage_field_names() {
		// 20.0.6 (the pinned sidecar) emits `cachedInputTokens`; 20.0.14+ (a dev's
		// global ccusage) emits `cacheReadTokens` + `cacheCreationTokens`. Both must
		// deserialize, or codex usage silently drops for that ccusage version.
		let old = serde_json::from_value::<CcCodexReport>(json!({
			"daily": [],
			"totals": {
				"inputTokens": 10,
				"cachedInputTokens": 4,
				"outputTokens": 6,
				"reasoningOutputTokens": 2,
				"totalTokens": 20,
				"costUSD": 0.5
			}
		}))
		.expect("20.0.6 cachedInputTokens shape");
		assert_eq!(old.totals.cache_read_tokens, 4);
		assert_eq!(old.totals.cache_creation_tokens, 0);

		let new = serde_json::from_value::<CcCodexReport>(json!({
			"daily": [],
			"totals": {
				"inputTokens": 10,
				"cacheReadTokens": 4,
				"cacheCreationTokens": 1,
				"outputTokens": 6,
				"reasoningOutputTokens": 2,
				"totalTokens": 20,
				"costUSD": 0.5
			}
		}))
		.expect("20.0.14 cacheReadTokens shape");
		assert_eq!(new.totals.cache_read_tokens, 4);
		assert_eq!(new.totals.cache_creation_tokens, 1);
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
		// API-key / logged-out codex carries no `tokens`: a clear error, not a panic
		// or a cryptic serde "missing field".
		assert!(
			parse_codex_auth(r#"{"OPENAI_API_KEY":"sk-x","tokens":null}"#)
				.is_err()
		);
		assert!(parse_codex_auth(r#"{"OPENAI_API_KEY":"sk-x"}"#).is_err());
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
		assert_eq!(
			resolve_ccusage_bin_with_environment(None, None),
			OsString::from("ccusage")
		);
		assert_eq!(
			resolve_ccusage_bin_with_environment(
				None,
				Some(OsString::from("/from/env")),
			),
			OsString::from("/from/env")
		);
	}

	#[test]
	fn build_args_default_is_offline_daily_json() {
		let args = build_ccusage_args("codex", &UsageQuery::default());
		assert_eq!(args[0], "codex");
		assert_eq!(args[1], "daily");
		assert!(args.contains(&"--json".to_string()));
		assert!(args.contains(&"--offline".to_string()));
		assert!(!args.contains(&"--no-offline".to_string()));
		assert!(!args.iter().any(|a| a == "--config"));
		assert!(!args.iter().any(|a| a == "--since"));
	}

	#[test]
	fn build_args_reflects_online_config_and_range() {
		let query = UsageQuery {
			since: Some("2026-06-01".to_string()),
			until: Some("2026-06-30".to_string()),
			timezone: Some("Asia/Shanghai".to_string()),
			agents: None,
			offline: false,
			config: Some(PathBuf::from("/tmp/cc.json")),
			timeout: Duration::from_secs(5),
			extra_args: vec!["--breakdown".to_string()],
		};
		let args = build_ccusage_args("claude", &query);
		assert!(args.contains(&"--no-offline".to_string()));
		assert!(!args.contains(&"--offline".to_string()));
		let ci = args.iter().position(|a| a == "--config").unwrap();
		assert_eq!(args[ci + 1], "/tmp/cc.json");
		let si = args.iter().position(|a| a == "--since").unwrap();
		assert_eq!(args[si + 1], "2026-06-01");
		assert!(args.contains(&"--timezone".to_string()));
		assert!(args.contains(&"Asia/Shanghai".to_string()));
		// Passthrough values retain their order.
		assert_eq!(args.last().unwrap(), "--breakdown");
	}

	#[test]
	fn generic_agent_normalization_matches_ccusage_opencode_json() {
		let raw = json!({
			"daily": [{
				"date": "2026-01-02",
				"inputTokens": 100,
				"outputTokens": 50,
				"cacheCreationTokens": 10,
				"cacheReadTokens": 5,
				"totalTokens": 172,
				"totalCost": 0.25,
				"credits": 1.5,
				"messageCount": 3,
				"modelsUsed": [
					"gpt-5.2-codex",
					"claude-sonnet-4-20250514"
				],
				"modelBreakdowns": [{
					"modelName": "gpt-5.2-codex",
					"inputTokens": 100,
					"outputTokens": 50,
					"cacheCreationTokens": 10,
					"cacheReadTokens": 5,
					"cost": 0.25
				}]
			}],
			"totals": {
				"inputTokens": 100,
				"outputTokens": 50,
				"cacheCreationTokens": 10,
				"cacheReadTokens": 5,
				"totalTokens": 172,
				"totalCost": 0.25
			}
		});
		let report: CcAgentReport = serde_json::from_value(raw).unwrap();
		let agent = generic_to_agent("opencode", report);
		assert_eq!(agent.agent, UsageAgent::new("opencode"));
		assert_eq!(agent.totals.total_tokens, 172);
		assert_eq!(agent.totals.cost_usd, Some(0.25));
		assert_eq!(agent.totals.reasoning_tokens, 0);
		assert_eq!(agent.days[0].models[0].model, "gpt-5.2-codex");
		assert_eq!(agent.days[0].models[0].total_tokens, 165);
	}

	#[test]
	fn generic_agent_rejects_missing_required_report_fields() {
		let missing_totals =
			serde_json::from_value::<CcAgentReport>(json!({ "daily": [] }));
		assert!(missing_totals.is_err());

		let missing_day_date = serde_json::from_value::<CcAgentReport>(json!({
			"daily": [{
				"inputTokens": 100,
				"outputTokens": 50,
				"cacheCreationTokens": 10,
				"cacheReadTokens": 5,
				"totalTokens": 165
			}],
			"totals": {
				"inputTokens": 100,
				"outputTokens": 50,
				"cacheCreationTokens": 10,
				"cacheReadTokens": 5,
				"totalTokens": 165
			}
		}));
		assert!(missing_day_date.is_err());

		let missing_total_tokens =
			serde_json::from_value::<CcAgentReport>(json!({
				"daily": [],
				"totals": {
					"inputTokens": 100,
					"outputTokens": 50,
					"cacheCreationTokens": 10,
					"cacheReadTokens": 5
				}
			}));
		assert!(missing_total_tokens.is_err());
	}

	#[test]
	fn generic_agent_tolerates_null_totals() {
		// qwen with no data: `{ "daily": [], "totals": null }` must parse to an
		// empty, zero-token agent (which the caller then skips) — not an error.
		let report: CcAgentReport =
			serde_json::from_value(json!({ "daily": [], "totals": null }))
				.unwrap();
		let agent = generic_to_agent("qwen", report);
		assert_eq!(agent.totals.total_tokens, 0);
	}

	#[test]
	fn codex_home_prefers_env_then_default() {
		// No other test in this crate touches CODEX_HOME, so mutating it here is
		// race-free.
		std::env::remove_var("CODEX_HOME");
		assert_eq!(codex_home().unwrap(), home_dir().unwrap().join(".codex"));
		std::env::set_var("CODEX_HOME", "/custom/codex");
		assert_eq!(codex_home().unwrap(), PathBuf::from("/custom/codex"));
		std::env::remove_var("CODEX_HOME");
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
	fn codex_window_reads_new_chatgpt_shape() {
		// ChatGPT's current `rate_limit.primary_window`: used_percent +
		// limit_window_seconds (kind by duration) + reset_at (epoch seconds).
		let w = codex_window(
			&json!({
				"used_percent": 5,
				"limit_window_seconds": 2_592_000i64,
				"reset_at": 1_785_339_666i64
			}),
			LimitWindowKind::FiveHour,
		)
		.unwrap();
		// 30-day window -> long kind despite the 5h positional fallback
		assert_eq!(w.kind, LimitWindowKind::Weekly);
		assert_eq!(w.utilization_pct, 5.0);
		assert!(w.resets_at.is_some());
		// a 5h-duration window keeps the short kind
		let w = codex_window(
			&json!({ "used_percent": 20, "limit_window_seconds": 18_000i64 }),
			LimitWindowKind::Weekly,
		)
		.unwrap();
		assert_eq!(w.kind, LimitWindowKind::FiveHour);
	}

	#[test]
	fn codex_models_sorted_by_name() {
		let mut models = HashMap::new();
		for name in ["zeta", "alpha", "mid"] {
			models.insert(
				name.to_string(),
				CcCodexModel {
					input_tokens: 1,
					cache_read_tokens: 0,
					cache_creation_tokens: 0,
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
				cache_read_tokens: 0,
				cache_creation_tokens: 0,
				output_tokens: 3,
				reasoning_output_tokens: 0,
				total_tokens: 6,
				cost_usd: None,
				models,
			}],
			totals: CcCodexTotals {
				input_tokens: 3,
				cache_read_tokens: 0,
				cache_creation_tokens: 0,
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
