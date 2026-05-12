//! `aghub-cli plugin ...` subcommands.
//!
//! All operations are dispatched through the `aghub_cc_plugins` crate which
//! delegates to the official `claude` CLI underneath.

use anyhow::{Context, Result};
use clap::{Subcommand, ValueEnum};

use aghub_cc_plugins::claude::settings::InstallScope;
use aghub_cc_plugins::claude::ClaudePluginManager;
use aghub_cc_plugins::cli::types::{
	CliMarketplaceSource, CliPluginSource, CliPluginSourceTagged,
};
use aghub_cc_plugins::cli::ClaudeCli;
use aghub_cc_plugins::installer::PluginInstaller;
use aghub_cc_plugins::PluginId;

#[derive(Subcommand)]
pub enum PluginAction {
	/// List installed plugins; pass --available to also show marketplace catalog
	List {
		/// Output as JSON
		#[arg(long)]
		json: bool,
		/// Include plugins available in configured marketplaces
		#[arg(long)]
		available: bool,
	},
	/// Install a plugin (e.g. "frontend-design@claude-plugins-official")
	Install {
		plugin_id: String,
		#[arg(long, value_enum, default_value_t = ScopeArg::Global)]
		scope: ScopeArg,
	},
	/// Uninstall a plugin
	Uninstall {
		plugin_id: String,
		#[arg(long, value_enum, default_value_t = ScopeArg::Global)]
		scope: ScopeArg,
		/// Preserve the plugin's persistent data directory
		#[arg(long)]
		keep_data: bool,
	},
	/// Update a plugin to its latest version
	Update {
		plugin_id: String,
		#[arg(long, value_enum, default_value_t = ScopeArg::Global)]
		scope: ScopeArg,
	},
	/// Enable a plugin
	Enable { plugin_id: String },
	/// Disable a plugin
	Disable { plugin_id: String },
	/// Manage plugin marketplaces
	Marketplace {
		#[command(subcommand)]
		action: MarketplaceAction,
	},
}

#[derive(Subcommand)]
pub enum MarketplaceAction {
	/// List configured marketplaces
	List {
		#[arg(long)]
		json: bool,
	},
	/// Add a marketplace (owner/repo, git URL, local path, or marketplace.json URL)
	Add {
		source: String,
		#[arg(long, value_enum, default_value_t = ScopeArg::Global)]
		scope: ScopeArg,
	},
	/// Remove a marketplace by name
	Remove { name: String },
	/// Refresh marketplaces (no name = refresh all)
	Update { name: Option<String> },
}

#[derive(ValueEnum, Clone, Copy, Debug)]
pub enum ScopeArg {
	Global,
	Project,
	Local,
}

impl From<ScopeArg> for InstallScope {
	fn from(arg: ScopeArg) -> Self {
		match arg {
			ScopeArg::Global => InstallScope::Global,
			ScopeArg::Project => InstallScope::Project,
			ScopeArg::Local => InstallScope::Local,
		}
	}
}

pub fn execute(action: PluginAction) -> Result<()> {
	let runtime = tokio::runtime::Builder::new_current_thread()
		.enable_all()
		.build()
		.context("Failed to build tokio runtime")?;
	runtime.block_on(dispatch(action))
}

async fn dispatch(action: PluginAction) -> Result<()> {
	match action {
		PluginAction::List { json, available } => {
			if available {
				list_available(json).await
			} else {
				list_installed(json).await
			}
		}
		PluginAction::Install { plugin_id, scope } => {
			install_plugin(&plugin_id, scope.into()).await
		}
		PluginAction::Uninstall {
			plugin_id,
			scope,
			keep_data,
		} => uninstall_plugin(&plugin_id, scope.into(), keep_data).await,
		PluginAction::Update { plugin_id, scope } => {
			update_plugin(&plugin_id, scope.into()).await
		}
		PluginAction::Enable { plugin_id } => enable_plugin(&plugin_id).await,
		PluginAction::Disable { plugin_id } => disable_plugin(&plugin_id).await,
		PluginAction::Marketplace { action } => {
			marketplace_dispatch(action).await
		}
	}
}

async fn marketplace_dispatch(action: MarketplaceAction) -> Result<()> {
	match action {
		MarketplaceAction::List { json } => list_marketplaces(json).await,
		MarketplaceAction::Add { source, scope } => {
			add_marketplace(&source, scope.into()).await
		}
		MarketplaceAction::Remove { name } => remove_marketplace(&name).await,
		MarketplaceAction::Update { name } => {
			update_marketplaces(name.as_deref()).await
		}
	}
}

// ── Plugin operations ───────────────────────────────────────────────────────

