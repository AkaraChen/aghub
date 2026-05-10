//! File I/O for Claude Code provider config.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::AGENT_ID;
use crate::error::{InferenceProviderError, Result};

pub(super) fn read_config(path: &Path) -> Result<Value> {
	let content = match fs::read_to_string(path) {
		Ok(content) => content,
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			return Ok(Value::Object(Default::default()));
		}
		Err(error) => return Err(error.into()),
	};

	serde_json::from_str(&content)
		.map_err(|error| invalid_config(path, error.to_string()))
}

pub(super) fn write_config(path: &Path, config: &Value) -> Result<()> {
	if let Some(parent) = path.parent() {
		fs::create_dir_all(parent)?;
	}
	let json = serde_json::to_string_pretty(config).map_err(|e| {
		InferenceProviderError::InvalidAgentProviderConfig {
			agent_id: AGENT_ID.to_string(),
			path: path.display().to_string(),
			message: e.to_string(),
		}
	})?;
	fs::write(path, json)?;
	Ok(())
}

pub(super) fn default_global_config_path() -> Result<PathBuf> {
	dirs::home_dir()
		.map(|home| home.join(".claude").join("settings.json"))
		.ok_or_else(home_dir_error)
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
