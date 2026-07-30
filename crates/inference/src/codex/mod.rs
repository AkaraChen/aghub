//! Codex provider configuration adapter.
//!
//! Codex stores provider configuration in `config.toml`. Current Codex
//! versions only support the Responses wire API for model providers.

mod files;
mod mapping;

#[cfg(test)]
mod tests;

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use toml_edit::{value, DocumentMut, Item, Table};

use crate::agent::{
	AgentCredentialSupport, AgentModelSelection, AgentProviderAdapter,
	AgentProviderBinding, AgentProviderCapabilities, AgentProviderCredential,
	AgentProviderDefaultSupport, AgentProviderSource, AgentProviderState,
	BuiltInProviderSupport,
};
use crate::credentials::CredentialStore;
use crate::error::Result;
use crate::model::InferenceProvider;
use crate::store::{
	AgentProviderBindingRow, InferenceProviderRepository,
	InferenceProviderStore,
};

pub(super) const AGENT_ID: &str = "codex";
pub const DEFAULT_PROFILE_ID: &str = "default";

const GENERATED_MODEL_CATALOG_PATH: &str = "model-catalogs/models.json";
const CODEX_MODEL_CATALOG_TEMPLATE_SLUG: &str = "gpt-5.5";
const DEFAULT_CODEX_CONTEXT_WINDOW: u64 = 128_000;

