//! Error types for git operations.

use std::path::PathBuf;

/// Error type for git clone operations.
#[derive(Debug, thiserror::Error)]
pub enum GitError {
	/// I/O error.
	#[error("IO error: {0}")]
	Io(#[from] std::io::Error),

	/// Git clone error from gix.
	#[error("Git clone failed: {0}")]
	CloneFailed(String),

	/// Invalid URL format.
	#[error("Invalid URL: {0}")]
	InvalidUrl(String),

	/// URL parse error.
	#[error("URL parse error: {0}")]
	UrlParse(#[from] url::ParseError),

	/// Failed to create temp directory.
	#[error("Failed to create temp directory: {0}")]
	TempDirFailed(String),

	/// Not an HTTPS URL.
	#[error("Not an HTTPS URL: {0}")]
	NotHttps(String),

	/// Clone destination error.
	#[error("Clone destination error at {path}: {reason}")]
	DestinationError {
		/// Path where the error occurred.
		path: PathBuf,
		/// Reason for the error.
		reason: String,
	},
}

impl GitError {
	/// Create a clone failed error with a message.
	pub fn clone_failed(msg: impl Into<String>) -> Self {
		Self::CloneFailed(msg.into())
	}

	/// Create an invalid URL error.
	pub fn invalid_url(url: impl Into<String>) -> Self {
		Self::InvalidUrl(url.into())
	}

	/// Create a not HTTPS error.
	pub fn not_https(url: impl Into<String>) -> Self {
		Self::NotHttps(url.into())
	}

	/// Create a destination error.
	pub fn destination_error(
		path: impl Into<PathBuf>,
		reason: impl Into<String>,
	) -> Self {
		Self::DestinationError {
			path: path.into(),
			reason: reason.into(),
		}
	}
}

/// Result type alias for git operations.
pub type Result<T> = std::result::Result<T, GitError>;
