//! Codex provider configuration adapter.
//!
//! Codex stores provider configuration in `config.toml`. Current Codex
//! versions only support the Responses wire API for model providers.

mod files;
mod mapping;

#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};

use toml_edit::{value, DocumentMut, Item, Table};

use crate::agent::{
	AgentCredentialSupport, AgentModelSelection, AgentProviderAdapter,
	AgentProviderBinding, AgentProviderCapabilities, AgentProviderCredential,
	AgentProviderDefaultSupport, AgentProviderSource, AgentProviderState,
	BuiltInProviderSupport,
};
use crate::error::Result;
use crate::model::InferenceProvider;

pub(super) const AGENT_ID: &str = "codex";
pub const DEFAULT_PROFILE_ID: &str = "default";

/// Provider adapter for Codex.
#[derive(Debug, Clone)]
pub struct CodexProviderAdapter {
	config_path: PathBuf,
}

/// Effective provider selection for one Codex profile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodexProfileState {
	/// Stable UI/API id. The implicit top-level profile uses `default`.
	pub id: String,

	/// User-facing label.
	pub name: String,

	/// Whether this is the implicit top-level config profile.
	pub is_default: bool,

	/// Whether Codex currently selects this profile.
	pub is_active: bool,

	/// Effective provider id after profile overrides and top-level fallback.
	pub selected_provider_id: String,

	/// Effective model after profile overrides and top-level fallback.
	pub model: Option<String>,
}

/// Codex-specific provider state, including profile routing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodexProviderState {
	pub active_profile_id: String,
	pub profiles: Vec<CodexProfileState>,
	pub providers: Vec<AgentProviderBinding>,
}

impl CodexProviderAdapter {
	/// Create an adapter with an explicit `config.toml` path.
	pub fn new(config_path: impl Into<PathBuf>) -> Self {
		Self {
			config_path: config_path.into(),
		}
	}

	/// Create an adapter for the global Codex config.
	pub fn global() -> Result<Self> {
		Ok(Self::new(files::default_global_config_path()?))
	}

	/// Create an adapter for a project-local `.codex/config.toml`.
	pub fn for_project(project_root: impl AsRef<Path>) -> Self {
		Self::new(project_root.as_ref().join(".codex/config.toml"))
	}

	/// Path to the Codex config file this adapter manages.
	pub fn config_path(&self) -> &Path {
		&self.config_path
	}

	/// Load Codex providers with effective profile selection.
	pub fn load_profile_state(&self) -> Result<CodexProviderState> {
		let config = files::read_config(&self.config_path)?;
		let providers = providers_from_config(&config)?;
		let active_profile_id = active_profile_id(&config);
		let profiles = profile_ids(&config, &active_profile_id)
			.into_iter()
			.map(|profile_id| profile_state(&config, &profile_id))
			.collect();

		Ok(CodexProviderState {
			active_profile_id,
			profiles,
			providers,
		})
	}

	/// Select the active Codex profile.
	pub fn set_active_profile(
		&self,
		profile_id: &str,
	) -> Result<CodexProviderState> {
		let profile_id = clean_profile_id(profile_id)?;
		let mut config = files::read_config(&self.config_path)?;
		ensure_profile_exists(&config, &profile_id)?;

		if profile_id == DEFAULT_PROFILE_ID {
			config.as_table_mut().remove("profile");
		} else {
			config["profile"] = value(profile_id);
		}

		files::write_config(&self.config_path, &config)?;
		self.load_profile_state()
	}

	/// Set the provider used by one Codex profile.
	pub fn set_profile_provider(
		&self,
		profile_id: &str,
		provider_id: &str,
	) -> Result<CodexProviderState> {
		let profile_id = clean_profile_id(profile_id)?;
		let provider_id = clean_selected_provider_id(provider_id)?;
		let mut config = files::read_config(&self.config_path)?;
		ensure_profile_exists(&config, &profile_id)?;
		ensure_selectable_provider(&config, &provider_id)?;

		if profile_id == DEFAULT_PROFILE_ID {
			let table = config.as_table_mut();
			if provider_id == mapping::OPENAI_PROVIDER_ID {
				table.remove("model_provider");
			} else {
				table["model_provider"] = value(provider_id);
			}
		} else {
			let profile = profile_table_mut(&mut config, &profile_id)?;
			profile["model_provider"] = value(provider_id);
		}

		files::write_config(&self.config_path, &config)?;
		self.load_profile_state()
	}

