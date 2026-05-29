//! Agent-facing provider management abstractions.
//!
//! `InferenceProvider` is aghub's provider inventory. The types in this
//! module describe how an agent can consume that inventory: some agents expose
//! only one closed credential slot, while others expose a provider registry
//! with explicit default model/provider selection.

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::error::{InferenceProviderError, Result};
use crate::model::{InferenceProvider, InferenceProviderFormat};

/// How provider definitions are represented by an agent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentProviderMode {
	/// The agent has one implicit provider slot.
	///
	/// Claude Code is the canonical example: provider-ish configuration is
	/// expressed through environment variables such as `ANTHROPIC_API_KEY`,
	/// not through a named provider registry.
	ClosedSingle,

	/// The agent has a named provider registry.
	///
	/// OpenCode and Codex are examples. The registry can contain custom
	/// providers, and may also coexist with built-in providers.
	Registry,
}

/// Built-in provider behavior for registry-style agents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct BuiltInProviderSupport {
	/// Whether the agent ships built-in providers outside user config.
	pub available: bool,

	/// Whether user config can redefine a built-in provider id.
	pub override_supported: bool,
}

impl BuiltInProviderSupport {
	/// No built-in provider registry is exposed to aghub.
	pub const NONE: Self = Self {
		available: false,
		override_supported: false,
	};

	/// Built-ins exist, but their definitions are immutable.
	pub const IMMUTABLE: Self = Self {
		available: true,
		override_supported: false,
	};

	/// Built-ins exist and can be overridden.
	pub const OVERRIDABLE: Self = Self {
		available: true,
		override_supported: true,
	};
}

/// Default model/provider selection behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentProviderDefaultSupport {
	/// Agent can persist a default provider id separately from the model.
	pub provider: bool,

	/// Agent can persist a primary/default model.
	pub model: bool,

	/// Agent can persist a smaller/faster model for background work.
	pub small_model: bool,

	/// Agent default model values may encode provider and model together.
	///
	/// OpenCode uses provider-qualified model ids such as
	/// `anthropic/claude-sonnet-4-5`.
	pub provider_qualified_model: bool,
}

impl AgentProviderDefaultSupport {
	/// No default selection is manageable.
	pub const NONE: Self = Self {
		provider: false,
		model: false,
		small_model: false,
		provider_qualified_model: false,
	};

	/// One default model without a separate provider selector.
	pub const MODEL_ONLY: Self = Self {
		provider: false,
		model: true,
		small_model: false,
		provider_qualified_model: false,
	};

	/// OpenCode-style default and small model routes.
	pub const QUALIFIED_MODELS: Self = Self {
		provider: false,
		model: true,
		small_model: true,
		provider_qualified_model: true,
	};

	/// Codex-style `model_provider` plus `model`.
	pub const PROVIDER_AND_MODEL: Self = Self {
		provider: true,
		model: true,
		small_model: false,
		provider_qualified_model: false,
	};
}

/// Where an agent can read provider credentials from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentCredentialSupport {
	/// Config can reference an environment variable that contains the key.
	pub env_var_reference: bool,

	/// Config can store an API key inline.
	pub inline_api_key: bool,

	/// The agent has its own credential store or login/connect command.
	pub agent_credential_store: bool,
}

impl AgentCredentialSupport {
	/// Environment variables only.
	pub const ENV_VAR: Self = Self {
		env_var_reference: true,
		inline_api_key: false,
		agent_credential_store: false,
	};

	/// Environment variables or inline config values.
	pub const ENV_VAR_OR_INLINE: Self = Self {
		env_var_reference: true,
		inline_api_key: true,
		agent_credential_store: false,
	};

	/// Environment variables, inline config values, or agent auth.
	pub const ENV_VAR_INLINE_OR_AGENT_STORE: Self = Self {
		env_var_reference: true,
		inline_api_key: true,
		agent_credential_store: true,
	};

