//! Inference provider configuration storage.
//!
//! Provider metadata is stored in `inference_providers.json` under the app data
//! directory. API keys are stored separately via the platform-native keyring.

pub mod credentials;
pub mod error;
pub mod model;
pub mod store;

pub use credentials::{CredentialStore, NativeCredentialStore};
pub use error::{InferenceProviderError, Result};
pub use model::{
	CreateInferenceProvider, InferenceProvider, InferenceProviderFormat,
	UpdateInferenceProvider,
};
pub use store::{
	InferenceProviderRepository, InferenceProviderStore,
	INFERENCE_PROVIDERS_FILE,
};
