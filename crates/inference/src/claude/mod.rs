//! Claude Code provider configuration adapter.
//!
//! Claude Code stores provider configuration in `~/.claude/settings.json`
//! via environment variable overrides in the `env` object.

mod files;

#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};

use serde_json::json;
use serde_json::{Map, Value};

use crate::agent::{
	AgentCredentialSupport, AgentModelSelection, AgentProviderAdapter,
	AgentProviderBinding, AgentProviderCapabilities, AgentProviderCredential,
	AgentProviderDefaultSupport, AgentProviderSource, AgentProviderState,
};
use crate::error::Result;

pub(super) const AGENT_ID: &str = "claude";
pub(super) const PRIMARY_PROVIDER_ID: &str = "primary";

const API_BASE_URL_ENV: &str = "ANTHROPIC_BASE_URL";
const API_KEY_ENV: &str = "ANTHROPIC_API_KEY";
const AUTH_TOKEN_ENV: &str = "ANTHROPIC_AUTH_TOKEN";
const MODEL_ENV: &str = "ANTHROPIC_MODEL";
const LEGACY_SMALL_FAST_MODEL_ENV: &str = "ANTHROPIC_SMALL_FAST_MODEL";
const LEGACY_REASONING_MODEL_ENV: &str = "ANTHROPIC_REASONING_MODEL";
const DEFAULT_HAIKU_MODEL_ENV: &str = "ANTHROPIC_DEFAULT_HAIKU_MODEL";
const DEFAULT_SONNET_MODEL_ENV: &str = "ANTHROPIC_DEFAULT_SONNET_MODEL";
const DEFAULT_OPUS_MODEL_ENV: &str = "ANTHROPIC_DEFAULT_OPUS_MODEL";
const SETTINGS_MODEL_KEY: &str = "model";
const LEGACY_API_BASE_URL_KEY: &str = "apiBaseUrl";
const LEGACY_PRIMARY_MODEL_KEY: &str = "primaryModel";
const LEGACY_SMALL_FAST_MODEL_KEY: &str = "smallFastModel";

/// Provider adapter for Claude Code.
#[derive(Debug, Clone)]
pub struct ClaudeProviderAdapter {
	config_path: PathBuf,
}

/// Claude-specific configuration state.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ClaudeConfigState {
	/// API base URL from `ANTHROPIC_BASE_URL`.
	pub api_base_url: Option<String>,
	/// Effective API key from `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY`.
	pub api_key: Option<String>,
	/// Credential field currently used inside `env`.
	pub api_key_env_name: Option<String>,
	/// Effective primary model from top-level `model` or `ANTHROPIC_MODEL`.
	pub model: Option<String>,
	/// Default Haiku alias model.
	pub haiku_model: Option<String>,
	/// Default Sonnet alias model.
	pub sonnet_model: Option<String>,
	/// Default Opus alias model.
	pub opus_model: Option<String>,
}

impl ClaudeProviderAdapter {
	/// Create an adapter with an explicit config path.
	pub fn new(config_path: impl Into<PathBuf>) -> Self {
		Self {
			config_path: config_path.into(),
		}
	}

	/// Create an adapter for the global Claude Code config.
	pub fn global() -> Result<Self> {
		Ok(Self::new(files::default_global_config_path()?))
	}

	/// Path to the config file this adapter manages.
	pub fn config_path(&self) -> &Path {
		&self.config_path
	}

	/// Load raw Claude configuration state from `settings.json`.
	pub fn load_config_state(&self) -> Result<ClaudeConfigState> {
		let config = files::read_config(&self.config_path)?;
		Ok(config_state_from_value(&config))
	}

	/// Save Claude configuration state to `settings.json`.
	///
	/// Mutates provider-related keys while preserving unrelated settings.
	pub fn save_config_state(&self, state: &ClaudeConfigState) -> Result<()> {
		let mut config = files::read_config(&self.config_path)?;
		let current = config_state_from_value(&config);
		let resolved = resolve_state(state, &current);

		if let Some(model) = &resolved.model {
			config[SETTINGS_MODEL_KEY] = json!(model);
		} else if let Some(obj) = config.as_object_mut() {
			obj.remove(SETTINGS_MODEL_KEY);
		}

		if config.get("env").is_none() {
			config["env"] = json!({});
		}

		if let Some(env) = config.get_mut("env").and_then(|v| v.as_object_mut())
		{
			if let Some(url) = &resolved.api_base_url {
				env.insert(API_BASE_URL_ENV.to_string(), json!(url));
			} else {
				env.remove(API_BASE_URL_ENV);
			}

			env.remove(API_KEY_ENV);
			env.remove(AUTH_TOKEN_ENV);
			if let Some(key) = &resolved.api_key {
				let key_name = resolved
					.api_key_env_name
					.as_deref()
					.and_then(normalize_api_key_env_name)
					.unwrap_or(AUTH_TOKEN_ENV);
				env.insert(key_name.to_string(), json!(key));
			}

			write_env_string(env, MODEL_ENV, resolved.model.as_deref());
			write_env_string(
				env,
				DEFAULT_HAIKU_MODEL_ENV,
				resolved.haiku_model.as_deref(),
			);
			write_env_string(
				env,
				DEFAULT_SONNET_MODEL_ENV,
				resolved.sonnet_model.as_deref(),
			);
			write_env_string(
				env,
				DEFAULT_OPUS_MODEL_ENV,
				resolved.opus_model.as_deref(),
			);
			env.remove(LEGACY_SMALL_FAST_MODEL_ENV);
			env.remove(LEGACY_REASONING_MODEL_ENV);

			if env.is_empty() {
				if let Some(obj) = config.as_object_mut() {
					obj.remove("env");
				}
			}
		}

		files::write_config(&self.config_path, &config)?;
		Ok(())
	}

