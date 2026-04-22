use super::{
	copy_dir_all, extract_repository_archive, fetch_github_commit,
	fetch_github_raw_manifest, manifest_candidate_paths,
	remote_plugin_candidates, resolve_plugin_dir_with_wrappers, temp_dir,
	PluginRegistry,
};
use crate::claude::types::PluginManifest;
use anyhow::Result;
use async_trait::async_trait;
use std::path::{Path, PathBuf};

pub struct GitHubRegistry {
	client: reqwest::Client,
	owner: String,
	repo: String,
	subdir: Option<String>,
	git_installer: crate::installer::git::GitBasedInstaller,
}

impl GitHubRegistry {
	pub fn new(
		client: reqwest::Client,
		owner: &str,
		repo: &str,
		subdir: Option<String>,
	) -> Result<Self> {
		Ok(Self {
			client,
			owner: owner.to_string(),
			repo: repo.to_string(),
			subdir,
			git_installer: crate::installer::git::GitBasedInstaller::new()?,
		})
	}

	fn plugin_candidates(&self, name: &str) -> Vec<PathBuf> {
		match &self.subdir {
			Some(sub) => vec![PathBuf::from(format!("{}{}", sub, name))],
			None => remote_plugin_candidates(name),
		}
	}
}

#[async_trait]
impl PluginRegistry for GitHubRegistry {
	async fn fetch_manifest(&self, name: &str) -> Result<PluginManifest> {
		if let Some(manifest) = fetch_github_raw_manifest(
			&self.client,
			&self.owner,
			&self.repo,
			&manifest_candidate_paths(&self.plugin_candidates(name)),
		)
		.await
		{
			return Ok(manifest);
		}

		anyhow::bail!(
			"Plugin manifest not found: {} (tried main and master branches with multiple paths)",
			name
		)
	}

	async fn install(
		&self,
		name: &str,
		target_dir: &Path,
	) -> Result<Option<String>> {
		let url = format!("https://github.com/{}/{}", self.owner, self.repo);
		let temp_dir =
			temp_dir(&format!("aghub-plugin-install-{}-", self.repo))?;

		let commit = extract_repository_archive(
			&self.git_installer,
			&url,
			temp_dir.path(),
		)
		.await?;

		let source_dir = match resolve_plugin_dir_with_wrappers(
			temp_dir.path(),
			&self.plugin_candidates(name),
		) {
			Some(path) => path,
			None => anyhow::bail!(
				"Plugin directory not found in repository for '{}'",
				name
			),
		};

		copy_dir_all(&source_dir, target_dir).await?;
		Ok(Some(commit))
	}

	async fn get_latest_version(
		&self,
		_name: &str,
	) -> Result<Option<(String, Option<String>)>> {
		fetch_github_commit(&self.client, &self.owner, &self.repo).await
	}
}