	/// Environment variables plus the agent's own credential store.
	pub const ENV_VAR_OR_AGENT_STORE: Self = Self {
		env_var_reference: true,
		inline_api_key: false,
		agent_credential_store: true,
	};
}

/// Capability profile for one agent's provider management surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentProviderCapabilities {
	/// Provider representation mode.
	pub mode: AgentProviderMode,

	/// Whether custom provider definitions can be created.
	pub custom_providers: bool,

	/// Built-in provider behavior.
	pub built_ins: BuiltInProviderSupport,

	/// Default provider/model selection behavior.
	pub defaults: AgentProviderDefaultSupport,

	/// Credential placement behavior.
	pub credentials: AgentCredentialSupport,
}

impl AgentProviderCapabilities {
	/// Closed single-slot agent such as Claude Code.
	pub const fn closed_single(
		defaults: AgentProviderDefaultSupport,
		credentials: AgentCredentialSupport,
	) -> Self {
		Self {
			mode: AgentProviderMode::ClosedSingle,
			custom_providers: false,
			built_ins: BuiltInProviderSupport::NONE,
			defaults,
			credentials,
		}
	}

	/// Registry-style agent such as OpenCode or Codex.
	pub const fn registry(
		defaults: AgentProviderDefaultSupport,
		credentials: AgentCredentialSupport,
		built_ins: BuiltInProviderSupport,
	) -> Self {
		Self {
			mode: AgentProviderMode::Registry,
			custom_providers: true,
			built_ins,
			defaults,
			credentials,
		}
	}

	/// Check whether a capability is supported.
	pub fn supports(&self, capability: AgentProviderCapability) -> bool {
		match capability {
			AgentProviderCapability::CustomProviders => self.custom_providers,
			AgentProviderCapability::MultipleProviders => {
				self.mode == AgentProviderMode::Registry
			}
			AgentProviderCapability::BuiltInProviders => {
				self.built_ins.available
			}
			AgentProviderCapability::OverrideBuiltInProviders => {
				self.built_ins.override_supported
			}
			AgentProviderCapability::DefaultProvider => self.defaults.provider,
			AgentProviderCapability::DefaultModel => self.defaults.model,
			AgentProviderCapability::SmallModel => self.defaults.small_model,
			AgentProviderCapability::ProviderQualifiedModel => {
				self.defaults.provider_qualified_model
			}
			AgentProviderCapability::EnvVarCredentials => {
				self.credentials.env_var_reference
			}
			AgentProviderCapability::InlineApiKeyCredentials => {
				self.credentials.inline_api_key
			}
			AgentProviderCapability::AgentCredentialStore => {
				self.credentials.agent_credential_store
			}
		}
	}

	/// Return an error when the agent lacks a capability.
	pub fn ensure_supports(
		&self,
		agent_id: &str,
		capability: AgentProviderCapability,
	) -> Result<()> {
		if self.supports(capability) {
			Ok(())
		} else {
			Err(InferenceProviderError::UnsupportedAgentProviderCapability {
				agent_id: agent_id.to_string(),
				capability: capability.to_string(),
			})
		}
	}
}

/// Individual capability flags used for validation and UI affordances.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentProviderCapability {
	/// Agent can define custom providers.
	CustomProviders,

	/// Agent can manage more than one custom provider.
	MultipleProviders,

	/// Agent has built-in providers.
	BuiltInProviders,

	/// Agent lets user config redefine built-in provider ids.
	OverrideBuiltInProviders,

	/// Agent can persist a default provider id.
	DefaultProvider,

	/// Agent can persist a default model.
	DefaultModel,

	/// Agent can persist a small/background model.
	SmallModel,

	/// Agent uses provider-qualified model ids for model selection.
	ProviderQualifiedModel,

	/// Agent can reference API keys by environment variable.
	EnvVarCredentials,

	/// Agent can store API keys inline in config.
	InlineApiKeyCredentials,

	/// Agent has a native credential store.
	AgentCredentialStore,
}

