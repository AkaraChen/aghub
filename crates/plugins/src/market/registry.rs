use super::types::PluginManifestFromFile;
use anyhow::{Context, Result};
use std::path::PathBuf;

use crate::installer::registry::{
	find_plugin_manifest_path, git_clone, git_output, is_git_repository,
};

/// Local marketplace registry
pub struct MarketplaceRegistry {
	/// Path to the local marketplace clone
	marketplace_path: PathBuf,
	/// Subdirectories containing plugins (e.g., ["plugins/", "external_plugins/"])
	plugins_subdirs: Vec<String>,
}

impl MarketplaceRegistry {
	/// Create a new marketplace registry for the default official marketplace
	pub fn new_official() -> Result<Self> {
		let marketplace_path = dirs::home_dir()
			.ok_or_else(|| anyhow::anyhow!("Cannot find home directory"))?
			.join(".claude/plugins/marketplaces/claude-plugins-official");

		Ok(Self {
			marketplace_path,
			plugins_subdirs: vec![
				"plugins/".to_string(),
				"external_plugins/".to_string(),
			],
		})
	}

	/// Create with custom path and subdirectories
	pub fn new(
		marketplace_path: PathBuf,
		plugins_subdirs: Vec<String>,
	) -> Self {
		Self {
			marketplace_path,
			plugins_subdirs,
		}
	}

	/// Get the plugin directory (searches all subdirs)
	fn plugin_dir(&self, name: &str) -> Option<PathBuf> {
		for subdir in &self.plugins_subdirs {
			let path = self.marketplace_path.join(subdir).join(name);
			if path.exists() {
				return Some(path);
			}
		}
		None
	}

	/// Check if marketplace is cloned locally
	pub fn is_available(&self) -> bool {
		self.marketplace_path.exists()
	}

	/// Clone the marketplace from GitHub
	pub async fn clone(&self) -> Result<()> {
		let parent_dir = self
			.marketplace_path
			.parent()
			.ok_or_else(|| anyhow::anyhow!("Invalid marketplace path"))?;

		std::fs::create_dir_all(parent_dir)?;

		log::info!("Cloning marketplace from GitHub...");
		git_clone(
			"https://github.com/anthropics/claude-plugins-official.git",
			&self.marketplace_path,
			"Failed to execute git clone",
		)
		.await?;

		log::info!("Marketplace cloned successfully");
		Ok(())
	}

	/// Update the marketplace by pulling latest changes
	pub async fn update(&self) -> Result<()> {
		if !self.marketplace_path.exists() {
			return self.clone().await;
		}

		log::info!("Updating marketplace...");

		if is_git_repository(&self.marketplace_path) {
			let output = git_output(
				&["pull", "--depth", "1"],
				Some(&self.marketplace_path),
				"Failed to execute git pull",
			)
			.await?;

			if !output.status.success() {
				let stderr = String::from_utf8_lossy(&output.stderr);
				log::warn!("Git pull output: {}", stderr);
			}
		}

		log::info!("Marketplace updated");
		Ok(())
	}

	/// List all available plugins from the local marketplace
	pub fn list_plugins(&self) -> Result<Vec<(String, PathBuf)>> {
		let mut plugins = Vec::new();

		for subdir in &self.plugins_subdirs {
			let plugins_dir = self.marketplace_path.join(subdir);

			if !plugins_dir.exists() {
				continue;
			}

			let entries = std::fs::read_dir(&plugins_dir)?;

			for entry in entries {
				let entry = entry?;
				let path = entry.path();

				if path.is_dir() && find_plugin_manifest_path(&path).is_some() {
					if let Some(name) =
						path.file_name().and_then(|n| n.to_str())
					{
						plugins.push((name.to_string(), path));
					}
				}
			}
		}

		plugins.sort_by(|a, b| a.0.cmp(&b.0));
		Ok(plugins)
	}

	/// Read plugin manifest
	pub fn read_manifest(
		&self,
		name: &str,
	) -> Result<Option<PluginManifestFromFile>> {
		let plugin_dir = match self.plugin_dir(name) {
			Some(p) => p,
			None => return Ok(None),
		};

		let manifest_path = match find_plugin_manifest_path(&plugin_dir) {
			Some(p) => p,
			None => return Ok(None),
		};

		let content = std::fs::read_to_string(&manifest_path)?;
		let manifest: PluginManifestFromFile = serde_json::from_str(&content)?;

		Ok(Some(manifest))
	}

	/// Get current git commit SHA
	pub fn get_commit(&self) -> Result<Option<String>> {
		let output = std::process::Command::new("git")
			.args(["rev-parse", "HEAD"])
			.current_dir(&self.marketplace_path)
			.output()
			.context("Failed to get git commit")?;

		if output.status.success() {
			let commit =
				String::from_utf8_lossy(&output.stdout).trim().to_string();
			return Ok(Some(commit));
		}

		Ok(None)
	}
}