async fn list_installed(json: bool) -> Result<()> {
	let manager = manager().await?;
	let plugins = manager.list_plugins();

	if plugins.is_empty() {
		println!("No plugins installed.");
		return Ok(());
	}

	if json {
		let plugins_json: Vec<_> = plugins
			.iter()
			.map(|p| {
				serde_json::json!({
					"id": p.id.to_string(),
					"name": p.display_name,
					"version": p.version,
					"enabled": p.enabled,
					"source": p.source.to_string(),
					"install_path": p.install_path,
					"has_skills": p.has_skills(),
				})
			})
			.collect();
		println!("{}", serde_json::to_string_pretty(&plugins_json)?);
	} else {
		println!("{:<50} {:<12} {:<10} Name", "ID", "Version", "Status");
		for plugin in plugins {
			let status = if plugin.enabled {
				"✓ enabled"
			} else {
				"✗ disabled"
			};
			println!(
				"{:<50} {:<12} {:<10} {}",
				plugin.id.to_string(),
				plugin.version,
				status,
				plugin.display_name
			);
		}
	}
	Ok(())
}

async fn list_available(json: bool) -> Result<()> {
	let cli = ClaudeCli::new()?;
	let catalog = cli.plugin_list_available().await?;
	if json {
		let installed_ids: std::collections::HashSet<&str> =
			catalog.installed.iter().map(|p| p.id.as_str()).collect();
		let entries: Vec<_> = catalog
			.available
			.iter()
			.map(|p| {
				serde_json::json!({
					"plugin_id": p.plugin_id,
					"name": p.name,
					"description": p.description,
					"marketplace": p.marketplace_name,
					"install_count": p.install_count,
					"installed": installed_ids.contains(p.plugin_id.as_str()),
					"source": format_available_source(&p.source),
				})
			})
			.collect();
		println!("{}", serde_json::to_string_pretty(&entries)?);
		return Ok(());
	}

	if catalog.available.is_empty() {
		println!("No plugins available in configured marketplaces.");
		return Ok(());
	}

	let installed_ids: std::collections::HashSet<&str> =
		catalog.installed.iter().map(|p| p.id.as_str()).collect();

	println!(
		"{:<55} {:<28} {:>10} {:<10} Description",
		"ID", "Marketplace", "Installs", "Status"
	);
	for p in &catalog.available {
		let status = if installed_ids.contains(p.plugin_id.as_str()) {
			"installed"
		} else {
			"-"
		};
		println!(
			"{:<55} {:<28} {:>10} {:<10} {}",
			truncate(&p.plugin_id, 55),
			truncate(&p.marketplace_name, 28),
			p.install_count,
			status,
			truncate(&p.description, 60),
		);
	}
	Ok(())
}

async fn install_plugin(plugin_id: &str, scope: InstallScope) -> Result<()> {
	let id = parse_id(plugin_id)?;
	let installer = PluginInstaller::new()?;
	let info = installer.install(&id, scope).await?;
	println!(
		"Installed {} {} ({} scope) at {}",
		plugin_id, info.version, scope, info.install_path
	);
	Ok(())
}

async fn uninstall_plugin(
	plugin_id: &str,
	scope: InstallScope,
	keep_data: bool,
) -> Result<()> {
	let id = parse_id(plugin_id)?;
	let installer = PluginInstaller::new()?;
	installer.uninstall(&id, scope, keep_data).await?;
	if keep_data {
		println!(
			"Uninstalled {} ({} scope), data preserved",
			plugin_id, scope
		);
	} else {
		println!("Uninstalled {} ({} scope)", plugin_id, scope);
	}
	Ok(())
}

async fn update_plugin(plugin_id: &str, scope: InstallScope) -> Result<()> {
	let id = parse_id(plugin_id)?;
	let installer = PluginInstaller::new()?;
	let info = installer.update(&id, scope).await?;
	println!(
		"Updated {} to {} ({} scope)",
		plugin_id, info.version, scope
	);
	Ok(())
}

async fn enable_plugin(plugin_id: &str) -> Result<()> {
	let id = parse_id(plugin_id)?;
	let mut manager = manager().await?;
	manager.enable(&id).await?;
	println!("Enabled {}", plugin_id);
	Ok(())
}

async fn disable_plugin(plugin_id: &str) -> Result<()> {
	let id = parse_id(plugin_id)?;
	let mut manager = manager().await?;
	manager.disable(&id).await?;
	println!("Disabled {}", plugin_id);
	Ok(())
}

// ── Marketplace operations ──────────────────────────────────────────────────

async fn list_marketplaces(json: bool) -> Result<()> {
	let cli = ClaudeCli::new()?;
	let entries = cli.marketplace_list().await?;

	if entries.is_empty() {
		println!("No marketplaces configured.");
		return Ok(());
	}

	if json {
		let dtos: Vec<_> = entries
			.iter()
			.map(|m| {
				serde_json::json!({
					"name": m.name,
					"source": format_marketplace_source(&m.source),
					"install_location": m.install_location,
				})
			})
			.collect();
		println!("{}", serde_json::to_string_pretty(&dtos)?);
		return Ok(());
	}

	println!("{:<35} {:<55} Install location", "Name", "Source");
	for entry in entries {
		println!(
			"{:<35} {:<55} {}",
			truncate(&entry.name, 35),
			truncate(&format_marketplace_source(&entry.source), 55),
			entry.install_location,
		);
	}
	Ok(())
}

