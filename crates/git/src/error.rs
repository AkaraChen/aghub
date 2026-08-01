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

	/// Local repository metadata could not be inspected.
	#[error("Git repository inspection failed: {0}")]
	RepositoryInspection(String),

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

	/// Remote advertised more branch data than the caller can safely retain.
	#[error("Remote branch advertisement exceeds its configured limit")]
	RemoteBranchLimit,

	/// Remote command produced more output than the caller can retain.
	#[error("Remote branch output exceeds its configured byte limit")]
	RemoteOutputLimit,

	/// Clone created more filesystem entries than allowed.
	#[error("Clone exceeds its {limit}-entry limit")]
	CloneEntryLimit { limit: usize },

	/// Clone wrote more bytes than allowed.
	#[error("Clone exceeds its {limit}-byte limit")]
	CloneByteLimit { limit: u64 },

	/// The caller cancelled the operation.
	#[error("Git operation was cancelled")]
	Cancelled,

	/// The operation exceeded its deadline.
	#[error("Git operation timed out")]
	TimedOut,

	/// The controlled Git child returned a failing status.
	#[error("Git {operation} failed with status {status}")]
	CommandFailed {
		/// Operation being performed.
		operation: &'static str,
		/// Process exit status or signal description.
		status: String,
	},

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
