use super::UnifiedPluginRegistry;
use crate::discovery::InstallCountsCache;
use anyhow::Result;

impl UnifiedPluginRegistry {
	pub(super) async fn load_install_counts(&mut self) -> Result<()> {
		let path = self.config.install_counts_path();

		if !path.exists() {
			log::debug!("Install counts cache not found at {}", path.display());
			return Ok(());
		}

		let content = tokio::fs::read_to_string(&path).await?;

		if let Ok(cache) = serde_json::from_str::<InstallCountsCache>(&content)
		{
			for entry in cache.counts {
				self.install_counts
					.insert(entry.plugin, entry.unique_installs);
			}
			log::debug!("Loaded {} install counts", self.install_counts.len());
		} else {
			log::warn!("Failed to parse install counts cache");
		}

		Ok(())
	}
}
