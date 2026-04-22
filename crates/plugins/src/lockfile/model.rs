use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Plugin lockfile structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginLockfile {
	/// When the lockfile was generated
	pub generated_at: String,
	/// Installed plugins with exact versions
	pub plugins: BTreeMap<String, LockedPlugin>,
}

/// A locked plugin entry with exact version information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LockedPlugin {
	/// Plugin ID (name@source)
	pub id: String,
	/// Plugin name
	pub name: String,
	/// Exact semantic version
	pub version: String,
	/// Git commit SHA (for git-based sources)
	pub commit_sha: Option<String>,
	/// Source (registry or URL)
	pub source: String,
	/// Download URL or local path
	pub resolved: String,
	/// Integrity hash (SHA-256 of tarball)
	pub integrity: Option<String>,
	/// Installation scope
	pub scope: String,
	/// Installation timestamp
	pub installed_at: String,
	/// Dependencies on other plugins
	#[serde(default)]
	pub dependencies: Vec<String>,
}

/// Result of a restore operation
#[derive(Debug)]
pub struct RestoreResult {
	pub id: String,
	pub success: bool,
	pub message: String,
}

impl Default for PluginLockfile {
	fn default() -> Self {
		Self {
			generated_at: chrono::Utc::now().to_rfc3339(),
			plugins: BTreeMap::new(),
		}
	}
}