	/// Clear all provider-related env overrides.
	///
	/// Removes provider-related env and model overrides, falling back to
	/// Claude Code's default behavior.
	pub fn clear_provider_config(&self) -> Result<()> {
		let mut config = files::read_config(&self.config_path)?;

		if let Some(env) = config.get_mut("env").and_then(|v| v.as_object_mut())
		{
			env.remove(API_BASE_URL_ENV);
			env.remove(API_KEY_ENV);
			env.remove(AUTH_TOKEN_ENV);
			env.remove(MODEL_ENV);
			env.remove(LEGACY_SMALL_FAST_MODEL_ENV);
			env.remove(LEGACY_REASONING_MODEL_ENV);
			env.remove(DEFAULT_HAIKU_MODEL_ENV);
			env.remove(DEFAULT_SONNET_MODEL_ENV);
			env.remove(DEFAULT_OPUS_MODEL_ENV);

			if env.is_empty() {
				if let Some(obj) = config.as_object_mut() {
					obj.remove("env");
				}
			}
		}

		if let Some(obj) = config.as_object_mut() {
			obj.remove(SETTINGS_MODEL_KEY);
			obj.remove(LEGACY_API_BASE_URL_KEY);
			obj.remove(LEGACY_PRIMARY_MODEL_KEY);
			obj.remove(LEGACY_SMALL_FAST_MODEL_KEY);
		}

		files::write_config(&self.config_path, &config)?;
		Ok(())
	}
}

impl AgentProviderAdapter for ClaudeProviderAdapter {
	fn agent_id(&self) -> &'static str {
		AGENT_ID
	}

	fn capabilities(&self) -> AgentProviderCapabilities {
		AgentProviderCapabilities::closed_single(
			AgentProviderDefaultSupport::MODEL_ONLY,
			AgentCredentialSupport::ENV_VAR,
		)
	}

	fn load_providers(&self) -> Result<AgentProviderState> {
		let state = self.load_config_state()?;

		let provider = if state.api_base_url.is_some()
			|| state.api_key.is_some()
		{
			Some(AgentProviderBinding {
				id: PRIMARY_PROVIDER_ID.to_string(),
				source_provider_id: None,
				name: "Custom".to_string(),
				format: Some(crate::model::InferenceProviderFormat::Anthropic),
				api_base_url: state.api_base_url.clone(),
				credential: state
					.api_key
					.as_ref()
					.map(|_| AgentProviderCredential::EnvVar {
						name: state
							.api_key_env_name
							.clone()
							.unwrap_or_else(|| AUTH_TOKEN_ENV.to_string()),
					})
					.unwrap_or(AgentProviderCredential::None),
				models: provider_models_from_state(&state),
				source: AgentProviderSource::ClosedSlot,
			})
		} else {
			None
		};

		Ok(AgentProviderState {
			providers: provider.into_iter().collect(),
			default_model: state.model.map(AgentModelSelection::model),
			small_model: None,
		})
	}

	fn save_providers(&self, state: &AgentProviderState) -> Result<()> {
		state.validate(AGENT_ID, &self.capabilities())?;

		let current = self.load_config_state()?;
		let provider = state.providers.first();
		let config_state = ClaudeConfigState {
			api_base_url: provider.and_then(|p| p.api_base_url.clone()),
			api_key: match provider.map(|p| &p.credential) {
				Some(AgentProviderCredential::EnvVar { .. }) => {
					// Preserve the existing key when generic state save
					// round-trips an env-backed Claude provider.
					current.api_key
				}
				_ => None,
			},
			api_key_env_name: match provider.map(|p| &p.credential) {
				Some(AgentProviderCredential::EnvVar { name }) => {
					Some(name.clone())
				}
				_ => None,
			},
			model: state.default_model.as_ref().map(|m| m.model_id.clone()),
			haiku_model: None,
			sonnet_model: None,
			opus_model: None,
		};

		self.save_config_state(&config_state)
	}
}