	/// Add or replace an aghub provider in Codex.
	///
	/// Codex provider config is custom-provider only: built-in provider IDs
	/// such as `openai`, `ollama`, and `lmstudio` are immutable.
	pub fn add_provider(
		&self,
		provider_id: &str,
		provider: &InferenceProvider,
		api_key: &str,
	) -> Result<AgentProviderBinding> {
		mapping::ensure_responses_format(Some(provider.format))?;
		mapping::ensure_api_key(api_key)?;
		let provider_id = mapping::clean_provider_id(provider_id)?;
		let binding = AgentProviderBinding::from_inventory(
			provider_id.clone(),
			provider,
			AgentProviderCredential::Inline,
			AgentProviderSource::Custom,
		)?;

		let mut config = files::read_config(&self.config_path)?;
		upsert_provider(&mut config, &binding, Some(api_key))?;
		files::write_config(&self.config_path, &config)?;
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

	/// Update an existing Codex provider's display name and/or API key.
	pub fn update_provider(
		&self,
		provider_id: &str,
		name: Option<&str>,
		api_key: Option<&str>,
	) -> Result<AgentProviderBinding> {
		let provider_id = mapping::clean_provider_id(provider_id)?;
		let mut config = files::read_config(&self.config_path)?;
		let provider = provider_table(&config, &provider_id)?
			.cloned()
			.ok_or_else(|| {
				crate::error::InferenceProviderError::NotFound(
					provider_id.clone(),
				)
			})?;

		let name = name.map(mapping::clean_provider_name).transpose()?;
		if let Some(api_key) = api_key {
			mapping::ensure_api_key(api_key)?;
		}

		let mut binding = mapping::binding_from_table(&provider_id, &provider)?;
		mapping::ensure_responses_format(binding.format)?;
		if let Some(name) = name {
			binding.name = name;
		}
		upsert_provider(&mut config, &binding, api_key)?;
		files::write_config(&self.config_path, &config)?;

		Ok(self
			.load_providers()?
			.providers
			.into_iter()
			.find(|provider| provider.id == provider_id)
			.unwrap_or(binding))
	}

	/// Read an API key visible to Codex for a provider.
	pub fn api_key(&self, provider_id: &str) -> Result<Option<String>> {
		let provider_id = provider_id.trim().trim_end_matches('/').to_string();
		if mapping::is_reserved_provider_id(&provider_id) {
			return Ok(None);
		}
		let provider_id = mapping::clean_provider_id(&provider_id)?;
		let config = files::read_config(&self.config_path)?;
		let Some(table) = provider_table(&config, &provider_id)? else {
			return Ok(None);
		};
		Ok(mapping::api_key_from_table(table))
	}

	/// Remove a custom provider definition.
	pub fn remove_provider(
		&self,
		provider_id: &str,
	) -> Result<AgentProviderBinding> {
		let provider_id = mapping::clean_provider_id(provider_id)?;
		let mut config = files::read_config(&self.config_path)?;
		let removed = provider_table(&config, &provider_id)?
			.map(|table| mapping::binding_from_table(&provider_id, table))
			.transpose()?
			.ok_or_else(|| {
				crate::error::InferenceProviderError::NotFound(
					provider_id.clone(),
				)
			})?;

		let providers = providers_table_mut(&mut config)?;
		providers.remove(&provider_id);
		if config
			.get("model_provider")
			.and_then(Item::as_str)
			.is_some_and(|value| value == provider_id)
		{
			config.as_table_mut().remove("model_provider");
		}
		clear_profile_provider_references(&mut config, &provider_id);
		files::write_config(&self.config_path, &config)?;
		Ok(removed)
	}
}

impl AgentProviderAdapter for CodexProviderAdapter {
	fn agent_id(&self) -> &'static str {
		AGENT_ID
	}

	fn capabilities(&self) -> AgentProviderCapabilities {
		AgentProviderCapabilities::registry(
			AgentProviderDefaultSupport::PROVIDER_AND_MODEL,
			AgentCredentialSupport::ENV_VAR_INLINE_OR_AGENT_STORE,
			BuiltInProviderSupport::IMMUTABLE,
		)
	}

