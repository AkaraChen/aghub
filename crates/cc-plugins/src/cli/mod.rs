//! Wrapper around the official `claude` CLI binary.
//!
//! Plugin lifecycle, marketplace, and listing operations are delegated to the
//! installed `claude` binary so behavior stays in lockstep with upstream.

pub mod types;

use self::types::{CliInstalledPlugin, CliMarketplace, CliPluginCatalog};
use crate::claude::settings::InstallScope;
use crate::PluginId;
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::process::Output;
use std::time::Duration;
use tokio::process::Command;

/// Map an aghub-side scope name to the value the CLI accepts.
///
/// aghub historically uses `global` while the CLI calls the same scope `user`.
pub(crate) fn cli_scope(scope: InstallScope) -> &'static str {
	match scope {
		InstallScope::Global => "user",
		InstallScope::Project => "project",
		InstallScope::Local => "local",
		InstallScope::Managed => "managed",
	}
}

/// Outer ceiling for any single CLI invocation. The CLI itself enforces
/// per-operation timeouts (git defaults to 120s); this guards against the
/// process never returning.
const SPAWN_TIMEOUT: Duration = Duration::from_secs(300);

pub struct ClaudeCli {
	binary: PathBuf,
}

impl ClaudeCli {
	pub fn new() -> Result<Self> {
		let binary = which::which("claude").context(
			"claude CLI not found in PATH. Install Claude Code: https://code.claude.com/docs/setup",
		)?;
		Ok(Self { binary })
	}

	pub fn binary_path(&self) -> &Path {
		&self.binary
	}

	pub async fn version(&self) -> Result<String> {
		let output = self.spawn(&["--version"]).await?;
		Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
	}

	pub async fn plugin_install(
		&self,
		id: &PluginId,
		scope: InstallScope,
	) -> Result<()> {
		let id_str = id.to_string();
		self.spawn(&[
			"plugin",
			"install",
			&id_str,
			"--scope",
			cli_scope(scope),
		])
		.await?;
		Ok(())
	}

	pub async fn plugin_uninstall(
		&self,
		id: &PluginId,
		scope: InstallScope,
		keep_data: bool,
		prune: bool,
	) -> Result<()> {
		let id_str = id.to_string();
		let scope_str = cli_scope(scope);
		// `-y` is required when stdin is not a TTY, which is always our case.
		let mut args =
			vec!["plugin", "uninstall", &id_str, "--scope", scope_str, "-y"];
		if keep_data {
			args.push("--keep-data");
		}
		if prune {
			args.push("--prune");
		}
		self.spawn(&args).await?;
		Ok(())
	}

	pub async fn plugin_update(
		&self,
		id: &PluginId,
		scope: InstallScope,
	) -> Result<()> {
		let id_str = id.to_string();
		self.spawn(&["plugin", "update", &id_str, "--scope", cli_scope(scope)])
			.await?;
		Ok(())
	}

	pub async fn plugin_list(&self) -> Result<Vec<CliInstalledPlugin>> {
		let output = self.spawn(&["plugin", "list", "--json"]).await?;
		serde_json::from_slice(&output.stdout)
			.context("failed to parse `claude plugin list --json` output")
	}

	pub async fn plugin_list_available(&self) -> Result<CliPluginCatalog> {
		let output = self
			.spawn(&["plugin", "list", "--json", "--available"])
			.await?;
		serde_json::from_slice(&output.stdout).context(
			"failed to parse `claude plugin list --json --available` output",
		)
	}

	pub async fn plugin_enable(
		&self,
		id: &PluginId,
		scope: Option<InstallScope>,
	) -> Result<()> {
		let id_str = id.to_string();
		let mut args = vec!["plugin", "enable", id_str.as_str()];
		if let Some(scope) = scope {
			args.push("--scope");
			args.push(cli_scope(scope));
		}
		self.spawn(&args).await?;
		Ok(())
	}

	pub async fn plugin_disable(
		&self,
		id: &PluginId,
		scope: Option<InstallScope>,
	) -> Result<()> {
		let id_str = id.to_string();
		let mut args = vec!["plugin", "disable", id_str.as_str()];
		if let Some(scope) = scope {
			args.push("--scope");
			args.push(cli_scope(scope));
		}
		self.spawn(&args).await?;
		Ok(())
	}

	/// Returns the CLI's stdout summary (e.g. "Nothing to prune ...") so the
	/// caller can surface it to users.
	pub async fn plugin_prune(
		&self,
		scope: InstallScope,
		dry_run: bool,
	) -> Result<String> {
		let mut args =
			vec!["plugin", "prune", "--scope", cli_scope(scope), "-y"];
		if dry_run {
			args.push("--dry-run");
		}
		let output = self.spawn(&args).await?;
		Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
	}

	pub async fn plugin_validate(&self, path: &Path) -> Result<()> {
		let path_str = path.display().to_string();
		self.spawn(&["plugin", "validate", path_str.as_str()])
			.await?;
		Ok(())
	}

