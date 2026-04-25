//! CRUD storage for inference providers.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::credentials::{CredentialStore, NativeCredentialStore};
use crate::error::{InferenceProviderError, Result};
use crate::model::{
	CreateInferenceProvider, InferenceProvider, UpdateInferenceProvider,
};

/// File name under the Tauri app data directory.
pub const INFERENCE_PROVIDERS_FILE: &str = "inference_providers.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct InferenceProvidersFile {
	#[serde(default)]
	providers: Vec<InferenceProvider>,
}

/// CRUD interface for inference provider metadata and API keys.
pub trait InferenceProviderRepository {
	/// List all providers.
	fn list(&self) -> Result<Vec<InferenceProvider>>;

	/// Get one provider by ID.
	fn get(&self, id: &str) -> Result<InferenceProvider>;

	/// Create a provider and store its API key in the native credential store.
	fn create(
		&self,
		input: CreateInferenceProvider,
	) -> Result<InferenceProvider>;

	/// Update provider metadata and optionally replace its API key.
	fn update(
		&self,
		id: &str,
		input: UpdateInferenceProvider,
	) -> Result<InferenceProvider>;

	/// Delete provider metadata and its API key.
	fn delete(&self, id: &str) -> Result<InferenceProvider>;

	/// Read the provider API key from the native credential store.
	fn get_api_key(&self, id: &str) -> Result<Option<String>>;

	/// Replace the provider API key in the native credential store.
	fn set_api_key(&self, id: &str, api_key: &str) -> Result<()>;

	/// Delete the provider API key from the native credential store.
	fn delete_api_key(&self, id: &str) -> Result<()>;
}

/// File-backed inference provider store.
#[derive(Debug, Clone)]
pub struct InferenceProviderStore<C = NativeCredentialStore> {
	app_data_dir: PathBuf,
	credentials: C,
}

impl InferenceProviderStore<NativeCredentialStore> {
	/// Create a store rooted at a Tauri app data directory path.
	pub fn new(app_data_dir: impl Into<PathBuf>) -> Self {
		Self::with_credentials(app_data_dir, NativeCredentialStore)
	}

	/// Create a store from the current Tauri app handle.
	#[cfg(feature = "tauri")]
	pub fn from_tauri<R: tauri::Runtime>(
		app: &tauri::AppHandle<R>,
	) -> Result<Self> {
		use tauri::Manager;

		let app_data_dir = app.path().app_data_dir().map_err(|error| {
			InferenceProviderError::AppDataDir(error.to_string())
		})?;
		Ok(Self::new(app_data_dir))
	}
}

impl<C> InferenceProviderStore<C> {
	/// Create a store with an explicit credential store implementation.
	pub fn with_credentials(
		app_data_dir: impl Into<PathBuf>,
		credentials: C,
	) -> Self {
		Self {
			app_data_dir: app_data_dir.into(),
			credentials,
		}
	}

	/// App data directory used by this store.
	pub fn app_data_dir(&self) -> &Path {
		&self.app_data_dir
	}

	/// Full path to `inference_providers.json`.
	pub fn file_path(&self) -> PathBuf {
		self.app_data_dir.join(INFERENCE_PROVIDERS_FILE)
	}
}

impl<C: CredentialStore> InferenceProviderStore<C> {
	fn read_file(&self) -> Result<InferenceProvidersFile> {
		let path = self.file_path();
		let contents = match fs::read_to_string(&path) {
			Ok(contents) => contents,
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
				return Ok(InferenceProvidersFile::default());
			}
			Err(error) => return Err(error.into()),
		};

		if contents.trim().is_empty() {
			return Ok(InferenceProvidersFile::default());
		}

		Ok(serde_json::from_str(&contents)?)
	}

	fn write_file(&self, file: &InferenceProvidersFile) -> Result<()> {
		let path = self.file_path();
		if let Some(parent) = path.parent() {
			fs::create_dir_all(parent)?;
		}

		let json = serde_json::to_string_pretty(file)?;
		fs::write(path, json)?;
		Ok(())
	}

	fn find_index(providers: &[InferenceProvider], id: &str) -> Result<usize> {
		providers
			.iter()
			.position(|provider| provider.id == id)
			.ok_or_else(|| InferenceProviderError::NotFound(id.to_string()))
	}

	fn ensure_unique_name(
		providers: &[InferenceProvider],
		name: &str,
		ignore_id: Option<&str>,
	) -> Result<()> {
		let exists = providers.iter().any(|provider| {
			ignore_id != Some(provider.id.as_str())
				&& provider.name.eq_ignore_ascii_case(name)
		});

		if exists {
			Err(InferenceProviderError::AlreadyExists(name.to_string()))
		} else {
			Ok(())
		}
	}
}

