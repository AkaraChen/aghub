use aghub_core::models::CredentialType;
use iota_stronghold::{Client, KeyProvider, SnapshotPath, Store, Stronghold};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

const STRONGHOLD_CLIENT_PATH: &[u8] = b"aghub-inference-providers";
const PROVIDER_INDEX_KEY: &[u8] = b"providers:index";
const MASTER_KEY_SERVICE: &str = "aghub";
const MASTER_KEY_USER: &str = "inference_provider_master_key";

#[derive(Debug)]
pub(crate) enum ProviderStoreError {
	NotFound(String),
	Exists(String),
	Validation(String),
	Internal(String),
}

impl ProviderStoreError {
	pub(crate) fn internal(message: impl Into<String>) -> Self {
		Self::Internal(message.into())
	}
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CreateProviderInput {
	pub(crate) name: String,
	pub(crate) r#type: CredentialType,
	pub(crate) base: String,
	pub(crate) key: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct UpdateProviderInput {
	pub(crate) name: Option<String>,
	pub(crate) r#type: Option<CredentialType>,
	pub(crate) base: Option<String>,
	pub(crate) key: Option<String>,
	pub(crate) clear_key: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct StoredProvider {
	pub(crate) id: String,
	pub(crate) name: String,
	#[serde(rename = "type")]
	pub(crate) r#type: CredentialType,
	pub(crate) base: String,
	pub(crate) key: Option<String>,
}

impl StoredProvider {
	pub(crate) fn has_key(&self) -> bool {
		self.key.is_some()
	}
}

#[derive(Debug, Clone)]
enum MasterKeySource {
	Keyring {
		service: String,
		user: String,
	},
	#[cfg(test)]
	Fixed(String),
}

#[derive(Debug)]
pub(crate) struct ProviderStoreHandle {
	store: ProviderStore,
}

impl ProviderStoreHandle {
	pub(crate) fn new() -> Self {
		Self {
			store: ProviderStore::default(),
		}
	}

	pub(crate) fn list(
		&mut self,
	) -> Result<Vec<StoredProvider>, ProviderStoreError> {
		self.store.list()
	}

	pub(crate) fn get(
		&mut self,
		id: &str,
	) -> Result<StoredProvider, ProviderStoreError> {
		self.store.get(id)
	}

	pub(crate) fn create(
		&mut self,
		input: CreateProviderInput,
	) -> Result<StoredProvider, ProviderStoreError> {
		self.store.create(input)
	}

	pub(crate) fn update(
		&mut self,
		id: &str,
		input: UpdateProviderInput,
	) -> Result<StoredProvider, ProviderStoreError> {
		self.store.update(id, input)
	}

	pub(crate) fn delete(
		&mut self,
		id: &str,
	) -> Result<(), ProviderStoreError> {
		self.store.delete(id)
	}
}

#[derive(Debug, Clone)]
struct ProviderStore {
	snapshot_path: PathBuf,
	master_key: MasterKeySource,
}

impl Default for ProviderStore {
	fn default() -> Self {
		Self {
			snapshot_path: default_snapshot_path(),
			master_key: MasterKeySource::Keyring {
				service: MASTER_KEY_SERVICE.to_string(),
				user: MASTER_KEY_USER.to_string(),
			},
		}
	}
}

impl ProviderStore {
	#[cfg(test)]
	fn with_fixed_key(snapshot_path: PathBuf, key: impl Into<String>) -> Self {
		Self {
			snapshot_path,
			master_key: MasterKeySource::Fixed(key.into()),
		}
	}

	fn list(&mut self) -> Result<Vec<StoredProvider>, ProviderStoreError> {
		if !self.snapshot_path.exists() {
			return Ok(Vec::new());
		}

		let (_, _, client) = self.open(false)?;
		let store = client.store();
		let ids = self.load_index(&store)?;
		let mut providers = self.load_all(&store, &ids)?;
		providers
			.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
		Ok(providers)
	}

	fn get(&mut self, id: &str) -> Result<StoredProvider, ProviderStoreError> {
		if !self.snapshot_path.exists() {
			return Err(ProviderStoreError::NotFound(id.to_string()));
		}

		let (_, _, client) = self.open(false)?;
		let store = client.store();
		self.load_record(&store, id)?
			.ok_or_else(|| ProviderStoreError::NotFound(id.to_string()))
	}

	fn create(
		&mut self,
		input: CreateProviderInput,
	) -> Result<StoredProvider, ProviderStoreError> {
		let name = validate_required("name", input.name)?;
		let base = validate_required("base URL", input.base)?;
		let key = validate_optional("provider key", input.key)?;

		let (stronghold, keyprovider, client) = self.open(true)?;
		let store = client.store();
		let mut ids = self.load_index(&store)?;
		let existing = self.load_all(&store, &ids)?;

		if existing
			.iter()
			.any(|provider| provider.name.eq_ignore_ascii_case(&name))
		{
			return Err(ProviderStoreError::Exists(name));
		}

		let provider = StoredProvider {
			id: Uuid::new_v4().to_string(),
			name,
			r#type: input.r#type,
			base,
			key,
		};
		self.save_record(&store, &provider)?;
		ids.push(provider.id.clone());
		self.save_index(&store, &ids)?;
		self.persist(&stronghold, &keyprovider)?;
		Ok(provider)
	}

	fn update(
		&mut self,
		id: &str,
		input: UpdateProviderInput,
	) -> Result<StoredProvider, ProviderStoreError> {
		if input.clear_key && input.key.is_some() {
			return Err(ProviderStoreError::Validation(
				"Cannot set and clear the provider key in one request"
					.to_string(),
			));
		}

		let (stronghold, keyprovider, client) = self.open(false)?;
		let store = client.store();
		let ids = self.load_index(&store)?;
		let mut provider = self
			.load_record(&store, id)?
			.ok_or_else(|| ProviderStoreError::NotFound(id.to_string()))?;

		if let Some(name) = input.name {
			let name = validate_required("name", name)?;
			if ids
				.iter()
				.filter(|provider_id| provider_id.as_str() != id)
				.filter_map(|provider_id| {
					self.load_record(&store, provider_id).ok().flatten()
				})
				.any(|existing| existing.name.eq_ignore_ascii_case(&name))
			{
				return Err(ProviderStoreError::Exists(name));
			}
			provider.name = name;
		}

		if let Some(r#type) = input.r#type {
			provider.r#type = r#type;
		}

		if let Some(base) = input.base {
			provider.base = validate_required("base URL", base)?;
		}

		if let Some(key) = input.key {
			provider.key = Some(validate_required("provider key", key)?);
		}

		if input.clear_key {
			provider.key = None;
		}

		self.save_record(&store, &provider)?;
		self.persist(&stronghold, &keyprovider)?;
		Ok(provider)
	}

	fn delete(&mut self, id: &str) -> Result<(), ProviderStoreError> {
		if !self.snapshot_path.exists() {
			return Err(ProviderStoreError::NotFound(id.to_string()));
		}

		let (stronghold, keyprovider, client) = self.open(false)?;
		let store = client.store();
		let mut ids = self.load_index(&store)?;

		if self.load_record(&store, id)?.is_none() {
			return Err(ProviderStoreError::NotFound(id.to_string()));
		}

		store.delete(id.as_bytes()).map_err(|error| {
			ProviderStoreError::internal(format!(
				"Failed to delete provider '{id}' from stronghold: {error}"
			))
		})?;
		ids.retain(|provider_id| provider_id != id);
		self.save_index(&store, &ids)?;
		self.persist(&stronghold, &keyprovider)?;
		Ok(())
	}

	fn open(
		&self,
		create_if_missing: bool,
	) -> Result<(Stronghold, KeyProvider, Client), ProviderStoreError> {
		let snapshot_exists = self.snapshot_path.exists();
		let password = self.master_key(snapshot_exists, create_if_missing)?;
		let keyprovider =
			KeyProvider::with_passphrase_hashed_blake2b(password.into_bytes())
				.map_err(|error| {
					ProviderStoreError::internal(format!(
						"Failed to create stronghold key provider: {error}"
					))
				})?;
		let stronghold = Stronghold::default();
		let snapshot = SnapshotPath::from_path(&self.snapshot_path);

		if snapshot_exists {
			stronghold.load_snapshot(&keyprovider, &snapshot).map_err(
				|error| {
					ProviderStoreError::internal(format!(
						"Failed to load provider stronghold snapshot: {error}"
					))
				},
			)?;
		}

		let client = if snapshot_exists {
			match stronghold.load_client(STRONGHOLD_CLIENT_PATH) {
				Ok(client) => client,
				Err(_) => stronghold
					.create_client(STRONGHOLD_CLIENT_PATH)
					.map_err(|error| {
						ProviderStoreError::internal(format!(
							"Failed to load provider stronghold client: {error}"
						))
					})?,
			}
		} else if create_if_missing {
			stronghold.create_client(STRONGHOLD_CLIENT_PATH).map_err(
				|error| {
					ProviderStoreError::internal(format!(
						"Failed to create provider stronghold client: {error}"
					))
				},
			)?
		} else {
			return Err(ProviderStoreError::internal(
				"Provider stronghold snapshot does not exist",
			));
		};

		Ok((stronghold, keyprovider, client))
	}

	fn persist(
		&self,
		stronghold: &Stronghold,
		keyprovider: &KeyProvider,
	) -> Result<(), ProviderStoreError> {
		if let Some(parent) = self.snapshot_path.parent() {
			fs::create_dir_all(parent).map_err(|error| {
				ProviderStoreError::internal(format!(
					"Failed to create provider snapshot directory: {error}"
				))
			})?;
		}

		stronghold
			.write_client(STRONGHOLD_CLIENT_PATH)
			.map_err(|error| {
				ProviderStoreError::internal(format!(
					"Failed to write provider stronghold client: {error}"
				))
			})?;
		let snapshot = SnapshotPath::from_path(&self.snapshot_path);
		stronghold
			.commit_with_keyprovider(&snapshot, keyprovider)
			.map_err(|error| {
				ProviderStoreError::internal(format!(
					"Failed to commit provider stronghold snapshot: {error}"
				))
			})?;
		Ok(())
	}

	fn master_key(
		&self,
		snapshot_exists: bool,
		create_if_missing: bool,
	) -> Result<String, ProviderStoreError> {
		match &self.master_key {
			#[cfg(test)]
			MasterKeySource::Fixed(key) => Ok(key.clone()),
			MasterKeySource::Keyring { service, user } => {
				let entry =
					keyring::Entry::new(service, user).map_err(|error| {
						ProviderStoreError::internal(format!(
							"Failed to open provider keyring entry: {error}"
						))
					})?;

				match entry.get_password() {
					Ok(password) if !password.trim().is_empty() => Ok(password),
					Ok(_) => Err(ProviderStoreError::internal(
						"Provider stronghold keyring entry is empty",
					)),
					Err(keyring::Error::NoEntry)
						if !snapshot_exists && create_if_missing =>
					{
						let password = format!(
							"{}{}",
							Uuid::new_v4().simple(),
							Uuid::new_v4().simple()
						);
						entry.set_password(&password).map_err(|error| {
							ProviderStoreError::internal(format!(
									"Failed to persist provider stronghold key: {error}"
								))
						})?;
						Ok(password)
					}
					Err(keyring::Error::NoEntry) => {
						Err(ProviderStoreError::internal(
							"Provider stronghold key is missing",
						))
					}
					Err(error) => Err(ProviderStoreError::internal(format!(
						"Failed to read provider stronghold key: {error}"
					))),
				}
			}
		}
	}

	fn load_index(
		&self,
		store: &Store,
	) -> Result<Vec<String>, ProviderStoreError> {
		let Some(bytes) = store.get(PROVIDER_INDEX_KEY).map_err(|error| {
			ProviderStoreError::internal(format!(
				"Failed to read provider index: {error}"
			))
		})?
		else {
			return Ok(Vec::new());
		};
		let ids: Vec<String> =
			serde_json::from_slice(&bytes).map_err(|error| {
				ProviderStoreError::internal(format!(
					"Failed to parse provider index: {error}"
				))
			})?;
		Ok(ids)
	}

	fn save_index(
		&self,
		store: &Store,
		ids: &[String],
	) -> Result<(), ProviderStoreError> {
		let serialized = serde_json::to_vec(ids).map_err(|error| {
			ProviderStoreError::internal(format!(
				"Failed to serialize provider index: {error}"
			))
		})?;
		store
			.insert(PROVIDER_INDEX_KEY.to_vec(), serialized, None)
			.map_err(|error| {
				ProviderStoreError::internal(format!(
					"Failed to write provider index: {error}"
				))
			})?;
		Ok(())
	}

	fn load_all(
		&self,
		store: &Store,
		ids: &[String],
	) -> Result<Vec<StoredProvider>, ProviderStoreError> {
		let mut providers = Vec::new();

		for id in ids {
			if let Some(provider) = self.load_record(store, id)? {
				providers.push(provider);
			}
		}

		Ok(providers)
	}

	fn load_record(
		&self,
		store: &Store,
		id: &str,
	) -> Result<Option<StoredProvider>, ProviderStoreError> {
		let Some(bytes) = store.get(id.as_bytes()).map_err(|error| {
			ProviderStoreError::internal(format!(
				"Failed to read provider '{id}' from stronghold: {error}"
			))
		})?
		else {
			return Ok(None);
		};
		let provider = serde_json::from_slice(&bytes).map_err(|error| {
			ProviderStoreError::internal(format!(
				"Failed to parse provider '{id}': {error}"
			))
		})?;
		Ok(Some(provider))
	}

	fn save_record(
		&self,
		store: &Store,
		provider: &StoredProvider,
	) -> Result<(), ProviderStoreError> {
		let serialized = serde_json::to_vec(provider).map_err(|error| {
			ProviderStoreError::internal(format!(
				"Failed to serialize provider '{}': {error}",
				provider.id
			))
		})?;
		store
			.insert(provider.id.clone().into_bytes(), serialized, None)
			.map_err(|error| {
				ProviderStoreError::internal(format!(
					"Failed to write provider '{}' to stronghold: {error}",
					provider.id
				))
			})?;
		Ok(())
	}
}

fn default_snapshot_path() -> PathBuf {
	default_data_dir().join("providers.hold")
}

fn default_data_dir() -> PathBuf {
	if let Some(path) = dirs::data_local_dir() {
		return path.join("aghub");
	}

	if let Some(path) = dirs::data_dir() {
		return path.join("aghub");
	}

	if let Some(home) = dirs::home_dir() {
		return home.join(".aghub");
	}

	std::env::temp_dir().join("aghub")
}

fn validate_required(
	field: &str,
	value: String,
) -> Result<String, ProviderStoreError> {
	let value = value.trim();
	if value.is_empty() {
		return Err(ProviderStoreError::Validation(format!(
			"{field} is required"
		)));
	}
	Ok(value.to_string())
}

fn validate_optional(
	field: &str,
	value: Option<String>,
) -> Result<Option<String>, ProviderStoreError> {
	match value {
		Some(value) => Ok(Some(validate_required(field, value)?)),
		None => Ok(None),
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::path::Path;
	use tempfile::tempdir;

	fn store(tempdir: &Path) -> ProviderStore {
		ProviderStore::with_fixed_key(
			tempdir.join("providers.hold"),
			"test-provider-key",
		)
	}

	fn create_input(name: &str) -> CreateProviderInput {
		CreateProviderInput {
			name: name.to_string(),
			r#type: CredentialType::Openai,
			base: format!("https://{}.example.com/v1", name),
			key: Some("sk-test".to_string()),
		}
	}

	#[test]
	fn provider_store_supports_crud() {
		let tempdir = tempdir().unwrap();
		let mut store = store(tempdir.path());

		let created = store.create(create_input("alpha")).unwrap();
		assert!(created.has_key());

		let listed = store.list().unwrap();
		assert_eq!(listed, vec![created.clone()]);

		let fetched = store.get(&created.id).unwrap();
		assert_eq!(fetched, created);

		let updated = store
			.update(
				&created.id,
				UpdateProviderInput {
					name: Some("beta".to_string()),
					base: Some("https://beta.example.com/v1".to_string()),
					r#type: Some(CredentialType::Anthropic),
					key: None,
					clear_key: true,
				},
			)
			.unwrap();
		assert_eq!(updated.name, "beta");
		assert_eq!(updated.base, "https://beta.example.com/v1");
		assert_eq!(updated.r#type, CredentialType::Anthropic);
		assert!(!updated.has_key());

		store.delete(&created.id).unwrap();
		assert!(store.list().unwrap().is_empty());
	}

	#[test]
	fn provider_store_rejects_duplicate_names() {
		let tempdir = tempdir().unwrap();
		let mut store = store(tempdir.path());

		store.create(create_input("alpha")).unwrap();
		let error = store.create(create_input("Alpha")).unwrap_err();

		assert!(matches!(error, ProviderStoreError::Exists(name)
			if name == "Alpha"));
	}

	#[test]
	fn provider_store_requires_non_empty_base() {
		let tempdir = tempdir().unwrap();
		let mut store = store(tempdir.path());

		let error = store
			.create(CreateProviderInput {
				base: "   ".to_string(),
				..create_input("alpha")
			})
			.unwrap_err();

		assert!(matches!(error, ProviderStoreError::Validation(message)
			if message == "base URL is required"));
	}
}
