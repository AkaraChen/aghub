//! Error types for inference provider storage.

/// Error type for inference provider operations.
#[derive(Debug, thiserror::Error)]
pub enum InferenceProviderError {
	/// I/O error.
	#[error("IO error: {0}")]
	Io(#[from] std::io::Error),

	/// JSON serialization or deserialization error.
	#[error("JSON error: {0}")]
	Json(#[from] serde_json::Error),

	/// Platform keyring error.
	#[error("keyring error: {0}")]
	Keyring(String),

	/// Provider names must not be empty.
	#[error("provider name cannot be empty")]
	EmptyName,

	/// API keys must not be empty.
	#[error("provider API key cannot be empty")]
	EmptyApiKey,

	/// API base URLs must not be empty.
	#[error("provider API base URL cannot be empty")]
	EmptyApiBaseUrl,

	/// Provider name is already in use.
	#[error("provider already exists: {0}")]
	AlreadyExists(String),

	/// Provider format is not supported.
	#[error("unsupported inference provider format: {0}")]
	InvalidFormat(String),

	/// Provider ID was not found.
	#[error("provider not found: {0}")]
	NotFound(String),

	/// Tauri app data directory could not be resolved.
	#[error("failed to resolve Tauri app data directory: {0}")]
	AppDataDir(String),
}

impl From<keyring::Error> for InferenceProviderError {
	fn from(error: keyring::Error) -> Self {
		Self::Keyring(error.to_string())
	}
}

/// Result type alias for inference provider operations.
pub type Result<T> = std::result::Result<T, InferenceProviderError>;
