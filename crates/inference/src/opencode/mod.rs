//! OpenCode provider configuration adapter.
//!
//! OpenCode splits provider configuration and credentials. Provider metadata
//! lives in `opencode.json`, while credentials written by `/connect` live in
//! `~/.local/share/opencode/auth.json`.

mod files;
mod mapping;
mod schema;

#[cfg(test)]
mod tests;

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde_json::json;

use crate::agent::{
	AgentCredentialSupport, AgentProviderAdapter, AgentProviderBinding,
	AgentProviderCapabilities, AgentProviderCredential,
	AgentProviderDefaultSupport, AgentProviderSource, AgentProviderState,
	BuiltInProviderSupport,
};
use crate::error::Result;
use crate::model::InferenceProvider;

pub(super) const AGENT_ID: &str = "opencode";

/// Provider adapter for OpenCode.
#[derive(Debug, Clone)]
pub struct OpenCodeProviderAdapter {
	config_path: PathBuf,
	auth_path: PathBuf,
}

impl OpenCodeProviderAdapter {
	/// Create an adapter with explicit config and auth paths.
	pub fn new(
		config_path: impl Into<PathBuf>,
		auth_path: impl Into<PathBuf>,
	) -> Self {
		Self {
			config_path: config_path.into(),
			auth_path: auth_path.into(),
		}
	}

	/// Create an adapter for the global OpenCode config.
	pub fn global() -> Result<Self> {
		Ok(Self::new(
			files::default_global_config_path()?,
			files::default_auth_path()?,
		))
	}

	/// Create an adapter for a project-local `opencode.json`.
	pub fn for_project(project_root: impl AsRef<Path>) -> Result<Self> {
		Ok(Self::new(
			project_root.as_ref().join("opencode.json"),
			files::default_auth_path()?,
		))
	}

	/// Path to the OpenCode config file this adapter manages.
	pub fn config_path(&self) -> &Path {
		&self.config_path
	}

	/// Path to the OpenCode auth file this adapter manages.
	pub fn auth_path(&self) -> &Path {
		&self.auth_path
	}

	/// Add or replace an aghub provider in OpenCode.
	///
	/// This writes the provider definition to `opencode.json` and stores the
	/// API key in `auth.json`, matching OpenCode's `/connect` behavior.
	pub fn add_provider(
		&self,
		provider_id: &str,
		provider: &InferenceProvider,
		api_key: &str,
	) -> Result<AgentProviderBinding> {
		mapping::ensure_api_key(api_key)?;
		let provider_id = mapping::clean_provider_id(provider_id)?;
		let credential = AgentProviderCredential::AgentStore {
			id: Some(provider_id.clone()),
		};
		let binding = AgentProviderBinding::from_inventory(
			provider_id.clone(),
			provider,
			credential,
			AgentProviderSource::Custom,
		)?;

		let mut state = self.load_providers()?;
		state.providers.retain(|item| item.id != provider_id);
		state.providers.push(binding.clone());
		self.save_providers(&state)?;
		self.set_api_auth(&provider_id, api_key)?;

		Ok(binding)
	}

	/// Add a provider using a slug derived from its display name.
	pub fn add_inventory_provider(
		&self,
		provider: &InferenceProvider,
		api_key: &str,
	) -> Result<AgentProviderBinding> {
		let provider_id = mapping::provider_id_from_name(&provider.name);
		self.add_provider(&provider_id, provider, api_key)
	}

	/// Remove a provider definition and matching OpenCode auth entry.
	pub fn remove_provider(
		&self,
		provider_id: &str,
	) -> Result<AgentProviderBinding> {
		let provider_id = mapping::clean_provider_id(provider_id)?;
		let mut state = self.load_providers()?;
		let removed = state
			.providers
			.iter()
			.find(|provider| provider.id == provider_id)
			.cloned()
			.ok_or_else(|| {
				crate::error::InferenceProviderError::NotFound(
					provider_id.clone(),
				)
			})?;

		state
			.providers
			.retain(|provider| provider.id != provider_id);
		self.save_providers(&state)?;

		let mut auth = files::read_auth_values(&self.auth_path)?;
		if auth.remove(&provider_id).is_some() {
			files::write_auth_values(&self.auth_path, &auth)?;
		}

		Ok(removed)
	}

	fn set_api_auth(&self, provider_id: &str, api_key: &str) -> Result<()> {
		let mut auth = files::read_auth_values(&self.auth_path)?;
		auth.insert(
			provider_id.to_string(),
			json!({
				"type": "api",
				"key": api_key,
			}),
		);
		files::write_auth_values(&self.auth_path, &auth)
	}
}

impl AgentProviderAdapter for OpenCodeProviderAdapter {
	fn agent_id(&self) -> &'static str {
		AGENT_ID
	}

	fn capabilities(&self) -> AgentProviderCapabilities {
		AgentProviderCapabilities::registry(
			AgentProviderDefaultSupport::QUALIFIED_MODELS,
			AgentCredentialSupport::ENV_VAR_OR_AGENT_STORE,
			BuiltInProviderSupport::OVERRIDABLE,
		)
	}

	fn load_providers(&self) -> Result<AgentProviderState> {
		let config = files::read_config(&self.config_path)?;
		let auth = files::read_auth_values(&self.auth_path)?;
		let mut seen = HashSet::new();
		let mut providers = Vec::new();

		for (provider_id, provider) in &config.provider {
			seen.insert(provider_id.clone());
			providers.push(mapping::binding_from_config(
				provider_id,
				provider,
				&auth,
			)?);
		}

		for (provider_id, entry) in &auth {
			if seen.contains(provider_id) {
				continue;
			}
			providers.push(mapping::binding_from_auth(provider_id, entry));
		}

		Ok(AgentProviderState {
			providers,
			default_model: config
				.model
				.as_deref()
				.map(mapping::parse_opencode_model_selection),
			small_model: config
				.small_model
				.as_deref()
				.map(mapping::parse_opencode_model_selection),
		})
	}

	fn save_providers(&self, state: &AgentProviderState) -> Result<()> {
		state.validate(AGENT_ID, &self.capabilities())?;

		let mut config = files::read_config(&self.config_path)?;
		let original = config.provider.clone();
		let mut providers = std::collections::BTreeMap::new();

		for binding in &state.providers {
			if binding.source == AgentProviderSource::StoredCredential {
				continue;
			}
			let existing = original.get(&binding.id);
			let provider =
				mapping::provider_config_from_binding(binding, existing);
			providers.insert(binding.id.clone(), provider);
		}

		config.provider = providers;
		config.model =
			state.default_model.as_ref().map(mapping::format_selection);
		config.small_model =
			state.small_model.as_ref().map(mapping::format_selection);
		files::write_config(&self.config_path, config)
	}
}