fn config_state_from_value(config: &Value) -> ClaudeConfigState {
	let env = config
		.get("env")
		.and_then(Value::as_object)
		.cloned()
		.unwrap_or_default();
	let model = string_field(config, SETTINGS_MODEL_KEY)
		.or_else(|| env_string(&env, MODEL_ENV));
	let legacy_small_fast = env_string(&env, LEGACY_SMALL_FAST_MODEL_ENV);

	ClaudeConfigState {
		api_base_url: env_string(&env, API_BASE_URL_ENV),
		api_key: active_api_key(&env),
		api_key_env_name: active_api_key_env_name(&env),
		model: model.clone(),
		haiku_model: env_string(&env, DEFAULT_HAIKU_MODEL_ENV)
			.or_else(|| legacy_small_fast.clone())
			.or_else(|| model.clone()),
		sonnet_model: env_string(&env, DEFAULT_SONNET_MODEL_ENV)
			.or_else(|| model.clone())
			.or_else(|| legacy_small_fast.clone()),
		opus_model: env_string(&env, DEFAULT_OPUS_MODEL_ENV)
			.or_else(|| model.clone())
			.or(legacy_small_fast),
	}
}

fn active_api_key(env: &Map<String, Value>) -> Option<String> {
	active_api_key_env_name(env).and_then(|name| env_string(env, &name))
}

fn active_api_key_env_name(env: &Map<String, Value>) -> Option<String> {
	if env_string(env, AUTH_TOKEN_ENV).is_some() {
		return Some(AUTH_TOKEN_ENV.to_string());
	}
	if env_string(env, API_KEY_ENV).is_some() {
		return Some(API_KEY_ENV.to_string());
	}
	None
}

fn resolve_state(
	state: &ClaudeConfigState,
	current: &ClaudeConfigState,
) -> ClaudeConfigState {
	let model_changed = state.model != current.model;
	let model = state.model.clone();

	ClaudeConfigState {
		api_base_url: state.api_base_url.clone(),
		api_key: state.api_key.clone(),
		api_key_env_name: match &state.api_key {
			Some(_) => state
				.api_key_env_name
				.as_deref()
				.and_then(normalize_api_key_env_name)
				.map(ToString::to_string)
				.or_else(|| current.api_key_env_name.clone())
				.or_else(|| Some(AUTH_TOKEN_ENV.to_string())),
			None => None,
		},
		model: model.clone(),
		haiku_model: resolve_model_alias(
			&state.haiku_model,
			&current.haiku_model,
			&model,
			model_changed,
		),
		sonnet_model: resolve_model_alias(
			&state.sonnet_model,
			&current.sonnet_model,
			&model,
			model_changed,
		),
		opus_model: resolve_model_alias(
			&state.opus_model,
			&current.opus_model,
			&model,
			model_changed,
		),
	}
}

fn resolve_model_alias(
	explicit: &Option<String>,
	current: &Option<String>,
	model: &Option<String>,
	model_changed: bool,
) -> Option<String> {
	if model.is_none() {
		return None;
	}

	explicit
		.clone()
		.or_else(|| (!model_changed).then(|| current.clone()).flatten())
		.or_else(|| model.clone())
}

fn normalize_api_key_env_name(name: &str) -> Option<&'static str> {
	match name {
		AUTH_TOKEN_ENV => Some(AUTH_TOKEN_ENV),
		API_KEY_ENV => Some(API_KEY_ENV),
		_ => None,
	}
}

fn write_env_string(
	env: &mut Map<String, Value>,
	key: &str,
	value: Option<&str>,
) {
	if let Some(value) = value {
		env.insert(key.to_string(), json!(value));
	} else {
		env.remove(key);
	}
}

fn env_string(env: &Map<String, Value>, key: &str) -> Option<String> {
	env.get(key)
		.and_then(Value::as_str)
		.map(ToString::to_string)
}

fn string_field(value: &Value, key: &str) -> Option<String> {
	value
		.get(key)
		.and_then(Value::as_str)
		.map(ToString::to_string)
}

fn provider_models_from_state(
	state: &ClaudeConfigState,
) -> Vec<crate::agent::AgentProviderModel> {
	let mut models = Vec::new();
	push_unique_model(&mut models, state.model.as_deref());
	push_unique_model(&mut models, state.haiku_model.as_deref());
	push_unique_model(&mut models, state.sonnet_model.as_deref());
	push_unique_model(&mut models, state.opus_model.as_deref());
	models
}

fn push_unique_model(
	models: &mut Vec<crate::agent::AgentProviderModel>,
	model_id: Option<&str>,
) {
	let Some(model_id) = model_id else {
		return;
	};
	if models.iter().any(|model| model.id == model_id) {
		return;
	}
	models.push(crate::agent::AgentProviderModel::new(model_id));
}
