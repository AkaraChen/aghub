use anyhow::Result;
use std::path::PathBuf;

const OFFICIAL_MARKETPLACE_REPO: &str =
	"https://github.com/anthropics/claude-plugins-official.git";

pub struct MarketplaceRegistry {
	pub(super) marketplace_path: PathBuf,
	pub(super) plugins_subdirs: Vec<String>,
	pub(super) upstream_repo: Option<String>,
	pub(super) client: reqwest::Client,
	pub(super) git_installer: super::super::git::GitBasedInstaller,
}

impl MarketplaceRegistry {
	pub fn new(
		marketplace_path: PathBuf,
		plugins_subdirs: Vec<String>,
	) -> Result<Self> {
		Self::new_with_upstream(marketplace_path, plugins_subdirs, None)
	}

	pub fn new_with_upstream(
		marketplace_path: PathBuf,
		plugins_subdirs: Vec<String>,
		upstream_repo: Option<String>,
	) -> Result<Self> {
		let client = super::super::git::build_http_client(60)?;

		Ok(Self {
			marketplace_path,
			plugins_subdirs,
			upstream_repo,
			client,
			git_installer: super::super::git::GitBasedInstaller::new()?,
		})
	}

	pub fn new_official() -> anyhow::Result<Self> {
		let marketplace_path = dirs::home_dir()
			.ok_or_else(|| anyhow::anyhow!("Cannot find home directory"))?
			.join(".claude/plugins/marketplaces/claude-plugins-official");
		Self::new_with_upstream(
			marketplace_path,
			vec!["plugins/".to_string(), "external_plugins/".to_string()],
			Some(OFFICIAL_MARKETPLACE_REPO.to_string()),
		)
	}
}
