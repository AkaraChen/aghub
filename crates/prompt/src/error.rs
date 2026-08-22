/// Errors raised while loading or mutating the prompt library.
#[derive(Debug, thiserror::Error)]
pub enum PromptError {
	#[error("prompt '{0}' not found")]
	NotFound(String),

	#[error("prompt title cannot be empty")]
	EmptyTitle,

	#[error("invalid prompt backup: {0}")]
	InvalidBackup(String),

	#[error("unsupported prompt backup version: {0}")]
	UnsupportedBackupVersion(u32),

	#[error(transparent)]
	Io(#[from] std::io::Error),

	#[error(transparent)]
	Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, PromptError>;
