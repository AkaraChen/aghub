use super::super::registry::{
	git_clone, git_ok, git_output, is_git_repository,
};
use super::registry_impl::MarketplaceRegistry;
use anyhow::{Context, Result};

impl MarketplaceRegistry {
	pub async fn update(&self) -> Result<()> {
		if !self.marketplace_path.exists() {
			return self.clone_marketplace().await;
		}

		if is_git_repository(&self.marketplace_path) {
			git_ok(
				&["pull"],
				Some(&self.marketplace_path),
				"Failed to execute git pull",
				"Git pull failed",
			)
			.await?;

			log::info!("Marketplace updated successfully");
			return Ok(());
		}

		log::info!(
			"Marketplace at {:?} is a snapshot, refreshing from upstream clone",
			self.marketplace_path
		);
		self.replace_snapshot_from_upstream().await?;

		log::info!("Marketplace updated successfully");
		Ok(())
	}

	async fn clone_marketplace(&self) -> Result<()> {
		let upstream_repo = self.upstream_repo.as_deref().ok_or_else(|| {
			anyhow::anyhow!(
				"Marketplace directory not found and no upstream repo is configured: {:?}",
				self.marketplace_path
			)
		})?;

		let parent_dir = self.marketplace_path.parent().ok_or_else(|| {
			anyhow::anyhow!(
				"Invalid marketplace path: {:?}",
				self.marketplace_path
			)
		})?;

		tokio::fs::create_dir_all(parent_dir).await?;
		git_clone(
			upstream_repo,
			&self.marketplace_path,
			"Failed to execute git clone",
		)
		.await?;

		Ok(())
	}

	async fn replace_snapshot_from_upstream(&self) -> Result<()> {
		let upstream_repo = self.upstream_repo.as_deref().ok_or_else(|| {
			anyhow::anyhow!(
				"Marketplace snapshot cannot be refreshed without an upstream repo"
			)
		})?;

		let parent_dir = self.marketplace_path.parent().ok_or_else(|| {
			anyhow::anyhow!(
				"Invalid marketplace path: {:?}",
				self.marketplace_path
			)
		})?;
		tokio::fs::create_dir_all(parent_dir).await?;

		let name = self
			.marketplace_path
			.file_name()
			.and_then(|value| value.to_str())
			.unwrap_or("marketplace");
		let suffix = chrono::Utc::now()
			.timestamp_nanos_opt()
			.map(|value| value.to_string())
			.unwrap_or_else(|| std::process::id().to_string());
		let clone_path = parent_dir.join(format!(".{name}-clone-{suffix}"));
		let backup_path = parent_dir.join(format!(".{name}-backup-{suffix}"));

		if clone_path.exists() {
			tokio::fs::remove_dir_all(&clone_path).await.ok();
		}
		if backup_path.exists() {
			tokio::fs::remove_dir_all(&backup_path).await.ok();
		}

		if let Err(error) = git_clone(
			upstream_repo,
			&clone_path,
			"Failed to execute git clone for marketplace refresh",
		)
		.await
		{
			tokio::fs::remove_dir_all(&clone_path).await.ok();
			return Err(error);
		}

		tokio::fs::rename(&self.marketplace_path, &backup_path)
			.await
			.with_context(|| {
				format!(
					"Failed to move existing marketplace out of the way: {:?}",
					self.marketplace_path
				)
			})?;

		if let Err(error) =
			tokio::fs::rename(&clone_path, &self.marketplace_path).await
		{
			let restore_result =
				tokio::fs::rename(&backup_path, &self.marketplace_path).await;
			tokio::fs::remove_dir_all(&clone_path).await.ok();
			match restore_result {
				Ok(_) => {
					return Err(error).with_context(|| {
						"Failed to replace marketplace snapshot".to_string()
					});
				}
				Err(restore_error) => {
					return Err(error).context(format!(
						"Failed to replace marketplace snapshot, and restore also failed: {restore_error}"
					));
				}
			}
		}

		tokio::fs::remove_dir_all(&backup_path).await.ok();
		Ok(())
	}

	pub(super) async fn get_marketplace_commit(
		&self,
	) -> Result<Option<String>> {
		let output = git_output(
			&["rev-parse", "HEAD"],
			Some(&self.marketplace_path),
			"Failed to get marketplace commit",
		)
		.await?;

		if output.status.success() {
			let commit =
				String::from_utf8_lossy(&output.stdout).trim().to_string();
			return Ok(Some(commit));
		}

		Ok(None)
	}
}
