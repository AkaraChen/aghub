use super::marketplace::{is_marketplace_source, MarketplaceRegistry};
use super::PluginInstaller;
use crate::claude::settings::InstallScope;
use crate::claude::types::InstalledPluginInfo;
use crate::cli::types::CliInstalledPlugin;
use crate::cli::{cli_scope, ClaudeCli};
use crate::PluginId;
use anyhow::Result;

// ── Version helpers (used by `check_update_against`) ──

fn is_semantic_version(ver: &str) -> bool {
	ver.chars()
		.next()
		.map(|c| c.is_ascii_digit())
		.unwrap_or(false)
		&& ver.contains('.')
}

fn compare_versions(a: &str, b: &str) -> i32 {
	let a_clean = a.split('+').next().unwrap_or(a);
	let b_clean = b.split('+').next().unwrap_or(b);

	match (
		semver::Version::parse(a_clean),
		semver::Version::parse(b_clean),
	) {
		(Ok(a_ver), Ok(b_ver)) => match a_ver.cmp(&b_ver) {
			std::cmp::Ordering::Less => -1,
			std::cmp::Ordering::Equal => 0,
			std::cmp::Ordering::Greater => 1,
		},
		_ => {
			let parse = |s: &str| {
				s.split('.')
					.filter_map(|part| part.parse::<u32>().ok())
					.collect::<Vec<_>>()
			};

			let a_parts = parse(a);
			let b_parts = parse(b);

			for (a_part, b_part) in a_parts.iter().zip(b_parts.iter()) {
				match a_part.cmp(b_part) {
					std::cmp::Ordering::Less => return -1,
					std::cmp::Ordering::Greater => return 1,
					std::cmp::Ordering::Equal => continue,
				}
			}

			match a_parts.len().cmp(&b_parts.len()) {
				std::cmp::Ordering::Less => -1,
				std::cmp::Ordering::Equal => 0,
				std::cmp::Ordering::Greater => 1,
			}
		}
	}
}

// ── Lifecycle (delegated to the `claude` CLI) ──

impl PluginInstaller {
	pub async fn is_installed(
		&self,
		id: &PluginId,
		scope: InstallScope,
	) -> bool {
		let Ok(cli) = ClaudeCli::new() else {
			return false;
		};
		let Ok(plugins) = cli.plugin_list().await else {
			return false;
		};
		let id_str = id.to_string();
		let target = cli_scope(scope);
		plugins.iter().any(|p| p.id == id_str && p.scope == target)
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
	) -> Result<()> {
		let cli = ClaudeCli::new()?;
		cli.plugin_uninstall(id, scope, keep_data).await
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

	pub async fn check_update_against(
		&self,
		id: &PluginId,
		current_ver: &str,
		current_commit: Option<&str>,
	) -> Result<Option<(String, Option<String>)>> {
		let Some(registry) = self.marketplace_registry_for(&id.source)? else {
			return Ok(None);
		};
		let Some((latest_ver, latest_sha)) =
			registry.get_latest_version(&id.name).await?
		else {
			return Ok(None);
		};

		let needs_update = if is_semantic_version(current_ver)
			&& is_semantic_version(&latest_ver)
		{
			compare_versions(&latest_ver, current_ver) > 0
		} else {
			match latest_sha.as_deref() {
				Some(new) => Some(new) != current_commit,
				None => latest_ver != *current_ver,
			}
		};

		Ok(needs_update.then_some((latest_ver, latest_sha)))
	}

	fn marketplace_registry_for(
		&self,
		source: &str,
	) -> Result<Option<MarketplaceRegistry>> {
		if !is_marketplace_source(&self.marketplace_root, source) {
			return Ok(None);
		}
		self.marketplace_registry(source).map(Some)
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

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_compare_versions() {
		assert_eq!(compare_versions("1.0.0", "1.0.0"), 0);
		assert_eq!(compare_versions("1.1.0", "1.0.0"), 1);
		assert_eq!(compare_versions("1.0.0", "1.1.0"), -1);
		assert_eq!(compare_versions("2.0.0", "1.9.9"), 1);
		assert_eq!(compare_versions("1.0.0-alpha", "1.0.0"), -1);
		assert_eq!(compare_versions("1.0.0-beta", "1.0.0-alpha"), 1);
		assert_eq!(compare_versions("1.0.0+build1", "1.0.0+build2"), 0);
		assert_eq!(compare_versions("1.0", "1.0.0"), -1);
		assert_eq!(compare_versions("1.0.0", "1.0"), 1);
		assert_eq!(compare_versions("1.2", "1.10"), -1);
		assert_eq!(compare_versions("abc", "def"), 0);
	}

	#[test]
	fn test_is_semantic_version() {
		assert!(is_semantic_version("1.0.0"));
		assert!(is_semantic_version("2.1.0-beta"));
		assert!(!is_semantic_version("abc123"));
		assert!(!is_semantic_version("latest"));
	}
}
