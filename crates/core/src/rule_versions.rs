use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::rules::RuleFileSnapshot;

const RULE_VERSIONS_FILE: &str = "rule-versions.json";

fn rule_version_lock() -> &'static Mutex<()> {
	static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
	LOCK.get_or_init(|| Mutex::new(()))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuleVersion {
	pub path: PathBuf,
	pub content: String,
	pub revision: String,
	pub created_at: u64,
}

#[derive(Debug, Error)]
pub enum RuleVersionError {
	#[error(transparent)]
	Io(#[from] std::io::Error),
	#[error(transparent)]
	Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, RuleVersionError>;

#[derive(Debug, Clone)]
pub struct RuleVersionStore {
	dir: PathBuf,
}

impl RuleVersionStore {
	pub fn new(app_data_dir: impl Into<PathBuf>) -> Self {
		Self {
			dir: app_data_dir.into(),
		}
	}

	fn file_path(&self) -> PathBuf {
		self.dir.join(RULE_VERSIONS_FILE)
	}

	pub fn list(&self, path: &Path) -> Result<Vec<RuleVersion>> {
		let mut versions = self
			.read_all()?
			.into_iter()
			.filter(|version| version.path == path)
			.collect::<Vec<_>>();
		versions.sort_by_key(|version| version.created_at);
		versions.reverse();
		Ok(versions)
	}

	pub fn record(
		&self,
		path: &Path,
		snapshot: &RuleFileSnapshot,
	) -> Result<Option<RuleVersion>> {
		if !snapshot.exists {
			return Ok(None);
		}

		let _guard = rule_version_lock()
			.lock()
			.map_err(|_| std::io::Error::other("rule version lock poisoned"))?;
		let mut versions = self.read_all()?;
		if let Some(existing) = versions.iter().find(|version| {
			version.path == path && version.revision == snapshot.revision
		}) {
			return Ok(Some(existing.clone()));
		}

		let version = RuleVersion {
			path: path.to_path_buf(),
			content: snapshot.content.clone(),
			revision: snapshot.revision.clone(),
			created_at: now_millis(),
		};
		versions.push(version.clone());
		self.write(&versions)?;
		Ok(Some(version))
	}

	fn read_all(&self) -> Result<Vec<RuleVersion>> {
		match std::fs::read_to_string(self.file_path()) {
			Ok(content) => Ok(serde_json::from_str(&content)?),
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
				Ok(Vec::new())
			}
			Err(error) => Err(error.into()),
		}
	}

	fn write(&self, versions: &[RuleVersion]) -> Result<()> {
		std::fs::create_dir_all(&self.dir)?;
		let path = self.file_path();
		let json = serde_json::to_string_pretty(versions)?;
		let mut temporary = tempfile::Builder::new()
			.prefix(".rule-versions.")
			.suffix(".json.tmp")
			.tempfile_in(&self.dir)?;
		temporary.write_all(json.as_bytes())?;
		temporary.persist(path).map_err(|error| error.error)?;
		Ok(())
	}
}

fn now_millis() -> u64 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|elapsed| elapsed.as_millis() as u64)
		.unwrap_or(0)
}

#[cfg(test)]
mod tests {
	use super::*;

	fn snapshot(content: &str, revision: &str) -> RuleFileSnapshot {
		RuleFileSnapshot {
			content: content.to_string(),
			exists: true,
			revision: revision.to_string(),
		}
	}

	#[test]
	fn records_versions_per_rule_path_newest_first() {
		let temp = tempfile::tempdir().unwrap();
		let store = RuleVersionStore::new(temp.path());
		let claude = temp.path().join("CLAUDE.md");
		let agents = temp.path().join("AGENTS.md");

		store.record(&claude, &snapshot("first", "one")).unwrap();
		store.record(&agents, &snapshot("other", "two")).unwrap();
		store.record(&claude, &snapshot("second", "three")).unwrap();

		let versions = store.list(&claude).unwrap();
		assert_eq!(versions.len(), 2);
		assert_eq!(versions[0].content, "second");
		assert_eq!(versions[1].content, "first");
	}

	#[test]
	fn does_not_duplicate_the_same_revision() {
		let temp = tempfile::tempdir().unwrap();
		let store = RuleVersionStore::new(temp.path());
		let path = temp.path().join("CLAUDE.md");
		let current = snapshot("same", "one");

		store.record(&path, &current).unwrap();
		store.record(&path, &current).unwrap();

		assert_eq!(store.list(&path).unwrap().len(), 1);
	}

	#[test]
	fn ignores_a_missing_file_snapshot() {
		let temp = tempfile::tempdir().unwrap();
		let store = RuleVersionStore::new(temp.path());
		let path = temp.path().join("CLAUDE.md");
		let missing = RuleFileSnapshot {
			content: String::new(),
			exists: false,
			revision: "missing".to_string(),
		};

		assert!(store.record(&path, &missing).unwrap().is_none());
		assert!(store.list(&path).unwrap().is_empty());
	}
}