/// Provider adapter for Codex.
#[derive(Debug, Clone)]
pub struct CodexProviderAdapter {
	config_path: PathBuf,
	auth_path: PathBuf,
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
		let config_path = config_path.into();
		let auth_path = config_path
			.parent()
			.map(|parent| parent.join("auth.json"))
			.unwrap_or_else(|| PathBuf::from("auth.json"));
		Self {
			config_path,
			auth_path,
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

	/// Path to the Codex auth file paired with this config.
	pub fn auth_path(&self) -> &Path {
		&self.auth_path
	}

	/// Load Codex providers with effective profile selection.
	///
	/// Merges providers from three sources:
	/// 1. OpenAI built-in provider
	/// 2. config.toml `[model_providers]` (marked as External)
	/// 3. Binding table providers (marked as Custom)
	pub fn load_profile_state<C: CredentialStore>(
		&self,
		store: &InferenceProviderStore<C>,
	) -> Result<CodexProviderState> {
		let config = files::read_config(&self.config_path)?;
		let providers = self.load_all_providers(store, &config)?;
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
	pub fn set_active_profile<C: CredentialStore>(
		&self,
		store: &InferenceProviderStore<C>,
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

		let all_providers = self.load_all_providers(store, &config)?;
		self.sync_active_model_catalog(&mut config, &all_providers)?;
		files::write_config(&self.config_path, &config)?;
		self.load_profile_state(store)
	}

	/// Set the provider used by Codex's current active profile.
	pub fn set_active_provider<C: CredentialStore>(
		&self,
		store: &InferenceProviderStore<C>,
		provider_id: &str,
	) -> Result<CodexProviderState> {
		let config = files::read_config(&self.config_path)?;
		let active_profile_id = active_profile_id(&config);
		self.set_profile_provider(store, &active_profile_id, provider_id)
	}

	/// Set the provider and optional model for Codex's active profile.
	pub fn set_active_provider_model<C: CredentialStore>(
		&self,
		store: &InferenceProviderStore<C>,
		provider_id: &str,
		model: Option<Option<&str>>,
	) -> Result<CodexProviderState> {
		let config = files::read_config(&self.config_path)?;
		let active_profile_id = active_profile_id(&config);
		self.set_profile_provider_model(
			store,
			&active_profile_id,
			provider_id,
			model,
		)
	}

	/// Clear the current active-provider override and fall back to OpenAI.
	pub fn clear_active_provider<C: CredentialStore>(
		&self,
		store: &InferenceProviderStore<C>,
	) -> Result<CodexProviderState> {
		self.set_active_provider(store, mapping::OPENAI_PROVIDER_ID)
	}

	/// Set the provider used by one Codex profile.
	pub fn set_profile_provider<C: CredentialStore>(
		&self,
		store: &InferenceProviderStore<C>,
		profile_id: &str,
		provider_id: &str,
	) -> Result<CodexProviderState> {
		self.set_profile_provider_model(store, profile_id, provider_id, None)
	}

	/// Set the provider and optional model used by one Codex profile.
	pub fn set_profile_provider_model<C: CredentialStore>(
		&self,
		store: &InferenceProviderStore<C>,
		profile_id: &str,
		provider_id: &str,
		model: Option<Option<&str>>,
	) -> Result<CodexProviderState> {
		let profile_id = clean_profile_id(profile_id)?;
		let provider_id = clean_selected_provider_id(provider_id)?;
		let mut config = files::read_config(&self.config_path)?;
		ensure_profile_exists(&config, &profile_id)?;

		// Check if provider is selectable (built-in, config.toml, or binding)
		let all_providers = self.load_all_providers(store, &config)?;
		let current_provider_id =
			effective_profile_value(&config, &profile_id, "model_provider")
				.unwrap_or_else(|| mapping::OPENAI_PROVIDER_ID.to_string());
		let provider_changed =
			!current_provider_id.eq_ignore_ascii_case(&provider_id);
		let is_selectable = provider_id
			.eq_ignore_ascii_case(mapping::OPENAI_PROVIDER_ID)
			|| all_providers.iter().any(|p| p.id == provider_id);
		if !is_selectable {
			return Err(crate::error::InferenceProviderError::NotFound(
				provider_id.to_string(),
			));
		}
		let selected_provider = all_providers
			.iter()
			.find(|binding| binding.id == provider_id);
		let replacement_model = match model {
			Some(Some(model)) => {
				let model = clean_selected_model(model)?;
				if let Some(provider) = selected_provider {
					ensure_provider_model(provider, &model)?;
				}
				Some(Some(model))
			}
			Some(None) => Some(None),
			None if provider_changed
				&& !provider_id
					.eq_ignore_ascii_case(mapping::OPENAI_PROVIDER_ID) =>
			{
				Some(
					selected_provider
						.and_then(|binding| binding.models.first())
						.map(|model| model.id.clone()),
				)
			}
			None if provider_changed => Some(None),
			None => None,
		};

		if profile_id == DEFAULT_PROFILE_ID {
			let table = config.as_table_mut();
			if provider_id == mapping::OPENAI_PROVIDER_ID {
				table.remove("model_provider");
			} else {
				table["model_provider"] = value(provider_id.clone());
			}
		} else {
			let profile = profile_table_mut(&mut config, &profile_id)?;
			profile["model_provider"] = value(provider_id.clone());
		}
		if let Some(replacement_model) = replacement_model {
			if profile_id == DEFAULT_PROFILE_ID {
				if let Some(model_id) = replacement_model {
					config["model"] = value(model_id);
				} else {
					config.as_table_mut().remove("model");
				}
			} else {
				let profile = profile_table_mut(&mut config, &profile_id)?;
				if let Some(model_id) = replacement_model {
					profile["model"] = value(model_id);
				} else {
					profile.remove("model");
				}
			}
		}

		// If selecting a binding provider, also write its details to config.toml
		if let Some(binding) =
			all_providers.iter().find(|p| p.id == provider_id)
		{
			if binding.source == AgentProviderSource::Custom {
				let binding_row = store
					.list_agent_bindings(AGENT_ID)?
					.into_iter()
					.find(|row| row.id == provider_id);
				if let Some(row) = binding_row {
					let (provider, api_key) =
						store.get_with_api_key(&row.inference_provider_id)?;
					let credential = if api_key.is_some() {
						AgentProviderCredential::Inline
					} else {
						AgentProviderCredential::None
					};
					let current_binding = AgentProviderBinding::from_inventory(
						row.id,
						&provider,
						credential,
						AgentProviderSource::Custom,
					)?;
					upsert_provider(
						&mut config,
						&current_binding,
						api_key.as_deref(),
					)?;
				} else {
					upsert_provider(&mut config, binding, None)?;
				}
			}
		}

		self.sync_active_model_catalog(&mut config, &all_providers)?;
		files::write_config(&self.config_path, &config)?;
		self.load_profile_state(store)
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
		let mut binding = AgentProviderBinding::from_inventory(
			provider_id.clone(),
			provider,
			AgentProviderCredential::Inline,
			AgentProviderSource::Custom,
		)?;
		if let Some(api_base_url) = binding.api_base_url.as_mut() {
			*api_base_url = normalize_inventory_base_url(api_base_url);
		}

		let mut config = files::read_config(&self.config_path)?;
		upsert_provider(&mut config, &binding, Some(api_key))?;
		self.sync_provider_model_catalog_if_active(&mut config, &binding)?;
		files::write_config(&self.config_path, &config)?;
		Ok(binding)
	}

	/// Add a provider using its stable latin key.
	///
	/// Creates a binding in the database and optionally writes to config.toml
	/// if the provider should be active.
	pub fn add_inventory_provider<C: CredentialStore>(
		&self,
		store: &InferenceProviderStore<C>,
		provider: &InferenceProvider,
		api_key: &str,
	) -> Result<AgentProviderBinding> {
		let provider_id = mapping::clean_provider_id(&provider.latin_name)?;

		let mut binding = AgentProviderBinding::from_inventory(
			provider_id.clone(),
			provider,
			AgentProviderCredential::Inline,
			AgentProviderSource::Custom,
		)?;
		if let Some(api_base_url) = binding.api_base_url.as_mut() {
			*api_base_url = normalize_inventory_base_url(api_base_url);
		}

		let mut config = files::read_config(&self.config_path)?;
		upsert_provider(&mut config, &binding, Some(api_key))?;
		files::write_config(&self.config_path, &config)?;

		store.upsert_agent_binding(
			AGENT_ID,
			&provider_id,
			&provider.id,
			provider.models.first().map(|m| m.as_str()),
		)?;

		Ok(binding)
	}

	/// Update an existing Codex provider's display name and/or API key.
	///
	/// For binding providers (Custom source), only the model can be updated
	/// via the binding table. For config.toml providers (External source),
	/// updates are not supported through aghub.
	pub fn update_provider<C: CredentialStore>(
		&self,
		store: &InferenceProviderStore<C>,
		provider_id: &str,
		name: Option<&str>,
		api_key: Option<&str>,
	) -> Result<AgentProviderBinding> {
		let provider_id = mapping::clean_provider_id(provider_id)?;

		// Check if this is a binding provider first
		let binding_rows = store.list_agent_bindings(AGENT_ID)?;
		if let Some(row) = binding_rows.iter().find(|r| r.id == provider_id) {
			// This is a binding provider - update model only via binding table
			if name.is_some() {
				return Err(
					crate::error::InferenceProviderError::InvalidAgentProviderConfig {
						agent_id: AGENT_ID.to_string(),
						path: self.config_path.display().to_string(),
						message: format!(
							"codex binding provider '{provider_id}' name \
							 cannot be changed via aghub"
						),
					},
				);
			}

			if let Some(api_key) = api_key {
				mapping::ensure_api_key(api_key)?;
				let provider = store.get(&row.inference_provider_id)?;
				store.set_api_key(&provider.id, api_key)?;
			}

			return binding_from_row(store, row);
		}

		let config = files::read_config(&self.config_path)?;
		let exists = provider_table(&config, &provider_id)?.is_some();
		if !exists {
			return Err(crate::error::InferenceProviderError::NotFound(
				provider_id,
			));
		}

		Err(
			crate::error::InferenceProviderError::InvalidAgentProviderConfig {
				agent_id: AGENT_ID.to_string(),
				path: self.config_path.display().to_string(),
				message: format!(
					"codex provider '{provider_id}' is defined in \
					 config.toml and cannot be updated via aghub"
				),
			},
		)
	}

	/// Read an API key visible to Codex for a provider.
	///
	/// For binding providers, reads from the store's credential store.
	/// For config.toml providers, uses existing logic.
	pub fn api_key<C: CredentialStore>(
		&self,
		store: &InferenceProviderStore<C>,
		provider_id: &str,
	) -> Result<Option<String>> {
		let provider_id = provider_id.trim().trim_end_matches('/').to_string();
		if mapping::is_reserved_provider_id(&provider_id) {
			return Ok(None);
		}
		let provider_id = mapping::clean_provider_id(&provider_id)?;

		// Check if this is a binding provider
		let binding_rows = store.list_agent_bindings(AGENT_ID)?;
		if let Some(row) = binding_rows.iter().find(|r| r.id == provider_id) {
			return store.get_api_key(&row.inference_provider_id);
		}

		// Fall back to config.toml
		let config = files::read_config(&self.config_path)?;
		let Some(table) = provider_table(&config, &provider_id)? else {
			return Ok(None);
		};
		if mapping::uses_shared_openai_api_key(table) {
			let auth = files::read_auth(&self.auth_path)?;
			return Ok(mapping::api_key_from_auth_file(&auth));
		}
		if mapping::uses_auth_command(table) {
			return Ok(None);
		}
		Ok(mapping::api_key_from_table(table))
	}

	/// Remove a custom provider definition.
	///
	/// Checks binding table first. If found, deletes the binding.
	/// For config.toml providers, errors since they are External.
	pub fn remove_provider<C: CredentialStore>(
		&self,
		store: &InferenceProviderStore<C>,
		provider_id: &str,
	) -> Result<AgentProviderBinding> {
		let provider_id = mapping::clean_provider_id(provider_id)?;

		// Check binding table first
		let binding_rows = store.list_agent_bindings(AGENT_ID)?;
		if let Some(row) = binding_rows.iter().find(|r| r.id == provider_id) {
			let binding = binding_from_row(store, row)?;
			store.delete_agent_binding(AGENT_ID, &row.id)?;

			// Also remove from config.toml if present
			let mut config = files::read_config(&self.config_path)?;
			let providers = providers_table_mut(&mut config)?;
			providers.remove(&provider_id);
			if config
				.get("model_provider")
				.and_then(Item::as_str)
				.is_some_and(|value| value == provider_id)
			{
				config.as_table_mut().remove("model_provider");
				config.as_table_mut().remove("model");
			}
			clear_profile_provider_references(&mut config, &provider_id);
			let all_providers = self.load_all_providers(store, &config)?;
			self.sync_active_model_catalog(&mut config, &all_providers)?;
			files::write_config(&self.config_path, &config)?;

			return Ok(binding);
		}

		let config = files::read_config(&self.config_path)?;
		let exists = provider_table(&config, &provider_id)?.is_some();
		if !exists {
			return Err(crate::error::InferenceProviderError::NotFound(
				provider_id,
			));
		}

		Err(
			crate::error::InferenceProviderError::InvalidAgentProviderConfig {
				agent_id: AGENT_ID.to_string(),
				path: self.config_path.display().to_string(),
				message: format!(
					"Provider '{provider_id}' is defined in config.toml, \
					 cannot delete via aghub"
				),
			},
		)
	}

	/// Load all providers including those from the binding table.
	///
	/// This is a Codex-specific extension that merges providers from:
	/// 1. OpenAI built-in provider
	/// 2. config.toml `[model_providers]` (marked as External)
	/// 3. Binding table providers (marked as Custom)
	pub fn load_all_providers<C: CredentialStore>(
		&self,
		store: &InferenceProviderStore<C>,
		config: &DocumentMut,
	) -> Result<Vec<AgentProviderBinding>> {
		let mut providers = vec![mapping::built_in_openai_binding(
			built_in_openai_api_base_url(config),
		)];

		// Load config.toml providers (marked as External)
		if let Some(model_providers) =
			config.get("model_providers").and_then(Item::as_table)
		{
			for (provider_id, item) in model_providers {
				let Some(provider) = item.as_table() else {
					continue;
				};
				providers.push(mapping::binding_from_table_external(
					provider_id,
					provider,
				)?);
			}
		}

		// Load binding table providers (marked as Custom)
		let binding_rows = store.list_agent_bindings(AGENT_ID)?;
		for row in binding_rows {
			let binding = binding_from_row(store, &row)?;
			if let Some(existing) =
				providers.iter_mut().find(|p| p.id == binding.id)
			{
				*existing = binding;
			} else {
				providers.push(binding);
			}
		}

		Ok(providers)
	}

	fn sync_active_model_catalog(
		&self,
		config: &mut DocumentMut,
		providers: &[AgentProviderBinding],
	) -> Result<()> {
		let active_provider_id = active_selected_provider_id(config);
		let binding = providers.iter().find(|provider| {
			provider.id == active_provider_id
				&& provider.source == AgentProviderSource::Custom
		});
		sync_model_catalog_for_binding(&self.config_path, config, binding)
	}

	fn sync_provider_model_catalog_if_active(
		&self,
		config: &mut DocumentMut,
		binding: &AgentProviderBinding,
	) -> Result<()> {
		if active_selected_provider_id(config) == binding.id {
			sync_model_catalog_for_binding(
				&self.config_path,
				config,
				Some(binding),
			)?;
		}
		Ok(())
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
				if provider_id.eq_ignore_ascii_case(mapping::OPENAI_PROVIDER_ID)
				{
					config.as_table_mut().remove("model_provider");
				} else {
					config["model_provider"] = value(provider_id.clone());
				}
			} else {
				config.as_table_mut().remove("model_provider");
			}
			config["model"] = value(selection.model_id.clone());
		} else {
			config.as_table_mut().remove("model_provider");
			config.as_table_mut().remove("model");
		}

		let active_provider_id = active_selected_provider_id(&config);
		let active_binding = state.providers.iter().find(|provider| {
			provider.id == active_provider_id
				&& provider.source == AgentProviderSource::Custom
		});
		sync_model_catalog_for_binding(
			&self.config_path,
			&mut config,
			active_binding,
		)?;
		files::write_config(&self.config_path, &config)
	}
}

