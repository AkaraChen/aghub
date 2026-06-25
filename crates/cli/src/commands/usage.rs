//! `aghub-cli usage ...` subcommands.
//!
//! Thin CLI surface over the `aghub_usage` crate. Both subcommands print the
//! same JSON the desktop app consumes; the CLI does not bundle the ccusage
//! sidecar, so `summary` resolves it from `AGHUB_CCUSAGE_BIN` or `PATH`.

use anyhow::{Context, Result};
use clap::Subcommand;

#[derive(Subcommand)]
pub enum UsageAction {
	/// Daily token and cost usage for Claude and Codex from local ccusage data
	Summary {
		/// Start date, YYYY-MM-DD (passed through to ccusage)
		#[arg(long)]
		since: Option<String>,
		/// End date, YYYY-MM-DD (passed through to ccusage)
		#[arg(long)]
		until: Option<String>,
		/// IANA timezone for day bucketing (passed through to ccusage)
		#[arg(long)]
		timezone: Option<String>,
	},
	/// Remaining rate-limit quota for Claude and Codex from each vendor endpoint
	Limits,
}

pub fn execute(action: UsageAction) -> Result<()> {
	let runtime = tokio::runtime::Builder::new_current_thread()
		.enable_all()
		.build()
		.context("Failed to build tokio runtime")?;
	runtime.block_on(dispatch(action))
}

async fn dispatch(action: UsageAction) -> Result<()> {
	match action {
		UsageAction::Summary {
			since,
			until,
			timezone,
		} => {
			let bin = aghub_usage::resolve_ccusage_bin(None);
			let report =
				aghub_usage::summary(&bin, since, until, timezone).await;
			println!("{}", serde_json::to_string_pretty(&report)?);
		}
		UsageAction::Limits => {
			let report = aghub_usage::limits().await;
			println!("{}", serde_json::to_string_pretty(&report)?);
		}
	}
	Ok(())
}
