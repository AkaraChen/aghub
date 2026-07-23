use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum GatewayError {
	#[error("gateway instance not found: {0}")]
	InstanceNotFound(String),

	#[error("gateway instance already exists: {0}")]
	InstanceExists(String),

	#[error("{0}")]
	Invalid(String),

	/// Management API responded with a non-success status.
	#[error("management API error ({status}): {message}")]
	Management { status: u16, message: String },

	/// The instance did not answer on its management endpoint.
	#[error("gateway unreachable at {base_url}: {message}")]
	Unreachable { base_url: String, message: String },

	#[error("gateway binary not provisioned (version {0})")]
	NotProvisioned(String),

	#[error("download failed: {0}")]
	Download(String),

	#[error("checksum mismatch for {0}")]
	ChecksumMismatch(String),

	#[error("archive extraction failed: {0}")]
	Extract(String),

	#[error("gateway process error: {0}")]
	Process(String),

	#[error("home directory is unavailable; cannot locate CLIProxyAPI config")]
	HomeDirectoryUnavailable,

	#[error("config file error at {path}: {message}")]
	ConfigFile { path: PathBuf, message: String },

	#[error(transparent)]
	Keyring(#[from] keyring::Error),

	#[error(transparent)]
	Io(#[from] std::io::Error),

	#[error(transparent)]
	Json(#[from] serde_json::Error),

	#[error(transparent)]
	Http(#[from] reqwest::Error),
}

pub type Result<T> = std::result::Result<T, GatewayError>;
