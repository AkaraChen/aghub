//! Claude Code provider configuration adapter.
//!
//! Claude Code stores provider configuration in `~/.claude/settings.json`
//! via environment variable overrides in the `env` object.

mod files;

use std::path::{Path, PathBuf};

use serde_json::json;

use crate::agent::{
	AgentCredentialSupport, AgentModelSelection, AgentProviderAdapter,
	AgentProviderBinding, AgentProviderCapabilities, AgentProviderCredential,
	AgentProviderDefaultSupport, AgentProviderSource, AgentProviderState,
};
use crate::error::Result;

pub(super) const AGENT_ID: &str = "claude";
pub(super) const PRIMARY_PROVIDER_ID: &str = "primary";

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
	/// API key from `ANTHROPIC_API_KEY`.
	pub api_key: Option<String>,
	/// Model from `ANTHROPIC_MODEL`.
	pub model: Option<String>,
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
		let env = config
			.get("env")
			.and_then(|v| v.as_object())
			.cloned()
			.unwrap_or_default();

		Ok(ClaudeConfigState {
			api_base_url: env
				.get("ANTHROPIC_BASE_URL")
				.and_then(|v| v.as_str())
				.map(ToString::to_string),
			api_key: env
				.get("ANTHROPIC_API_KEY")
				.and_then(|v| v.as_str())
				.map(ToString::to_string),
			model: env
				.get("ANTHROPIC_MODEL")
				.and_then(|v| v.as_str())
				.map(ToString::to_string),
		})
	}

	/// Save Claude configuration state to `settings.json`.
	///
	/// Only mutates the `env` object; preserves all other settings.
	pub fn save_config_state(&self, state: &ClaudeConfigState) -> Result<()> {
		let mut config = files::read_config(&self.config_path)?;

		if config.get("env").is_none() {
			config["env"] = json!({});
		}

		if let Some(env) = config.get_mut("env").and_then(|v| v.as_object_mut())
		{
			if let Some(url) = &state.api_base_url {
				env.insert("ANTHROPIC_BASE_URL".to_string(), json!(url));
			} else {
				env.remove("ANTHROPIC_BASE_URL");
			}

			if let Some(key) = &state.api_key {
				env.insert("ANTHROPIC_API_KEY".to_string(), json!(key));
			} else {
				env.remove("ANTHROPIC_API_KEY");
			}

			if let Some(model) = &state.model {
				env.insert("ANTHROPIC_MODEL".to_string(), json!(model));
			} else {
				env.remove("ANTHROPIC_MODEL");
			}

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
	/// Removes `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_MODEL`
	/// from the `env` object, falling back to Claude Code's default behavior
	/// (using Anthropic's official API with browser login).
	pub fn clear_provider_config(&self) -> Result<()> {
		let mut config = files::read_config(&self.config_path)?;

		if let Some(env) = config.get_mut("env").and_then(|v| v.as_object_mut())
		{
			env.remove("ANTHROPIC_BASE_URL");
			env.remove("ANTHROPIC_API_KEY");
			env.remove("ANTHROPIC_MODEL");
			env.remove("ANTHROPIC_AUTH_TOKEN");
			env.remove("ANTHROPIC_DEFAULT_HAIKU_MODEL");
			env.remove("ANTHROPIC_DEFAULT_SONNET_MODEL");
			env.remove("ANTHROPIC_DEFAULT_OPUS_MODEL");

			if env.is_empty() {
				if let Some(obj) = config.as_object_mut() {
					obj.remove("env");
				}
			}
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
				api_base_url: state.api_base_url,
				credential: state
					.api_key
					.map(|_| AgentProviderCredential::EnvVar {
						name: "ANTHROPIC_API_KEY".to_string(),
					})
					.unwrap_or(AgentProviderCredential::None),
				models: state
					.model
					.clone()
					.into_iter()
					.map(crate::agent::AgentProviderModel::new)
					.collect(),
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

		let provider = state.providers.first();
		let config_state = ClaudeConfigState {
			api_base_url: provider.and_then(|p| p.api_base_url.clone()),
			api_key: match provider.map(|p| &p.credential) {
				Some(AgentProviderCredential::EnvVar { .. }) => {
					// We don't store the actual key in the adapter;
					// the caller should use save_config_state directly
					None
				}
				_ => None,
			},
			model: state.default_model.as_ref().map(|m| m.model_id.clone()),
		};

		self.save_config_state(&config_state)
	}
}
