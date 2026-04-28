//! File I/O for Codex provider config.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use toml_edit::DocumentMut;

use super::AGENT_ID;
use crate::error::{InferenceProviderError, Result};

pub(super) fn read_config(path: &Path) -> Result<DocumentMut> {
	let content = match fs::read_to_string(path) {
		Ok(content) => content,
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			return Ok(DocumentMut::new());
		}
		Err(error) => return Err(error.into()),
	};

	content
		.parse::<DocumentMut>()
		.map_err(|error| invalid_config(path, error.to_string()))
}

pub(super) fn write_config(path: &Path, config: &DocumentMut) -> Result<()> {
	if let Some(parent) = path.parent() {
		fs::create_dir_all(parent)?;
	}
	fs::write(path, config.to_string())?;
	Ok(())
}

pub(super) fn read_auth(path: &Path) -> Result<Value> {
	let content = match fs::read_to_string(path) {
		Ok(content) => content,
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			return Ok(json!({}));
		}
		Err(error) => return Err(error.into()),
	};

	serde_json::from_str(&content)
		.map_err(|error| invalid_credential_store(path, error.to_string()))
}

pub(super) fn write_auth(path: &Path, auth: &Value) -> Result<()> {
	if let Some(parent) = path.parent() {
		fs::create_dir_all(parent)?;
	}
	let json = serde_json::to_string_pretty(auth)
		.map_err(|error| invalid_credential_store(path, error.to_string()))?;
	fs::write(path, json)?;
	Ok(())
}

pub(super) fn default_global_config_path() -> Result<PathBuf> {
	let codex_home = std::env::var_os("CODEX_HOME")
		.map(PathBuf::from)
		.or_else(|| dirs::home_dir().map(|home| home.join(".codex")))
		.ok_or_else(home_dir_error)?;
	Ok(codex_home.join("config.toml"))
}

fn home_dir_error() -> InferenceProviderError {
	InferenceProviderError::Io(std::io::Error::new(
		std::io::ErrorKind::NotFound,
		"home directory not found",
	))
}

pub(super) fn invalid_config(
	path: &Path,
	message: impl Into<String>,
) -> InferenceProviderError {
	InferenceProviderError::InvalidAgentProviderConfig {
		agent_id: AGENT_ID.to_string(),
		path: path.display().to_string(),
		message: message.into(),
	}
}

fn invalid_credential_store(
	path: &Path,
	message: impl Into<String>,
) -> InferenceProviderError {
	InferenceProviderError::InvalidAgentCredentialStore {
		agent_id: AGENT_ID.to_string(),
		path: path.display().to_string(),
		message: message.into(),
	}
}
