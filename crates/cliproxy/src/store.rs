//! Instance persistence: metadata in `<app_data>/cliproxy/instances.json`,
//! management keys in the OS keyring. The installed binary version is not
//! recorded here — the provision directory on disk is its single source of
//! truth.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

use crate::dto::GatewayInstanceKind;
use crate::error::{GatewayError, Result};

const KEYRING_SERVICE: &str = "aghub.gateway";

fn instance_mutation_lock() -> &'static Mutex<()> {
	static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
	LOCK.get_or_init(|| Mutex::new(()))
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GatewayProviderProjection {
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub anthropic_provider_id: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub openai_provider_id: Option<String>,
}

impl GatewayProviderProjection {
	fn is_empty(&self) -> bool {
		self.anthropic_provider_id.is_none()
			&& self.openai_provider_id.is_none()
	}
}

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
	#[serde(
		default,
		skip_serializing_if = "GatewayProviderProjection::is_empty"
	)]
	pub provider_projection: GatewayProviderProjection,
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
		self.mutate_records(|records| {
			if records.iter().any(|existing| existing.id == record.id) {
				return Err(GatewayError::InstanceExists(record.id));
			}
			records.push(record);
			Ok(())
		})
	}

	pub fn update(&self, record: GatewayInstanceRecord) -> Result<()> {
		self.mutate_records(|records| {
			let slot = records
				.iter_mut()
				.find(|existing| existing.id == record.id)
				.ok_or_else(|| {
					GatewayError::InstanceNotFound(record.id.clone())
				})?;
			*slot = record;
			Ok(())
		})
	}

	pub fn update_provider_projection(
		&self,
		id: &str,
		projection: GatewayProviderProjection,
	) -> Result<()> {
		self.mutate_records(|records| {
			let record = records
				.iter_mut()
				.find(|record| record.id == id)
				.ok_or_else(|| {
					GatewayError::InstanceNotFound(id.to_string())
				})?;
			record.provider_projection = projection;
			Ok(())
		})
	}

	pub fn remove(&self, id: &str) -> Result<GatewayInstanceRecord> {
		self.mutate_records(|records| {
			let index = records
				.iter()
				.position(|record| record.id == id)
				.ok_or_else(|| {
					GatewayError::InstanceNotFound(id.to_string())
				})?;
			Ok(records.remove(index))
		})
	}

	fn mutate_records<T>(
		&self,
		mutation: impl FnOnce(&mut Vec<GatewayInstanceRecord>) -> Result<T>,
	) -> Result<T> {
		let _guard = instance_mutation_lock()
			.lock()
			.unwrap_or_else(|poisoned| poisoned.into_inner());
		let mut records = self.list()?;
		let result = mutation(&mut records)?;
		self.save(&records)?;
		Ok(result)
	}

	fn save(&self, records: &[GatewayInstanceRecord]) -> Result<()> {
		std::fs::create_dir_all(&self.root)?;
		let path = self.file();
		let permissions = match path.metadata() {
			Ok(metadata) => Some(metadata.permissions()),
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
			Err(error) => return Err(error.into()),
		};
		let mut temporary = tempfile::Builder::new()
			.prefix(".instances.")
			.suffix(".json.tmp")
			.tempfile_in(&self.root)?;
		temporary
			.write_all(serde_json::to_string_pretty(records)?.as_bytes())?;
		if let Some(permissions) = permissions {
			temporary.as_file().set_permissions(permissions)?;
		}
		temporary.persist(path).map_err(|error| error.error)?;
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
			provider_projection: GatewayProviderProjection::default(),
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

	#[test]
	fn concurrent_inserts_preserve_every_instance() {
		const WRITER_COUNT: usize = 32;

		let dir = tempfile::tempdir().expect("tempdir");
		let barrier =
			std::sync::Arc::new(std::sync::Barrier::new(WRITER_COUNT));
		let mut writers = Vec::with_capacity(WRITER_COUNT);

		for index in 0..WRITER_COUNT {
			let root = dir.path().to_path_buf();
			let barrier = barrier.clone();
			writers.push(std::thread::spawn(move || {
				barrier.wait();
				InstanceStore::new(&root).insert(record(&index.to_string()))
			}));
		}

		for writer in writers {
			writer.join().expect("writer thread").expect("insert");
		}

		let records = InstanceStore::new(dir.path()).list().expect("list");
		assert_eq!(records.len(), WRITER_COUNT);
	}

	#[test]
	fn old_instance_records_default_projection_provenance() {
		let record: GatewayInstanceRecord = serde_json::from_str(
			r#"{
				"id": "legacy",
				"name": "Legacy",
				"kind": "external",
				"base_url": "http://127.0.0.1:8317",
				"port": null,
				"auto_start": false,
				"created_at": "2026-07-17T00:00:00Z"
			}"#,
		)
		.expect("legacy record");

		assert!(record.provider_projection.is_empty());
	}
}