impl<C: CredentialStore> InferenceProviderRepository
	for InferenceProviderStore<C>
{
	fn list(&self) -> Result<Vec<InferenceProvider>> {
		Ok(self.read_file()?.providers)
	}

	fn get(&self, id: &str) -> Result<InferenceProvider> {
		let file = self.read_file()?;
		let index = Self::find_index(&file.providers, id)?;
		Ok(file.providers[index].clone())
	}

	fn create(
		&self,
		input: CreateInferenceProvider,
	) -> Result<InferenceProvider> {
		let name = clean_name(&input.name)?;
		let api_base_url = clean_api_base_url(&input.api_base_url)?;
		ensure_api_key(&input.api_key)?;

		let mut file = self.read_file()?;
		Self::ensure_unique_name(&file.providers, &name, None)?;

		let provider = InferenceProvider {
			id: uuid::Uuid::new_v4().to_string(),
			name,
			format: input.format,
			api_base_url,
		};

		self.credentials.set_api_key(&provider.id, &input.api_key)?;
		file.providers.push(provider.clone());
		if let Err(error) = self.write_file(&file) {
			let _ = self.credentials.delete_api_key(&provider.id);
			return Err(error);
		}

		Ok(provider)
	}

	fn update(
		&self,
		id: &str,
		input: UpdateInferenceProvider,
	) -> Result<InferenceProvider> {
		let mut file = self.read_file()?;
		let index = Self::find_index(&file.providers, id)?;

		if let Some(ref name) = input.name {
			let name = clean_name(name)?;
			Self::ensure_unique_name(&file.providers, &name, Some(id))?;
			file.providers[index].name = name;
		}

		if let Some(format) = input.format {
			file.providers[index].format = format;
		}

		if let Some(ref api_base_url) = input.api_base_url {
			file.providers[index].api_base_url =
				clean_api_base_url(api_base_url)?;
		}

		let previous_api_key = match input.api_key.as_ref() {
			Some(api_key) => {
				ensure_api_key(api_key)?;
				let previous = self.credentials.get_api_key(id)?;
				self.credentials.set_api_key(id, api_key)?;
				Some(previous)
			}
			None => None,
		};

		if let Err(error) = self.write_file(&file) {
			if let Some(previous_api_key) = previous_api_key {
				match previous_api_key {
					Some(api_key) => {
						let _ = self.credentials.set_api_key(id, &api_key);
					}
					None => {
						let _ = self.credentials.delete_api_key(id);
					}
				}
			}
			return Err(error);
		}

		Ok(file.providers[index].clone())
	}

	fn delete(&self, id: &str) -> Result<InferenceProvider> {
		let mut file = self.read_file()?;
		let index = Self::find_index(&file.providers, id)?;
		let provider = file.providers.remove(index);
		let previous_api_key = self.credentials.get_api_key(id)?;

		self.credentials.delete_api_key(id)?;
		if let Err(error) = self.write_file(&file) {
			if let Some(api_key) = previous_api_key {
				let _ = self.credentials.set_api_key(id, &api_key);
			}
			return Err(error);
		}

		Ok(provider)
	}

	fn get_api_key(&self, id: &str) -> Result<Option<String>> {
		self.get(id)?;
		self.credentials.get_api_key(id)
	}

	fn set_api_key(&self, id: &str, api_key: &str) -> Result<()> {
		self.get(id)?;
		ensure_api_key(api_key)?;
		self.credentials.set_api_key(id, api_key)
	}

	fn delete_api_key(&self, id: &str) -> Result<()> {
		self.get(id)?;
		self.credentials.delete_api_key(id)
	}
}

fn clean_name(name: &str) -> Result<String> {
	let name = name.trim();
	if name.is_empty() {
		Err(InferenceProviderError::EmptyName)
	} else {
		Ok(name.to_string())
	}
}

fn ensure_api_key(api_key: &str) -> Result<()> {
	if api_key.trim().is_empty() {
		Err(InferenceProviderError::EmptyApiKey)
	} else {
		Ok(())
	}
}

fn clean_api_base_url(api_base_url: &str) -> Result<String> {
	let api_base_url = api_base_url.trim();
	if api_base_url.is_empty() {
		Err(InferenceProviderError::EmptyApiBaseUrl)
	} else {
		Ok(api_base_url.to_string())
	}
}

#[cfg(test)]
mod tests {
	use std::collections::HashMap;
	use std::sync::{Arc, Mutex};

	use super::*;
	use crate::model::InferenceProviderFormat;

	#[derive(Debug, Clone, Default)]
	struct MemoryCredentialStore {
		values: Arc<Mutex<HashMap<String, String>>>,
	}

