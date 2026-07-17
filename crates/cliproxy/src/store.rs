//! Instance persistence: metadata in `<app_data>/cliproxy/instances.json`,
//! management keys in the OS keyring. The installed binary version is not
//! recorded here — the provision directory on disk is its single source of
//! truth.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::dto::GatewayInstanceKind;
use crate::error::{GatewayError, Result};

const KEYRING_SERVICE: &str = "aghub.gateway";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayInstanceRecord {
	pub id: String,
	pub name: String,
	pub kind: GatewayInstanceKind,
	/// e.g. `http://127.0.0.1:8317`
	pub base_url: String,
	/// Listen port (managed only).
	pub port: Option<u16>,
	pub auto_start: bool,
	pub created_at: String,
}

pub struct InstanceStore {
	root: PathBuf,
}

impl InstanceStore {
	pub fn new(app_data_dir: &Path) -> Self {
		Self {
			root: app_data_dir.join("cliproxy"),
		}
	}

	pub fn root(&self) -> &Path {
		&self.root
	}

	fn file(&self) -> PathBuf {
		self.root.join("instances.json")
	}

	pub fn list(&self) -> Result<Vec<GatewayInstanceRecord>> {
		let path = self.file();
		if !path.exists() {
			return Ok(Vec::new());
		}
		let raw = std::fs::read_to_string(path)?;
		Ok(serde_json::from_str(&raw)?)
	}

	pub fn get(&self, id: &str) -> Result<GatewayInstanceRecord> {
		self.list()?
			.into_iter()
			.find(|record| record.id == id)
			.ok_or_else(|| GatewayError::InstanceNotFound(id.to_string()))
	}

	pub fn insert(&self, record: GatewayInstanceRecord) -> Result<()> {
		let mut records = self.list()?;
		if records.iter().any(|existing| existing.id == record.id) {
			return Err(GatewayError::InstanceExists(record.id));
		}
		records.push(record);
		self.save(&records)
	}

	pub fn update(&self, record: GatewayInstanceRecord) -> Result<()> {
		let mut records = self.list()?;
		let slot = records
			.iter_mut()
			.find(|existing| existing.id == record.id)
			.ok_or_else(|| GatewayError::InstanceNotFound(record.id.clone()))?;
		*slot = record;
		self.save(&records)
	}

	pub fn remove(&self, id: &str) -> Result<GatewayInstanceRecord> {
		let mut records = self.list()?;
		let index = records
			.iter()
			.position(|record| record.id == id)
			.ok_or_else(|| GatewayError::InstanceNotFound(id.to_string()))?;
		let removed = records.remove(index);
		self.save(&records)?;
		Ok(removed)
	}

	fn save(&self, records: &[GatewayInstanceRecord]) -> Result<()> {
		std::fs::create_dir_all(&self.root)?;
		let tmp = self.root.join("instances.json.tmp");
		std::fs::write(&tmp, serde_json::to_string_pretty(records)?)?;
		std::fs::rename(&tmp, self.file())?;
		Ok(())
	}
}

/// Stores per-instance management keys outside of `instances.json`.
pub trait GatewayKeyStore {
	fn get_key(&self, instance_id: &str) -> Result<Option<String>>;
	fn set_key(&self, instance_id: &str, key: &str) -> Result<()>;
	fn delete_key(&self, instance_id: &str) -> Result<()>;
}

/// Platform-native keyring implementation (same pattern as the inference
/// crate's credential store).
#[derive(Debug, Clone, Copy, Default)]
pub struct NativeGatewayKeyStore;

impl NativeGatewayKeyStore {
	fn entry(instance_id: &str) -> Result<keyring::Entry> {
		let user = format!("instance:{instance_id}:management_key");
		Ok(keyring::Entry::new(KEYRING_SERVICE, &user)?)
	}
}

impl GatewayKeyStore for NativeGatewayKeyStore {
	fn get_key(&self, instance_id: &str) -> Result<Option<String>> {
		let entry = Self::entry(instance_id)?;
		match entry.get_password() {
			Ok(key) => Ok(Some(key)),
			Err(keyring::Error::NoEntry) => Ok(None),
			Err(error) => Err(error.into()),
		}
	}

	fn set_key(&self, instance_id: &str, key: &str) -> Result<()> {
		let entry = Self::entry(instance_id)?;
		entry.set_password(key)?;
		Ok(())
	}

	fn delete_key(&self, instance_id: &str) -> Result<()> {
		let entry = Self::entry(instance_id)?;
		match entry.delete_credential() {
			Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
			Err(error) => Err(error.into()),
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn record(id: &str) -> GatewayInstanceRecord {
		GatewayInstanceRecord {
			id: id.to_string(),
			name: format!("instance {id}"),
			kind: GatewayInstanceKind::External,
			base_url: "http://127.0.0.1:8317".to_string(),
			port: None,
			auto_start: false,
			created_at: "2026-07-17T00:00:00Z".to_string(),
		}
	}

	#[test]
	fn crud_roundtrip() {
		let dir = tempfile::tempdir().expect("tempdir");
		let store = InstanceStore::new(dir.path());

		assert!(store.list().expect("empty list").is_empty());
		store.insert(record("a")).expect("insert");
		assert!(matches!(
			store.insert(record("a")),
			Err(GatewayError::InstanceExists(_))
		));

		let mut updated = record("a");
		updated.name = "renamed".to_string();
		store.update(updated).expect("update");
		assert_eq!(store.get("a").expect("get").name, "renamed");

		store.remove("a").expect("remove");
		assert!(matches!(
			store.get("a"),
			Err(GatewayError::InstanceNotFound(_))
		));
	}
}
