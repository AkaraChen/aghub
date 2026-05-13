use super::PluginInstaller;
use crate::claude::settings::InstallScope;
use crate::claude::types::InstalledPluginInfo;
use crate::cli::types::CliInstalledPlugin;
use crate::cli::{cli_scope, ClaudeCli};
use crate::PluginId;
use anyhow::Result;

// ── Lifecycle (delegated to the `claude` CLI) ──
//
// The official `claude plugin` surface has no "check for updates" command —
// callers go straight to `update <plugin>` and the CLI either applies the
// new version or returns AlreadyUpToDate. We mirror that here, so aghub
// never lies about update availability based on its own stale catalog read.

impl PluginInstaller {
	pub async fn is_installed(
		&self,
		id: &PluginId,
		scope: InstallScope,
	) -> Result<bool> {
		let cli = ClaudeCli::new()?;
		let plugins = cli.plugin_list().await?;
		let id_str = id.to_string();
		let target = cli_scope(scope);
		Ok(plugins.iter().any(|p| p.id == id_str && p.scope == target))
	}

	pub async fn install(
		&self,
		id: &PluginId,
		scope: InstallScope,
	) -> Result<InstalledPluginInfo> {
		let cli = ClaudeCli::new()?;
		cli.plugin_install(id, scope).await?;
		fetch_installed(&cli, id, scope).await
	}

	pub async fn uninstall(
		&self,
		id: &PluginId,
		scope: InstallScope,
		keep_data: bool,
		prune: bool,
	) -> Result<()> {
		let cli = ClaudeCli::new()?;
		cli.plugin_uninstall(id, scope, keep_data, prune).await
	}

	pub async fn update(
		&self,
		id: &PluginId,
		scope: InstallScope,
	) -> Result<InstalledPluginInfo> {
		let cli = ClaudeCli::new()?;
		cli.plugin_update(id, scope).await?;
		fetch_installed(&cli, id, scope).await
	}
}

async fn fetch_installed(
	cli: &ClaudeCli,
	id: &PluginId,
	scope: InstallScope,
) -> Result<InstalledPluginInfo> {
	let plugins = cli.plugin_list().await?;
	let id_str = id.to_string();
	let target = cli_scope(scope);
	plugins
		.into_iter()
		.find(|p| p.id == id_str && p.scope == target)
		.map(|plugin| installed_info_from_cli(plugin, scope))
		.ok_or_else(|| {
			anyhow::anyhow!(
				"plugin {id_str} not found in CLI list after operation"
			)
		})
}

fn installed_info_from_cli(
	plugin: CliInstalledPlugin,
	scope: InstallScope,
) -> InstalledPluginInfo {
	InstalledPluginInfo {
		scope: scope.to_string(),
		install_path: plugin.install_path,
		version: plugin.version,
		installed_at: plugin.installed_at,
		last_updated: plugin.last_updated,
		git_commit_sha: None,
	}
}