	impl CredentialStore for MemoryCredentialStore {
		fn get_api_key(&self, provider_id: &str) -> Result<Option<String>> {
			Ok(self.values.lock().unwrap().get(provider_id).cloned())
		}

		fn set_api_key(&self, provider_id: &str, api_key: &str) -> Result<()> {
			self.values
				.lock()
				.unwrap()
				.insert(provider_id.to_string(), api_key.to_string());
			Ok(())
		}

		fn delete_api_key(&self, provider_id: &str) -> Result<()> {
			self.values.lock().unwrap().remove(provider_id);
			Ok(())
		}
	}

	fn store() -> (
		tempfile::TempDir,
		InferenceProviderStore<MemoryCredentialStore>,
	) {
		let temp = tempfile::tempdir().unwrap();
		let store = InferenceProviderStore::with_credentials(
			temp.path(),
			MemoryCredentialStore::default(),
		);
		(temp, store)
	}

	#[test]
	fn test_list_missing_file_is_empty() {
		let (_temp, store) = store();

		assert!(store.list().unwrap().is_empty());
	}

	#[test]
	fn test_create_stores_metadata_without_api_key() {
		let (_temp, store) = store();

		let provider = store
			.create(CreateInferenceProvider {
				name: "OpenAI".to_string(),
				format: InferenceProviderFormat::OpenAiResponses,
				api_base_url: "https://api.openai.com/v1".to_string(),
				api_key: "sk-test".to_string(),
			})
			.unwrap();

		let contents = fs::read_to_string(store.file_path()).unwrap();
		assert!(contents.contains("OpenAI"));
		assert!(contents.contains("openai_responses"));
		assert!(contents.contains("https://api.openai.com/v1"));
		assert!(!contents.contains("sk-test"));
		assert_eq!(
			store.get_api_key(&provider.id).unwrap(),
			Some("sk-test".to_string())
		);
	}

	#[test]
	fn test_update_provider_metadata_and_api_key() {
		let (_temp, store) = store();
		let provider = store
			.create(CreateInferenceProvider {
				name: "Anthropic".to_string(),
				format: InferenceProviderFormat::Anthropic,
				api_base_url: "https://api.anthropic.com/v1".to_string(),
				api_key: "first-key".to_string(),
			})
			.unwrap();

		let updated = store
			.update(
				&provider.id,
				UpdateInferenceProvider {
					name: Some("Claude".to_string()),
					format: Some(InferenceProviderFormat::OpenAiCompletions),
					api_base_url: Some(
						"https://gateway.example.com/v1".to_string(),
					),
					api_key: Some("second-key".to_string()),
				},
			)
			.unwrap();

		assert_eq!(updated.name, "Claude");
		assert_eq!(updated.format, InferenceProviderFormat::OpenAiCompletions);
		assert_eq!(updated.api_base_url, "https://gateway.example.com/v1");
		assert_eq!(
			store.get_api_key(&provider.id).unwrap(),
			Some("second-key".to_string())
		);
	}

	#[test]
	fn test_delete_provider_and_api_key() {
		let (_temp, store) = store();
		let provider = store
			.create(CreateInferenceProvider {
				name: "Anthropic".to_string(),
				format: InferenceProviderFormat::Anthropic,
				api_base_url: "https://api.anthropic.com/v1".to_string(),
				api_key: "secret".to_string(),
			})
			.unwrap();

		let deleted = store.delete(&provider.id).unwrap();

		assert_eq!(deleted.id, provider.id);
		assert!(store.list().unwrap().is_empty());
		assert_eq!(store.credentials.get_api_key(&provider.id).unwrap(), None);
	}

	#[test]
	fn test_duplicate_name_is_rejected() {
		let (_temp, store) = store();
		store
			.create(CreateInferenceProvider {
				name: "OpenAI".to_string(),
				format: InferenceProviderFormat::OpenAiResponses,
				api_base_url: "https://api.openai.com/v1".to_string(),
				api_key: "first".to_string(),
			})
			.unwrap();

		let error = store
			.create(CreateInferenceProvider {
				name: "openai".to_string(),
				format: InferenceProviderFormat::OpenAiCompletions,
				api_base_url: "https://gateway.example.com/v1".to_string(),
				api_key: "second".to_string(),
			})
			.unwrap_err();

		assert!(matches!(error, InferenceProviderError::AlreadyExists(_)));
	}

	#[test]
	fn test_empty_api_base_url_is_rejected() {
		let (_temp, store) = store();

		let error = store
			.create(CreateInferenceProvider {
				name: "OpenAI".to_string(),
				format: InferenceProviderFormat::OpenAiResponses,
				api_base_url: " ".to_string(),
				api_key: "secret".to_string(),
			})
			.unwrap_err();

		assert!(matches!(error, InferenceProviderError::EmptyApiBaseUrl));
	}
}