	fn load_providers(&self) -> Result<AgentProviderState> {
		let config = files::read_config(&self.config_path)?;

		Ok(AgentProviderState {
			providers: providers_from_config(&config)?,
			default_model: default_model_selection(&config),
			small_model: None,
		})
	}

	fn save_providers(&self, state: &AgentProviderState) -> Result<()> {
		state.validate(AGENT_ID, &self.capabilities())?;
		let mut config = files::read_config(&self.config_path)?;
		let existing = config
			.get("model_providers")
			.and_then(Item::as_table)
			.cloned()
			.unwrap_or_default();
		let providers = providers_table_mut(&mut config)?;
		providers.clear();

		for binding in &state.providers {
			if binding.source != AgentProviderSource::Custom {
				continue;
			}
			mapping::ensure_responses_format(binding.format)?;
			let existing_table =
				existing.get(&binding.id).and_then(Item::as_table);
			let provider = mapping::provider_table_from_binding(
				binding,
				None,
				existing_table,
			);
			providers.insert(&binding.id, Item::Table(provider));
		}

		if let Some(selection) = &state.default_model {
			if let Some(provider_id) = &selection.provider_id {
				config["model_provider"] = value(provider_id.clone());
			}
			config["model"] = value(selection.model_id.clone());
		}

		files::write_config(&self.config_path, &config)
	}
}

fn providers_from_config(
	config: &DocumentMut,
) -> Result<Vec<AgentProviderBinding>> {
	let mut providers = vec![mapping::built_in_openai_binding()];

	if let Some(model_providers) =
		config.get("model_providers").and_then(Item::as_table)
	{
		for (provider_id, item) in model_providers {
			let Some(provider) = item.as_table() else {
				continue;
			};
			providers.push(mapping::binding_from_table(provider_id, provider)?);
		}
	}

	Ok(providers)
}

fn active_profile_id(config: &DocumentMut) -> String {
	config
		.get("profile")
		.and_then(Item::as_str)
		.map(ToString::to_string)
		.unwrap_or_else(|| DEFAULT_PROFILE_ID.to_string())
}

fn profile_ids(config: &DocumentMut, active_profile_id: &str) -> Vec<String> {
	let mut ids = vec![DEFAULT_PROFILE_ID.to_string()];
	if let Some(profiles) = config.get("profiles").and_then(Item::as_table) {
		for (profile_id, item) in profiles {
			if item.as_table().is_some()
				&& profile_id != DEFAULT_PROFILE_ID
				&& !ids.iter().any(|id| id == profile_id)
			{
				ids.push(profile_id.to_string());
			}
		}
	}
	if active_profile_id != DEFAULT_PROFILE_ID
		&& !ids.iter().any(|id| id == active_profile_id)
	{
		ids.push(active_profile_id.to_string());
	}
	ids
}

fn profile_state(config: &DocumentMut, profile_id: &str) -> CodexProfileState {
	let is_default = profile_id == DEFAULT_PROFILE_ID;
	let active_profile_id = active_profile_id(config);
	CodexProfileState {
		id: profile_id.to_string(),
		name: if is_default {
			"Default".to_string()
		} else {
			profile_id.to_string()
		},
		is_default,
		is_active: active_profile_id == profile_id,
		selected_provider_id: effective_profile_value(
			config,
			profile_id,
			"model_provider",
		)
		.unwrap_or_else(|| mapping::OPENAI_PROVIDER_ID.to_string()),
		model: effective_profile_value(config, profile_id, "model"),
	}
}

fn effective_profile_value(
	config: &DocumentMut,
	profile_id: &str,
	key: &str,
) -> Option<String> {
	named_profile_table(config, profile_id)
		.and_then(|profile| profile.get(key))
		.and_then(Item::as_str)
		.or_else(|| config.get(key).and_then(Item::as_str))
		.map(ToString::to_string)
}

fn default_model_selection(
	config: &DocumentMut,
) -> Option<AgentModelSelection> {
	let model = config.get("model")?.as_str()?.to_string();
	let provider = config
		.get("model_provider")
		.and_then(Item::as_str)
		.map(ToString::to_string);
	Some(match provider {
		Some(provider) => AgentModelSelection::provider_model(provider, model),
		None => AgentModelSelection::model(model),
	})
}

