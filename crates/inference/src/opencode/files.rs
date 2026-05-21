//! File I/O for OpenCode provider config and auth storage.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use aghub_json::{parse_jsonc_opt, patch_jsonc_object};
use serde_json::Value;

use super::schema::OpenCodeConfig;
use super::AGENT_ID;
use crate::error::{InferenceProviderError, Result};

pub(super) fn read_config(path: &Path) -> Result<OpenCodeConfig> {
	let content = match fs::read_to_string(path) {
		Ok(content) => content,
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			return Ok(OpenCodeConfig::default());
		}
		Err(error) => return Err(error.into()),
	};

	parse_jsonc_opt(&content)
		.map(|config| config.unwrap_or_default())
		.map_err(|error| invalid_config(path, error.to_string()))
}

pub(super) fn write_config(path: &Path, config: OpenCodeConfig) -> Result<()> {
	if let Some(parent) = path.parent() {
		fs::create_dir_all(parent)?;
	}

	let existing = existing_content(path)?;
	let content = patch_jsonc_object(existing.as_deref(), &config)
		.map_err(|error| invalid_config(path, error.to_string()))?;
	fs::write(path, content)?;
	Ok(())
}

pub(super) fn read_auth_values(path: &Path) -> Result<BTreeMap<String, Value>> {
	let content = match fs::read_to_string(path) {
		Ok(content) => content,
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			return Ok(BTreeMap::new());
		}
		Err(error) => return Err(error.into()),
	};

	parse_jsonc_opt(&content)
		.map(|auth| auth.unwrap_or_default())
		.map_err(|error| invalid_auth(path, error.to_string()))
}

pub(super) fn write_auth_values(
	path: &Path,
	auth: &BTreeMap<String, Value>,
) -> Result<()> {
	if let Some(parent) = path.parent() {
		fs::create_dir_all(parent)?;
	}

	let existing = existing_content(path)?;
	let content = patch_jsonc_object(existing.as_deref(), auth)
		.map_err(|error| invalid_auth(path, error.to_string()))?;

	let mut options = fs::OpenOptions::new();
	options.create(true).truncate(true).write(true);
	#[cfg(unix)]
	{
		use std::os::unix::fs::OpenOptionsExt;
		options.mode(0o600);
	}
	let mut file = options.open(path)?;
	file.write_all(content.as_bytes())?;
	#[cfg(unix)]
	{
		use std::os::unix::fs::PermissionsExt;
		fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
	}
	Ok(())
}

pub(super) fn default_global_config_path() -> Result<PathBuf> {
	let config_home = std::env::var_os("XDG_CONFIG_HOME")
		.map(PathBuf::from)
		.or_else(|| dirs::home_dir().map(|home| home.join(".config")))
		.ok_or_else(home_dir_error)?;
	Ok(config_home.join("opencode/opencode.json"))
}

pub(super) fn default_auth_path() -> Result<PathBuf> {
	let data_home = std::env::var_os("XDG_DATA_HOME")
		.map(PathBuf::from)
		.or_else(|| dirs::home_dir().map(|home| home.join(".local/share")))
		.ok_or_else(home_dir_error)?;
	Ok(data_home.join("opencode/auth.json"))
}

fn existing_content(path: &Path) -> Result<Option<String>> {
	match fs::read_to_string(path) {
		Ok(content) => Ok(Some(content)),
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
		Err(error) => Err(error.into()),
	}
}

pub(super) fn home_dir_error() -> InferenceProviderError {
	InferenceProviderError::Io(std::io::Error::new(
		std::io::ErrorKind::NotFound,
		"home directory not found",
	))
}

fn invalid_config(
	path: &Path,
	message: impl Into<String>,
) -> InferenceProviderError {
	InferenceProviderError::InvalidAgentProviderConfig {
		agent_id: AGENT_ID.to_string(),
		path: path.display().to_string(),
		message: message.into(),
	}
}

fn invalid_auth(
	path: &Path,
	message: impl Into<String>,
) -> InferenceProviderError {
	InferenceProviderError::InvalidAgentCredentialStore {
		agent_id: AGENT_ID.to_string(),
		path: path.display().to_string(),
		message: message.into(),
	}
}
