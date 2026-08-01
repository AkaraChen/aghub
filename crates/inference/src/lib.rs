//! Inference provider configuration storage.
//!
//! Provider metadata is stored in `inference_providers.db` (SQLite) under the
//! app data directory. API keys are stored separately via the platform-native
//! keyring.

pub mod agent;
pub mod claude;
pub mod codex;
pub mod credentials;
pub mod error;
pub mod model;
pub mod model_discovery;
pub mod opencode;
mod provider_endpoint;
pub mod store;

pub use agent::{
	AgentCredentialSupport, AgentModelSelection, AgentProviderAdapter,
	AgentProviderBinding, AgentProviderCapabilities, AgentProviderCapability,
	AgentProviderCredential, AgentProviderDefaultSupport, AgentProviderMode,
	AgentProviderModel, AgentProviderSource, AgentProviderState,
	BuiltInProviderSupport,
};
pub use claude::{
	ClaudeConfigState, ClaudeModelRouting, ClaudeProviderAdapter,
};
pub use codex::{
	CodexProfileState, CodexProviderAdapter, CodexProviderState,
	DEFAULT_PROFILE_ID as CODEX_DEFAULT_PROFILE_ID,
};
pub use credentials::{CredentialStore, NativeCredentialStore};
pub use error::{InferenceProviderError, Result};
pub use model::{
	CreateInferenceProvider, InferenceProvider, InferenceProviderFormat,
	UpdateInferenceProvider,
};
pub use model_discovery::{
	discover_models, ModelDiscoveryError, ModelDiscoveryRequest,
};
pub use opencode::OpenCodeProviderAdapter;
pub use provider_endpoint::provider_credential_scope_matches;
pub use store::{
	AgentProviderBindingModelUpdate, AgentProviderBindingModels,
	AgentProviderBindingRow, InferenceProviderRepository,
	InferenceProviderStore, INFERENCE_PROVIDERS_FILE,
};