async fn add_marketplace(source: &str, scope: InstallScope) -> Result<()> {
	let cli = ClaudeCli::new()?;
	let entry = cli.marketplace_add(source, scope).await?;
	println!(
		"Added marketplace {} ({})",
		entry.name,
		format_marketplace_source(&entry.source)
	);
	Ok(())
}

async fn remove_marketplace(name: &str) -> Result<()> {
	let cli = ClaudeCli::new()?;
	cli.marketplace_remove(name).await?;
	println!("Removed marketplace {}", name);
	Ok(())
}

async fn update_marketplaces(name: Option<&str>) -> Result<()> {
	let cli = ClaudeCli::new()?;
	cli.marketplace_update(name).await?;
	match name {
		Some(name) => println!("Updated marketplace {}", name),
		None => println!("Updated all marketplaces"),
	}
	Ok(())
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async fn manager() -> Result<ClaudePluginManager> {
	ClaudePluginManager::new().await.context(
		"Failed to initialize plugin manager. Is Claude Code installed?",
	)
}

fn parse_id(s: &str) -> Result<PluginId> {
	PluginId::parse(s).with_context(|| format!("Invalid plugin ID: {}", s))
}

fn format_marketplace_source(source: &CliMarketplaceSource) -> String {
	match source {
		CliMarketplaceSource::Github { repo } => format!("github:{}", repo),
		CliMarketplaceSource::Url { url } => url.clone(),
		CliMarketplaceSource::Local { path } => format!("local:{}", path),
	}
}

fn format_available_source(source: &CliPluginSource) -> String {
	match source {
		CliPluginSource::Path(p) => p.clone(),
		CliPluginSource::Tagged(tagged) => match tagged {
			CliPluginSourceTagged::Github { repo, git_ref, sha } => {
				format_git_ref(&format!("github:{}", repo), git_ref, sha)
			}
			CliPluginSourceTagged::Url { url, git_ref, sha } => {
				format_git_ref(url, git_ref, sha)
			}
			CliPluginSourceTagged::GitSubdir {
				url,
				path,
				git_ref,
				sha,
			} => format_git_ref(&format!("{}#{}", url, path), git_ref, sha),
			CliPluginSourceTagged::Npm {
				package, version, ..
			} => match version {
				Some(v) => format!("npm:{}@{}", package, v),
				None => format!("npm:{}", package),
			},
		},
	}
}

fn format_git_ref(
	base: &str,
	git_ref: &Option<String>,
	sha: &Option<String>,
) -> String {
	match (git_ref, sha) {
		(_, Some(sha)) => format!("{}@{}", base, &sha[..sha.len().min(12)]),
		(Some(r), None) => format!("{}@{}", base, r),
		(None, None) => base.to_string(),
	}
}

fn truncate(s: &str, max: usize) -> String {
	if s.chars().count() <= max {
		s.to_string()
	} else {
		let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
		out.push('…');
		out
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn scope_arg_converts_to_install_scope() {
		assert!(matches!(
			InstallScope::from(ScopeArg::Global),
			InstallScope::Global
		));
		assert!(matches!(
			InstallScope::from(ScopeArg::Project),
			InstallScope::Project
		));
		assert!(matches!(
			InstallScope::from(ScopeArg::Local),
			InstallScope::Local
		));
	}

	#[test]
	fn truncate_keeps_short_strings_intact() {
		assert_eq!(truncate("hello", 10), "hello");
		assert_eq!(truncate("hello", 5), "hello");
	}

	#[test]
	fn truncate_appends_ellipsis_when_too_long() {
		assert_eq!(truncate("hello world", 5), "hell…");
	}

	#[test]
	fn format_git_ref_prefers_short_sha() {
		let base = "https://github.com/a/b";
		assert_eq!(
			format_git_ref(
				base,
				&Some("v1.0.0".to_string()),
				&Some("abcdef1234567890".to_string())
			),
			"https://github.com/a/b@abcdef123456"
		);
	}

	#[test]
	fn format_git_ref_falls_back_to_ref() {
		assert_eq!(
			format_git_ref("base", &Some("main".to_string()), &None),
			"base@main"
		);
	}

	#[test]
	fn format_git_ref_returns_base_when_neither_provided() {
		assert_eq!(format_git_ref("base", &None, &None), "base");
	}

	#[test]
	fn format_marketplace_source_renders_each_variant() {
		assert_eq!(
			format_marketplace_source(&CliMarketplaceSource::Github {
				repo: "a/b".to_string()
			}),
			"github:a/b"
		);
		assert_eq!(
			format_marketplace_source(&CliMarketplaceSource::Url {
				url: "https://x".to_string()
			}),
			"https://x"
		);
		assert_eq!(
			format_marketplace_source(&CliMarketplaceSource::Local {
				path: "/tmp/x".to_string()
			}),
			"local:/tmp/x"
		);
	}
}