impl fmt::Display for AgentProviderCapability {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		let value = match self {
			Self::CustomProviders => "custom providers",
			Self::MultipleProviders => "multiple providers",
			Self::BuiltInProviders => "built-in providers",
			Self::OverrideBuiltInProviders => "built-in provider override",
			Self::DefaultProvider => "default provider",
			Self::DefaultModel => "default model",
			Self::SmallModel => "small model",
			Self::ProviderQualifiedModel => "provider-qualified model",
			Self::EnvVarCredentials => "environment variable credentials",
			Self::InlineApiKeyCredentials => "inline API key credentials",
			Self::AgentCredentialStore => "agent credential store",
		};
		f.write_str(value)
	}
}

/// Credential reference persisted in an agent config.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentProviderCredential {
	/// No credential is configured or the provider does not need one.
	None,

	/// Config points at an environment variable.
	EnvVar { name: String },

	/// The agent stores the credential internally.
	AgentStore { id: Option<String> },

	/// The key is stored inline and must be treated as redacted.
	Inline,
}

/// Origin of a provider binding inside an agent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentProviderSource {
	/// One implicit provider slot with no registry key.
	ClosedSlot,

	/// Built-in provider supplied by the agent.
	BuiltIn,

	/// Custom provider from user configuration.
	Custom,

	/// Provider discovered only from the agent's credential store.
	StoredCredential,

	/// Provider defined externally in the agent's native config file.
	///
	/// Used for agents like Codex that may have providers in their own
	/// config format which aghub can activate but does not manage.
	External,
}

/// Model entry attached to an agent provider.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentProviderModel {
	/// Provider-local model id.
	pub id: String,

	/// Optional display label.
	pub name: Option<String>,
}

impl AgentProviderModel {
	/// Create a model entry using the id as the only stable value.
	pub fn new(id: impl Into<String>) -> Self {
		Self {
			id: id.into(),
			name: None,
		}
	}
}

impl From<String> for AgentProviderModel {
	fn from(id: String) -> Self {
		Self::new(id)
	}
}

impl From<&str> for AgentProviderModel {
	fn from(id: &str) -> Self {
		Self::new(id)
	}
}

/// Provider definition as seen by one agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentProviderBinding {
	/// Agent-local provider id.
	///
	/// For registry agents this is the provider key. For closed-slot agents,
	/// use a stable synthetic id such as `primary`.
	pub id: String,

	/// Optional id of the source `InferenceProvider` in aghub's inventory.
	pub source_provider_id: Option<String>,

	/// User-visible provider name.
	pub name: String,

	/// Request/response wire format.
	pub format: Option<InferenceProviderFormat>,

	/// API base URL, if the agent exposes one.
	pub api_base_url: Option<String>,

	/// Credential reference used by the agent.
	pub credential: AgentProviderCredential,

	/// Models registered for this provider.
	#[serde(default)]
	pub models: Vec<AgentProviderModel>,

	/// Where this binding came from.
	pub source: AgentProviderSource,
}

impl AgentProviderBinding {
	/// Build an agent binding from an aghub provider inventory entry.
	pub fn from_inventory(
		id: impl Into<String>,
		provider: &InferenceProvider,
		credential: AgentProviderCredential,
		source: AgentProviderSource,
	) -> Result<Self> {
		let id = clean_agent_provider_id(id.into())?;
		Ok(Self {
			id,
			source_provider_id: Some(provider.id.clone()),
			name: provider.display_name.clone(),
			format: Some(provider.format),
			api_base_url: Some(provider.api_base_url.clone()),
			credential,
			models: provider
				.models
				.iter()
				.cloned()
				.map(AgentProviderModel::from)
				.collect(),
			source,
		})
	}
}

/// Default model selection for an agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentModelSelection {
	/// Provider id when the agent stores it separately or the adapter can
	/// infer it safely.
	pub provider_id: Option<String>,

	/// Provider-local model id when known.
	pub model_id: String,

	/// Full agent-specific model id.
	///
	/// This is useful for agents such as OpenCode where the selected model may
	/// be a provider-qualified route and the model id itself may contain `/`.
	pub qualified_model_id: Option<String>,
}

