use std::collections::BTreeSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::rules::RuleFileSnapshot;

const RULE_VERSIONS_FILE: &str = "rule-versions.json";
/// Rule versions retain full file bodies, so bound each file's recovery list.
pub const DEFAULT_RULE_VERSIONS_PER_FILE: usize = 20;
pub const MIN_RULE_VERSIONS_PER_FILE: usize = 1;
pub const MAX_RULE_VERSIONS_PER_FILE: usize = 100;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuleVersionPreferences {
	pub enabled: bool,
	pub max_versions_per_file: usize,
}

impl Default for RuleVersionPreferences {
	fn default() -> Self {
		Self {
			enabled: true,
			max_versions_per_file: DEFAULT_RULE_VERSIONS_PER_FILE,
		}
	}
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct RuleVersionData {
	#[serde(default)]
	preferences: RuleVersionPreferences,
	#[serde(default)]
	versions: Vec<RuleVersion>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum StoredRuleVersionData {
	Current(RuleVersionData),
	Legacy(Vec<RuleVersion>),
}

#[derive(Debug, Error)]
pub enum RuleVersionError {
	#[error(transparent)]
	Io(#[from] std::io::Error),
	#[error(transparent)]
	Json(#[from] serde_json::Error),
	#[error("rule version retention {value} is outside the supported range")]
	InvalidPreferences { value: usize },
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

	pub fn file_path(&self) -> PathBuf {
		self.dir.join(RULE_VERSIONS_FILE)
	}

	pub fn clear(&self) -> Result<()> {
		let _guard = rule_version_lock()
			.lock()
			.map_err(|_| std::io::Error::other("rule version lock poisoned"))?;
		let mut data = match self.read_data() {
			Ok(data) => data,
			Err(
				RuleVersionError::Json(_)
				| RuleVersionError::InvalidPreferences { .. },
			) => RuleVersionData::default(),
			Err(error) => return Err(error),
		};
		data.versions.clear();
		self.write_data(&data)
	}

	pub fn list(&self, path: &Path) -> Result<Vec<RuleVersion>> {
		let mut versions = self
			.read_data()?
			.versions
			.into_iter()
			.filter(|version| version.path == path)
			.collect::<Vec<_>>();
		versions.sort_by_key(|version| version.created_at);
		versions.reverse();
		Ok(versions)
	}

	pub fn preferences(&self) -> Result<RuleVersionPreferences> {
		Ok(self.read_data()?.preferences)
	}

	pub fn set_preferences(
		&self,
		preferences: RuleVersionPreferences,
	) -> Result<()> {
		validate_preferences(preferences)?;
		let _guard = rule_version_lock()
			.lock()
			.map_err(|_| std::io::Error::other("rule version lock poisoned"))?;
		let mut data = self.read_data()?;
		data.preferences = preferences;
		prune_versions(&mut data.versions, preferences.max_versions_per_file);
		self.write_data(&data)
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
		let mut data = self.read_data()?;
		if !data.preferences.enabled {
			return Ok(None);
		}
		if let Some(existing) = data.versions.iter().find(|version| {
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
		data.versions.push(version.clone());
		prune_versions(
			&mut data.versions,
			data.preferences.max_versions_per_file,
		);
		self.write_data(&data)?;
		Ok(Some(version))
	}

	fn read_data(&self) -> Result<RuleVersionData> {
		match std::fs::read_to_string(self.file_path()) {
			Ok(content) => {
				let data = match serde_json::from_str(&content)? {
					StoredRuleVersionData::Current(data) => data,
					StoredRuleVersionData::Legacy(versions) => {
						RuleVersionData {
							versions,
							..RuleVersionData::default()
						}
					}
				};
				validate_preferences(data.preferences)?;
				Ok(data)
			}
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
				Ok(RuleVersionData::default())
			}
			Err(error) => Err(error.into()),
		}
	}

	fn write_data(&self, data: &RuleVersionData) -> Result<()> {
		std::fs::create_dir_all(&self.dir)?;
		let path = self.file_path();
		let json = serde_json::to_string_pretty(data)?;
		let mut temporary = tempfile::Builder::new()
			.prefix(".rule-versions.")
			.suffix(".json.tmp")
			.tempfile_in(&self.dir)?;
		temporary.write_all(json.as_bytes())?;
		temporary.persist(path).map_err(|error| error.error)?;
		Ok(())
	}
}

fn validate_preferences(preferences: RuleVersionPreferences) -> Result<()> {
	if (MIN_RULE_VERSIONS_PER_FILE..=MAX_RULE_VERSIONS_PER_FILE)
		.contains(&preferences.max_versions_per_file)
	{
		Ok(())
	} else {
		Err(RuleVersionError::InvalidPreferences {
			value: preferences.max_versions_per_file,
		})
	}
}

fn prune_versions(versions: &mut Vec<RuleVersion>, max_versions: usize) {
	let paths = versions
		.iter()
		.map(|version| version.path.clone())
		.collect::<BTreeSet<_>>();
	let mut remove_indices = Vec::new();
	for path in paths {
		let mut path_indices = versions
			.iter()
			.enumerate()
			.filter_map(|(index, candidate)| {
				(candidate.path == path)
					.then_some((index, candidate.created_at))
			})
			.collect::<Vec<_>>();
		path_indices.sort_by_key(|(_, created_at)| *created_at);
		remove_indices.extend(
			path_indices
				.iter()
				.take(path_indices.len().saturating_sub(max_versions))
				.map(|(index, _)| *index),
		);
	}
	remove_indices.sort_unstable_by(|left, right| right.cmp(left));
	for index in remove_indices {
		versions.remove(index);
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

	#[test]
	fn keeps_only_the_most_recent_versions_for_each_rule_file() {
		let temp = tempfile::tempdir().unwrap();
		let store = RuleVersionStore::new(temp.path());
		let path = temp.path().join("CLAUDE.md");

		for index in 0..=DEFAULT_RULE_VERSIONS_PER_FILE {
			store
				.record(
					&path,
					&snapshot(
						&format!("version {index}"),
						&format!("revision {index}"),
					),
				)
				.unwrap();
		}

		let versions = store.list(&path).unwrap();
		assert_eq!(versions.len(), DEFAULT_RULE_VERSIONS_PER_FILE);
		assert_eq!(versions.first().unwrap().content, "version 20");
		assert_eq!(versions.last().unwrap().content, "version 1");
	}

	#[test]
	fn saved_preferences_control_recording_and_retention() {
		let temp = tempfile::tempdir().unwrap();
		let store = RuleVersionStore::new(temp.path());
		let path = temp.path().join("CLAUDE.md");

		for index in 0..4 {
			store
				.record(
					&path,
					&snapshot(
						&format!("version {index}"),
						&format!("revision {index}"),
					),
				)
				.unwrap();
		}

		store
			.set_preferences(RuleVersionPreferences {
				enabled: true,
				max_versions_per_file: 2,
			})
			.unwrap();
		let versions = store.list(&path).unwrap();
		assert_eq!(versions.len(), 2);
		assert_eq!(versions[0].content, "version 3");
		assert_eq!(versions[1].content, "version 2");

		store
			.set_preferences(RuleVersionPreferences {
				enabled: false,
				max_versions_per_file: 2,
			})
			.unwrap();
		assert!(store
			.record(&path, &snapshot("not recorded", "revision 4"))
			.unwrap()
			.is_none());
		assert_eq!(store.list(&path).unwrap().len(), 2);
	}

	#[test]
	fn legacy_history_uses_default_preferences() {
		let temp = tempfile::tempdir().unwrap();
		let store = RuleVersionStore::new(temp.path());
		let path = temp.path().join("CLAUDE.md");
		let legacy = vec![RuleVersion {
			path: path.clone(),
			content: "legacy".to_string(),
			revision: "one".to_string(),
			created_at: 1,
		}];
		std::fs::write(
			store.file_path(),
			serde_json::to_string(&legacy).unwrap(),
		)
		.unwrap();

		assert_eq!(
			store.preferences().unwrap(),
			RuleVersionPreferences::default()
		);
		assert_eq!(store.list(&path).unwrap().len(), 1);
	}

	#[test]
	fn clears_all_rule_versions_even_when_the_store_is_invalid() {
		let temp = tempfile::tempdir().unwrap();
		let store = RuleVersionStore::new(temp.path());
		std::fs::write(store.file_path(), "{").unwrap();

		store.clear().unwrap();

		assert!(store.list(Path::new("CLAUDE.md")).unwrap().is_empty());
	}
}