	pub async fn marketplace_list(&self) -> Result<Vec<CliMarketplace>> {
		let output = self
			.spawn(&["plugin", "marketplace", "list", "--json"])
			.await?;
		serde_json::from_slice(&output.stdout).context(
			"failed to parse `claude plugin marketplace list --json` output",
		)
	}

	/// Accepts `owner/repo`, git URLs, local paths, or `marketplace.json` URLs.
	/// `sparse` lets monorepo marketplaces opt into git sparse-checkout. The
	/// CLI's success line is human-only and prone to glyph/localization drift,
	/// so we identify the newly-added entry by diffing the marketplace list.
	pub async fn marketplace_add(
		&self,
		source: &str,
		scope: InstallScope,
		sparse: &[String],
	) -> Result<CliMarketplace> {
		let before: std::collections::HashSet<String> = self
			.marketplace_list()
			.await?
			.into_iter()
			.map(|e| e.name)
			.collect();

		let scope_str = cli_scope(scope);
		let mut args: Vec<&str> =
			vec!["plugin", "marketplace", "add", source, "--scope", scope_str];
		if !sparse.is_empty() {
			args.push("--sparse");
			for path in sparse {
				args.push(path.as_str());
			}
		}
		self.spawn(&args).await?;

		let after = self.marketplace_list().await?;
		after
			.into_iter()
			.find(|entry| !before.contains(&entry.name))
			.ok_or_else(|| {
				anyhow::anyhow!(
					"`claude plugin marketplace add {source}` finished but the marketplace list shows no new entry"
				)
			})
	}

	pub async fn marketplace_remove(&self, name: &str) -> Result<()> {
		self.spawn(&["plugin", "marketplace", "remove", name])
			.await?;
		Ok(())
	}

	pub async fn marketplace_update(&self, name: Option<&str>) -> Result<()> {
		let mut args = vec!["plugin", "marketplace", "update"];
		if let Some(name) = name {
			args.push(name);
		}
		self.spawn(&args).await?;
		Ok(())
	}

	pub(crate) async fn spawn(&self, args: &[&str]) -> Result<Output> {
		let mut cmd = Command::new(&self.binary);
		cmd.kill_on_drop(true);
		cmd.args(args);
		#[cfg(windows)]
		cmd.creation_flags(crate::CREATE_NO_WINDOW);
		let output = tokio::time::timeout(SPAWN_TIMEOUT, cmd.output())
			.await
			.with_context(|| format!("claude {} timed out", args.join(" ")))?
			.with_context(|| {
				format!("failed to spawn claude {}", args.join(" "))
			})?;

		if !output.status.success() {
			let stderr = String::from_utf8_lossy(&output.stderr);
			let message = parse_cli_error(&stderr)
				.unwrap_or_else(|| stderr.trim().to_string());
			anyhow::bail!("claude {}: {}", args.join(" "), message);
		}

		Ok(output)
	}
}

/// Extract the message after the `✘` marker in stderr output.
///
/// CLI errors are formatted as `✘ Failed to <action>: <reason>`. We strip the
/// glyph so callers get a clean human-readable message.
fn parse_cli_error(stderr: &str) -> Option<String> {
	stderr
		.lines()
		.find_map(|line| line.split_once('✘').map(|(_, rest)| rest))
		.map(|rest| rest.trim().to_string())
		.filter(|message| !message.is_empty())
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parse_cli_error_extracts_message_after_glyph() {
		let stderr = "✘ Failed to install plugin \"x@y\": Plugin \"x\" not found in marketplace \"y\"\n";
		assert_eq!(
			parse_cli_error(stderr).as_deref(),
			Some(
				"Failed to install plugin \"x@y\": Plugin \"x\" not found in marketplace \"y\""
			)
		);
	}

	#[test]
	fn parse_cli_error_returns_none_when_marker_missing() {
		assert!(parse_cli_error("just some random text").is_none());
		assert!(parse_cli_error("").is_none());
	}

	#[test]
	fn parse_cli_error_returns_none_for_glyph_without_message() {
		assert!(parse_cli_error("✘   ").is_none());
	}

	#[test]
	fn cli_scope_renames_global_to_user() {
		assert_eq!(cli_scope(InstallScope::Global), "user");
		assert_eq!(cli_scope(InstallScope::Project), "project");
		assert_eq!(cli_scope(InstallScope::Local), "local");
	}

	#[test]
	fn new_either_finds_binary_or_returns_install_hint() {
		// `which` lookup is environment-dependent: PASS regardless, but if it
		// errors the message must guide the user toward installing the CLI.
		if let Err(error) = ClaudeCli::new() {
			let message = error.to_string();
			assert!(
				message.contains("claude CLI not found"),
				"unexpected error message: {message}"
			);
		}
	}
}