impl AgentModelSelection {
	/// Create a selection with only a model id.
	pub fn model(model_id: impl Into<String>) -> Self {
		Self {
			provider_id: None,
			model_id: model_id.into(),
			qualified_model_id: None,
		}
	}

	/// Create a selection with separate provider and model ids.
	pub fn provider_model(
		provider_id: impl Into<String>,
		model_id: impl Into<String>,
	) -> Self {
		Self {
			provider_id: Some(provider_id.into()),
			model_id: model_id.into(),
			qualified_model_id: None,
		}
	}

	/// Create a selection where the agent persists one qualified model id.
	pub fn qualified(qualified_model_id: impl Into<String>) -> Self {
		let qualified_model_id = qualified_model_id.into();
		Self {
			provider_id: None,
			model_id: qualified_model_id.clone(),
			qualified_model_id: Some(qualified_model_id),
		}
	}
}

/// Complete provider state loaded from an agent.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentProviderState {
	/// Providers currently visible in the agent config.
	#[serde(default)]
	pub providers: Vec<AgentProviderBinding>,

	/// Primary/default model selection.
	pub default_model: Option<AgentModelSelection>,

	/// Small/background model selection.
	pub small_model: Option<AgentModelSelection>,
}

impl AgentProviderState {
	/// Validate state against an agent capability profile.
	pub fn validate(
		&self,
		agent_id: &str,
		capabilities: &AgentProviderCapabilities,
	) -> Result<()> {
		if self.providers.len() > 1 {
			capabilities.ensure_supports(
				agent_id,
				AgentProviderCapability::MultipleProviders,
			)?;
		}

		for provider in &self.providers {
			clean_agent_provider_id(provider.id.clone())?;
			match provider.source {
				AgentProviderSource::ClosedSlot => {}
				AgentProviderSource::BuiltIn => capabilities.ensure_supports(
					agent_id,
					AgentProviderCapability::BuiltInProviders,
				)?,
				AgentProviderSource::Custom => capabilities.ensure_supports(
					agent_id,
					AgentProviderCapability::CustomProviders,
				)?,
				AgentProviderSource::StoredCredential => capabilities
					.ensure_supports(
						agent_id,
						AgentProviderCapability::AgentCredentialStore,
					)?,
				AgentProviderSource::External => {}
			}

			if let Some(capability) =
				credential_capability(&provider.credential)
			{
				capabilities.ensure_supports(agent_id, capability)?;
			}
		}

		if let Some(selection) = &self.default_model {
			capabilities.ensure_supports(
				agent_id,
				AgentProviderCapability::DefaultModel,
			)?;
			validate_selection(agent_id, capabilities, selection)?;
		}

		if self.small_model.is_some() {
			capabilities.ensure_supports(
				agent_id,
				AgentProviderCapability::SmallModel,
			)?;
			if let Some(selection) = &self.small_model {
				validate_selection(agent_id, capabilities, selection)?;
			}
		}

		Ok(())
	}
}

/// Adapter boundary implemented by agent-specific provider config handlers.
pub trait AgentProviderAdapter {
	/// Stable agent id, for example `claude`, `opencode`, or `codex`.
	fn agent_id(&self) -> &'static str;

	/// Provider-management capabilities for this agent.
	fn capabilities(&self) -> AgentProviderCapabilities;

	/// Load provider state from the agent's backing config.
	fn load_providers(&self) -> Result<AgentProviderState>;

	/// Persist provider state to the agent's backing config.
	fn save_providers(&self, state: &AgentProviderState) -> Result<()>;
}

fn clean_agent_provider_id(id: String) -> Result<String> {
	let id = id.trim().to_string();
	if id.is_empty() {
		Err(InferenceProviderError::EmptyAgentProviderId)
	} else {
		Ok(id)
	}
}

