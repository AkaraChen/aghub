//! Claude Code plugin types
//!
//! Data structures for parsing installed_plugins.json

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Root structure of installed_plugins.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPluginsManifest {
    pub version: i32,
    /// Plugin ID -> list of installations (different scopes)
    pub plugins: HashMap<String, Vec<InstalledPluginInfo>>,
}

/// Information about an installed plugin
#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub git_commit_sha: String,
}

/// Plugin source types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginScope {
    User,
    Project,
}
