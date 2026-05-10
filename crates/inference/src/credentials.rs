//! API key storage for inference providers.

use crate::error::Result;

const KEYRING_SERVICE: &str = "aghub.inference_provider";

/// Stores provider API keys outside of `inference_providers.json`.
pub trait CredentialStore {
	/// Read a provider API key.
	fn get_api_key(&self, provider_id: &str) -> Result<Option<String>>;

	/// Store a provider API key.
	fn set_api_key(&self, provider_id: &str, api_key: &str) -> Result<()>;

	/// Delete a provider API key.
	fn delete_api_key(&self, provider_id: &str) -> Result<()>;
}

/// Platform-native keyring implementation.
///
/// OS keyring backends may not support concurrent writes reliably. Callers
/// sharing this store across threads should serialize access themselves.
#[derive(Debug, Clone, Copy, Default)]
pub struct NativeCredentialStore;

impl NativeCredentialStore {
	fn entry(provider_id: &str) -> Result<keyring::Entry> {
		let user = format!("provider:{provider_id}:api_key");
		Ok(keyring::Entry::new(KEYRING_SERVICE, &user)?)
	}
}

impl CredentialStore for NativeCredentialStore {
	fn get_api_key(&self, provider_id: &str) -> Result<Option<String>> {
		let entry = Self::entry(provider_id)?;
		match entry.get_password() {
			Ok(api_key) => Ok(Some(api_key)),
			Err(keyring::Error::NoEntry) => Ok(None),
			Err(error) => Err(error.into()),
		}
	}

	fn set_api_key(&self, provider_id: &str, api_key: &str) -> Result<()> {
		let entry = Self::entry(provider_id)?;
		entry.set_password(api_key)?;
		Ok(())
	}

	fn delete_api_key(&self, provider_id: &str) -> Result<()> {
		let entry = Self::entry(provider_id)?;
		match entry.delete_credential() {
			Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
			Err(error) => Err(error.into()),
		}
	}
}
