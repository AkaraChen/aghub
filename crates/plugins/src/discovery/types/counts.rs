use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct InstallCountEntry {
	pub plugin: String,
	pub unique_installs: u64,
}

#[derive(Debug, Deserialize)]
pub struct InstallCountsCache {
	pub version: u32,
	pub fetched_at: Option<chrono::DateTime<chrono::Utc>>,
	pub counts: Vec<InstallCountEntry>,
}