fn credential_capability(
	credential: &AgentProviderCredential,
) -> Option<AgentProviderCapability> {
	match credential {
		AgentProviderCredential::None => None,
		AgentProviderCredential::EnvVar { .. } => {
			Some(AgentProviderCapability::EnvVarCredentials)
		}
		AgentProviderCredential::AgentStore { .. } => {
			Some(AgentProviderCapability::AgentCredentialStore)
		}
		AgentProviderCredential::Inline => {
			Some(AgentProviderCapability::InlineApiKeyCredentials)
		}
	}
}

fn validate_selection(
	agent_id: &str,
	capabilities: &AgentProviderCapabilities,
	selection: &AgentModelSelection,
) -> Result<()> {
	if selection.provider_id.is_some()
		&& !capabilities.supports(AgentProviderCapability::DefaultProvider)
	{
		capabilities.ensure_supports(
			agent_id,
			AgentProviderCapability::ProviderQualifiedModel,
		)?;
	}

	if selection.qualified_model_id.is_some() {
		capabilities.ensure_supports(
			agent_id,
			AgentProviderCapability::ProviderQualifiedModel,
		)?;
	}

	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	fn provider() -> InferenceProvider {
		InferenceProvider {
			id: "inventory-id".to_string(),
			name: "openrouter".to_string(),
			display_name: "OpenRouter".to_string(),
			format: InferenceProviderFormat::OpenAiResponses,
			api_base_url: "https://openrouter.ai/api/v1".to_string(),
			preset: None,
			masked_api_key: "sk****st".to_string(),
			models: vec![
				"openai/gpt-5.4".to_string(),
				"anthropic/claude-sonnet-4-5".to_string(),
			],
		}
	}

	#[test]
	fn closed_single_caps_do_not_support_multiple_providers() {
		let caps = AgentProviderCapabilities::closed_single(
			AgentProviderDefaultSupport::MODEL_ONLY,
			AgentCredentialSupport::ENV_VAR,
		);

		assert!(caps.supports(AgentProviderCapability::DefaultModel));
		assert!(!caps.supports(AgentProviderCapability::CustomProviders));
		assert!(!caps.supports(AgentProviderCapability::MultipleProviders));
	}

	#[test]
	fn opencode_caps_support_registry_and_qualified_models() {
		let caps = AgentProviderCapabilities::registry(
			AgentProviderDefaultSupport::QUALIFIED_MODELS,
			AgentCredentialSupport::ENV_VAR_INLINE_OR_AGENT_STORE,
			BuiltInProviderSupport::OVERRIDABLE,
		);

		assert!(caps.supports(AgentProviderCapability::CustomProviders));
		assert!(caps.supports(AgentProviderCapability::MultipleProviders));
		assert!(caps.supports(AgentProviderCapability::ProviderQualifiedModel));
		assert!(caps.supports(AgentProviderCapability::InlineApiKeyCredentials));
		assert!(!caps.supports(AgentProviderCapability::DefaultProvider));
	}

	#[test]
	fn codex_caps_support_default_provider_and_registry() {
		let caps = AgentProviderCapabilities::registry(
			AgentProviderDefaultSupport::PROVIDER_AND_MODEL,
			AgentCredentialSupport::ENV_VAR_INLINE_OR_AGENT_STORE,
			BuiltInProviderSupport::IMMUTABLE,
		);

		assert!(caps.supports(AgentProviderCapability::DefaultProvider));
		assert!(caps.supports(AgentProviderCapability::CustomProviders));
		assert!(caps.supports(AgentProviderCapability::InlineApiKeyCredentials));
		assert!(
			!caps.supports(AgentProviderCapability::OverrideBuiltInProviders)
		);
	}

	#[test]
	fn binding_from_inventory_keeps_inventory_id_separate() {
		let binding = AgentProviderBinding::from_inventory(
			"openrouter",
			&provider(),
			AgentProviderCredential::EnvVar {
				name: "OPENROUTER_API_KEY".to_string(),
			},
			AgentProviderSource::Custom,
		)
		.unwrap();

		assert_eq!(binding.id, "openrouter");
		assert_eq!(binding.name, "OpenRouter");
		assert_eq!(binding.source_provider_id.as_deref(), Some("inventory-id"));
		assert_eq!(binding.models.len(), 2);
	}

	#[test]
	fn binding_rejects_empty_agent_provider_id() {
		let err = AgentProviderBinding::from_inventory(
			" ",
			&provider(),
			AgentProviderCredential::None,
			AgentProviderSource::Custom,
		)
		.unwrap_err();

		assert!(matches!(err, InferenceProviderError::EmptyAgentProviderId));
	}

	#[test]
	fn state_validation_rejects_unsupported_small_model() {
		let caps = AgentProviderCapabilities::registry(
			AgentProviderDefaultSupport::PROVIDER_AND_MODEL,
			AgentCredentialSupport::ENV_VAR,
			BuiltInProviderSupport::IMMUTABLE,
		);
		let state = AgentProviderState {
			providers: Vec::new(),
			default_model: None,
			small_model: Some(AgentModelSelection::model("gpt-5.4-mini")),
		};

		let err = state.validate("codex", &caps).unwrap_err();
		assert!(matches!(
			err,
			InferenceProviderError::UnsupportedAgentProviderCapability { .. }
		));
	}

	#[test]
	fn state_validation_checks_source_and_credentials() {
		let caps = AgentProviderCapabilities::closed_single(
			AgentProviderDefaultSupport::MODEL_ONLY,
			AgentCredentialSupport::ENV_VAR,
		);
		let provider = AgentProviderBinding::from_inventory(
			"primary",
			&provider(),
			AgentProviderCredential::Inline,
			AgentProviderSource::Custom,
		)
		.unwrap();
		let state = AgentProviderState {
			providers: vec![provider],
			default_model: None,
			small_model: None,
		};

		let err = state.validate("claude", &caps).unwrap_err();
		assert!(matches!(
			err,
			InferenceProviderError::UnsupportedAgentProviderCapability { .. }
		));
	}

	#[test]
	fn state_validation_accepts_opencode_qualified_selection() {
		let caps = AgentProviderCapabilities::registry(
			AgentProviderDefaultSupport::QUALIFIED_MODELS,
			AgentCredentialSupport::ENV_VAR_INLINE_OR_AGENT_STORE,
			BuiltInProviderSupport::OVERRIDABLE,
		);
		let state = AgentProviderState {
			providers: Vec::new(),
			default_model: Some(AgentModelSelection {
				provider_id: Some("anthropic".to_string()),
				model_id: "claude-sonnet-4-5".to_string(),
				qualified_model_id: Some(
					"anthropic/claude-sonnet-4-5".to_string(),
				),
			}),
			small_model: None,
		};

		state.validate("opencode", &caps).unwrap();
	}

	#[test]
	fn state_validation_rejects_multiple_closed_slot_bindings() {
		let caps = AgentProviderCapabilities::closed_single(
			AgentProviderDefaultSupport::MODEL_ONLY,
			AgentCredentialSupport::ENV_VAR,
		);
		let first = AgentProviderBinding::from_inventory(
			"primary",
			&provider(),
			AgentProviderCredential::EnvVar {
				name: "ANTHROPIC_API_KEY".to_string(),
			},
			AgentProviderSource::ClosedSlot,
		)
		.unwrap();
		let second = AgentProviderBinding {
			id: "secondary".to_string(),
			..first.clone()
		};
		let state = AgentProviderState {
			providers: vec![first, second],
			default_model: None,
			small_model: None,
		};

		let err = state.validate("claude", &caps).unwrap_err();
		assert!(matches!(
			err,
			InferenceProviderError::UnsupportedAgentProviderCapability { .. }
		));
	}
}