fn providers_from_config(
	config: &DocumentMut,
) -> Result<Vec<AgentProviderBinding>> {
	let mut providers = vec![mapping::built_in_openai_binding(
		built_in_openai_api_base_url(config),
	)];

	if let Some(model_providers) =
		config.get("model_providers").and_then(Item::as_table)
	{
		for (provider_id, item) in model_providers {
			let Some(provider) = item.as_table() else {
				continue;
			};
			providers.push(mapping::binding_from_table_external(
				provider_id,
				provider,
			)?);
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
		.filter(|provider| {
			!provider.eq_ignore_ascii_case(mapping::OPENAI_PROVIDER_ID)
		})
		.map(ToString::to_string);
	Some(match provider {
		Some(provider) => AgentModelSelection::provider_model(provider, model),
		None => AgentModelSelection::model(model),
	})
}

fn built_in_openai_api_base_url(config: &DocumentMut) -> Option<String> {
	config
		.get("openai_base_url")
		.and_then(Item::as_str)
		.or_else(|| config.get("base_url").and_then(Item::as_str))
		.map(ToString::to_string)
}

fn active_selected_provider_id(config: &DocumentMut) -> String {
	let active_profile_id = active_profile_id(config);
	effective_profile_value(config, &active_profile_id, "model_provider")
		.unwrap_or_else(|| mapping::OPENAI_PROVIDER_ID.to_string())
}

fn normalize_inventory_base_url(api_base_url: &str) -> String {
	let trimmed = api_base_url.trim().trim_end_matches('/');
	let origin_only = match trimmed.split_once("://") {
		Some((_scheme, rest)) => !rest.contains('/'),
		None => !trimmed.contains('/'),
	};

	if trimmed.ends_with("/v1") {
		trimmed.to_string()
	} else if origin_only {
		format!("{trimmed}/v1")
	} else {
		trimmed.to_string()
	}
}

fn binding_from_row<C: CredentialStore>(
	store: &InferenceProviderStore<C>,
	row: &AgentProviderBindingRow,
) -> Result<AgentProviderBinding> {
	let mut binding = store.binding_from_row(row)?;
	if matches!(binding.credential, AgentProviderCredential::EnvVar { .. }) {
		binding.credential = AgentProviderCredential::Inline;
	}
	Ok(binding)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CodexCatalogModelSpec {
	model: String,
	display_name: String,
	context_window: u64,
}

fn sync_model_catalog_for_binding(
	config_path: &Path,
	config: &mut DocumentMut,
	binding: Option<&AgentProviderBinding>,
) -> Result<()> {
	let Some(binding) = binding else {
		remove_generated_model_catalog(config_path, config)?;
		return Ok(());
	};
	let specs = codex_catalog_model_specs(binding, config);
	if specs.is_empty() {
		remove_generated_model_catalog(config_path, config)?;
		return Ok(());
	}

	let template = codex_model_catalog_template(config_path);
	let catalog = codex_model_catalog_from_specs(&specs, &template);
	write_model_catalog(config_path, &catalog)?;
	config["model_catalog_json"] = value(GENERATED_MODEL_CATALOG_PATH);
	Ok(())
}

fn codex_catalog_model_specs(
	binding: &AgentProviderBinding,
	config: &DocumentMut,
) -> Vec<CodexCatalogModelSpec> {
	let context_window = top_level_u64(config, "model_context_window")
		.unwrap_or(DEFAULT_CODEX_CONTEXT_WINDOW);
	let mut seen = HashSet::new();
	let mut specs = Vec::new();

	for model in &binding.models {
		let model_id = model.id.trim();
		if model_id.is_empty() || !seen.insert(model_id.to_string()) {
			continue;
		}
		let display_name = model
			.name
			.as_deref()
			.map(str::trim)
			.filter(|name| !name.is_empty())
			.unwrap_or(model_id);
		specs.push(CodexCatalogModelSpec {
			model: model_id.to_string(),
			display_name: display_name.to_string(),
			context_window,
		});
	}

	specs
}

fn codex_model_catalog_from_specs(
	specs: &[CodexCatalogModelSpec],
	template: &Value,
) -> Value {
	let models = specs
		.iter()
		.enumerate()
		.map(|(index, spec)| {
			codex_model_catalog_entry(
				template,
				&spec.model,
				&spec.display_name,
				spec.context_window,
				index,
			)
		})
		.collect::<Vec<_>>();
	json!({ "models": models })
}

fn codex_model_catalog_entry(
	template: &Value,
	model: &str,
	display_name: &str,
	context_window: u64,
	priority: usize,
) -> Value {
	let mut entry = template.clone();
	let Some(entry_obj) = entry.as_object_mut() else {
		return json!({});
	};

	entry_obj.insert("slug".to_string(), json!(model));
	entry_obj.insert("display_name".to_string(), json!(display_name));
	entry_obj.insert("description".to_string(), json!(display_name));
	entry_obj.insert("context_window".to_string(), json!(context_window));
	entry_obj.insert("max_context_window".to_string(), json!(context_window));
	entry_obj.insert("priority".to_string(), json!(1000 + priority));
	entry_obj.insert("additional_speed_tiers".to_string(), json!([]));
	entry_obj.insert("service_tiers".to_string(), json!([]));
	entry_obj.insert("availability_nux".to_string(), Value::Null);
	entry_obj.insert("upgrade".to_string(), Value::Null);

	entry
}

fn codex_model_catalog_template(config_path: &Path) -> Value {
	let cache_path = config_path
		.parent()
		.map(|parent| parent.join("models_cache.json"))
		.unwrap_or_else(|| PathBuf::from("models_cache.json"));

	fs::read_to_string(cache_path)
		.ok()
		.and_then(|content| serde_json::from_str::<Value>(&content).ok())
		.and_then(|catalog| find_codex_model_template(&catalog))
		.unwrap_or_else(fallback_codex_model_template)
}

fn find_codex_model_template(catalog: &Value) -> Option<Value> {
	let models = catalog.get("models").and_then(Value::as_array)?;
	models
		.iter()
		.find(|model| {
			model.get("slug").and_then(Value::as_str)
				== Some(CODEX_MODEL_CATALOG_TEMPLATE_SLUG)
		})
		.or_else(|| {
			models.iter().find(|model| {
				model.get("base_instructions").is_some()
					&& model.get("model_messages").is_some()
			})
		})
		.cloned()
}

fn fallback_codex_model_template() -> Value {
	json!({
		"slug": CODEX_MODEL_CATALOG_TEMPLATE_SLUG,
		"display_name": "GPT-5.5",
		"description": "Codex-compatible model template",
		"default_reasoning_level": "medium",
		"supported_reasoning_levels": [
			{
				"effort": "low",
				"description": "Fast responses with lighter reasoning"
			},
			{
				"effort": "medium",
				"description": "Balanced reasoning"
			},
			{
				"effort": "high",
				"description": "More reasoning depth"
			}
		],
		"shell_type": "shell_command",
		"visibility": "list",
		"supported_in_api": true,
		"priority": 0,
		"additional_speed_tiers": [],
		"service_tiers": [],
		"availability_nux": null,
		"upgrade": null,
		"base_instructions": "You are Codex, a coding agent.",
		"model_messages": {
			"instructions_template": "{{ base_instructions }}",
			"instructions_variables": {}
		},
		"context_window": DEFAULT_CODEX_CONTEXT_WINDOW,
		"max_context_window": DEFAULT_CODEX_CONTEXT_WINDOW
	})
}

fn write_model_catalog(config_path: &Path, catalog: &Value) -> Result<()> {
	let path = model_catalog_path(config_path);
	if let Some(parent) = path.parent() {
		fs::create_dir_all(parent)?;
	}
	let content = serde_json::to_string_pretty(catalog)
		.map_err(|error| files::invalid_config(&path, error.to_string()))?;
	fs::write(path, content)?;
	Ok(())
}

fn remove_generated_model_catalog(
	config_path: &Path,
	config: &mut DocumentMut,
) -> Result<()> {
	let model_catalog_json =
		config.get("model_catalog_json").and_then(Item::as_str);
	let should_remove_field = model_catalog_json
		.map(is_generated_model_catalog_path)
		.unwrap_or(false);
	if should_remove_field {
		config.as_table_mut().remove("model_catalog_json");
		remove_file_if_exists(model_catalog_path(config_path))?;
	}

	Ok(())
}

fn remove_file_if_exists(path: PathBuf) -> Result<()> {
	match fs::remove_file(path) {
		Ok(()) => Ok(()),
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
		Err(error) => Err(error.into()),
	}
}

fn model_catalog_path(config_path: &Path) -> PathBuf {
	config_path
		.parent()
		.map(|parent| parent.join(GENERATED_MODEL_CATALOG_PATH))
		.unwrap_or_else(|| PathBuf::from(GENERATED_MODEL_CATALOG_PATH))
}

fn is_generated_model_catalog_path(path: &str) -> bool {
	Path::new(path) == Path::new(GENERATED_MODEL_CATALOG_PATH)
}

fn top_level_u64(config: &DocumentMut, field: &str) -> Option<u64> {
	config
		.get(field)
		.and_then(Item::as_integer)
		.and_then(|value| u64::try_from(value).ok())
		.filter(|value| *value > 0)
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

fn clean_selected_model(model: &str) -> Result<String> {
	let model = model.trim().to_string();
	if model.is_empty() {
		Err(crate::error::InferenceProviderError::EmptyModelName)
	} else {
		Ok(model)
	}
}

fn ensure_provider_model(
	provider: &AgentProviderBinding,
	model: &str,
) -> Result<()> {
	if provider.models.is_empty()
		|| provider
			.models
			.iter()
			.any(|candidate| candidate.id == model)
	{
		Ok(())
	} else {
		Err(crate::error::InferenceProviderError::NotFound(
			model.to_string(),
		))
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
			profile.remove("model");
		}
	}
}
