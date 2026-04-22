use serde::{Deserialize, Serialize};

/// Information about an installed plugin
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct InstalledPluginInfo {
	pub scope: String,
	#[serde(rename = "installPath")]
	pub install_path: String,
	pub version: String,
	#[serde(rename = "installedAt")]
	pub installed_at: String,
	#[serde(rename = "lastUpdated")]
	pub last_updated: String,
	#[serde(rename = "gitCommitSha")]
	pub git_commit_sha: Option<String>,
}

impl Default for InstalledPluginInfo {
	fn default() -> Self {
		Self {
			scope: "user".to_string(),
			install_path: String::new(),
			version: "unknown".to_string(),
			installed_at: String::new(),
			last_updated: String::new(),
			git_commit_sha: None,
		}
	}
}
