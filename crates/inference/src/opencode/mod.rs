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

use serde_json::{json, Value};

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
		self.set_api_auth(&provider_id, api_key)?;
		self.save_providers(&state)?;

		Ok(binding)
	}

	/// Add a provider using a slug derived from its stable key.
	pub fn add_inventory_provider(
		&self,
		provider: &InferenceProvider,
		api_key: &str,
	) -> Result<AgentProviderBinding> {
		let provider_id = mapping::provider_id_from_name(&provider.name);
		self.add_provider(&provider_id, provider, api_key)
	}

	/// Update an existing OpenCode provider's display name and/or API key.
	pub fn update_provider(
		&self,
		provider_id: &str,
		name: Option<&str>,
		api_key: Option<&str>,
	) -> Result<AgentProviderBinding> {
		let provider_id = mapping::clean_provider_id(provider_id)?;
		let current = self
			.load_providers()?
			.providers
			.into_iter()
			.find(|provider| provider.id == provider_id)
			.ok_or_else(|| {
				crate::error::InferenceProviderError::NotFound(
					provider_id.clone(),
				)
			})?;

		let name = name.map(mapping::clean_provider_name).transpose()?;
		if let Some(api_key) = api_key {
			mapping::ensure_api_key(api_key)?;
		}

		if let Some(api_key) = api_key {
			self.set_api_auth(&provider_id, api_key)?;
		}

		if let Some(name) = name {
			let mut config = files::read_config(&self.config_path)?;
			config.provider.entry(provider_id.clone()).or_default().name =
				Some(name);
			files::write_config(&self.config_path, config)?;
		}

		Ok(self
			.load_providers()?
			.providers
			.into_iter()
			.find(|provider| provider.id == provider_id)
			.unwrap_or(current))
	}

	/// Read an API key visible to OpenCode for a provider.
	pub fn api_key(&self, provider_id: &str) -> Result<Option<String>> {
		let provider_id = mapping::clean_provider_id(provider_id)?;
		let auth = files::read_auth_values(&self.auth_path)?;
		if let Some(api_key) =
			auth.get(&provider_id).and_then(auth_entry_api_key)
		{
			return Ok(Some(api_key.to_string()));
		}

		let config = files::read_config(&self.config_path)?;
		let Some(api_key) = config
			.provider
			.get(&provider_id)
			.and_then(|provider| provider.options.get("apiKey"))
			.and_then(Value::as_str)
		else {
			return Ok(None);
		};

		if let Some(env_name) = parse_env_var_ref(api_key) {
			return Ok(std::env::var(env_name).ok());
		}

		Ok(Some(api_key.to_string()))
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

fn auth_entry_api_key(entry: &Value) -> Option<&str> {
	if entry.get("type").and_then(Value::as_str) == Some("api") {
		entry.get("key").and_then(Value::as_str)
	} else {
		None
	}
}

fn parse_env_var_ref(value: &str) -> Option<&str> {
	let name = value.strip_prefix("{env:")?.strip_suffix('}')?.trim();
	if name.is_empty() {
		None
	} else {
		Some(name)
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