fn upsert_provider(
	config: &mut DocumentMut,
	binding: &AgentProviderBinding,
	api_key: Option<&str>,
) -> Result<()> {
	mapping::ensure_responses_format(binding.format)?;
	let existing = provider_table(config, &binding.id)?.cloned();
	let provider = mapping::provider_table_from_binding(
		binding,
		api_key,
		existing.as_ref(),
	);
	providers_table_mut(config)?.insert(&binding.id, Item::Table(provider));
	Ok(())
}

fn provider_table<'a>(
	config: &'a DocumentMut,
	provider_id: &str,
) -> Result<Option<&'a Table>> {
	Ok(config
		.get("model_providers")
		.and_then(Item::as_table)
		.and_then(|providers| providers.get(provider_id))
		.and_then(Item::as_table))
}

fn providers_table_mut(config: &mut DocumentMut) -> Result<&mut Table> {
	if !config.as_table().contains_key("model_providers") {
		config["model_providers"] = Item::Table(Table::new());
	}
	config
		.get_mut("model_providers")
		.and_then(Item::as_table_mut)
		.ok_or_else(|| {
			files::invalid_config(
				Path::new("config.toml"),
				"`model_providers` must be a table",
			)
		})
}

fn named_profile_table<'a>(
	config: &'a DocumentMut,
	profile_id: &str,
) -> Option<&'a Table> {
	if profile_id == DEFAULT_PROFILE_ID {
		return None;
	}
	config
		.get("profiles")
		.and_then(Item::as_table)
		.and_then(|profiles| profiles.get(profile_id))
		.and_then(Item::as_table)
}

fn profile_table_mut<'a>(
	config: &'a mut DocumentMut,
	profile_id: &str,
) -> Result<&'a mut Table> {
	let Some(profiles) = config.get_mut("profiles") else {
		return Err(crate::error::InferenceProviderError::NotFound(format!(
			"codex profile {profile_id}"
		)));
	};
	let profiles = profiles.as_table_mut().ok_or_else(|| {
		files::invalid_config(
			Path::new("config.toml"),
			"`profiles` must be a table",
		)
	})?;
	let Some(profile) = profiles.get_mut(profile_id) else {
		return Err(crate::error::InferenceProviderError::NotFound(format!(
			"codex profile {profile_id}"
		)));
	};
	profile.as_table_mut().ok_or_else(|| {
		files::invalid_config(
			Path::new("config.toml"),
			format!("`profiles.{profile_id}` must be a table"),
		)
	})
}

fn clean_profile_id(profile_id: &str) -> Result<String> {
	let profile_id = profile_id.trim().to_string();
	if profile_id.is_empty() {
		Err(crate::error::InferenceProviderError::EmptyAgentProviderId)
	} else {
		Ok(profile_id)
	}
}

fn clean_selected_provider_id(provider_id: &str) -> Result<String> {
	let provider_id = provider_id.trim().trim_end_matches('/').to_string();
	if provider_id.is_empty() {
		Err(crate::error::InferenceProviderError::EmptyAgentProviderId)
	} else {
		Ok(provider_id)
	}
}

fn ensure_profile_exists(config: &DocumentMut, profile_id: &str) -> Result<()> {
	if profile_id == DEFAULT_PROFILE_ID
		|| named_profile_table(config, profile_id).is_some()
	{
		Ok(())
	} else {
		Err(crate::error::InferenceProviderError::NotFound(format!(
			"codex profile {profile_id}"
		)))
	}
}

fn ensure_selectable_provider(
	config: &DocumentMut,
	provider_id: &str,
) -> Result<()> {
	if provider_id.eq_ignore_ascii_case(mapping::OPENAI_PROVIDER_ID)
		|| provider_table(config, provider_id)?.is_some()
	{
		Ok(())
	} else {
		Err(crate::error::InferenceProviderError::NotFound(
			provider_id.to_string(),
		))
	}
}

fn clear_profile_provider_references(
	config: &mut DocumentMut,
	provider_id: &str,
) {
	let Some(profiles) =
		config.get_mut("profiles").and_then(Item::as_table_mut)
	else {
		return;
	};
	for (_, item) in profiles.iter_mut() {
		let Some(profile) = item.as_table_mut() else {
			continue;
		};
		if profile
			.get("model_provider")
			.and_then(Item::as_str)
			.is_some_and(|value| value == provider_id)
		{
			profile.remove("model_provider");
		}
	}
}
