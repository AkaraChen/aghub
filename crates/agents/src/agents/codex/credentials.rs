use super::mcp;
use crate::errors::{ConfigError, Result};
use crate::models::{Credential, CredentialType, ResourceScope};
use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const BUILTIN_PROVIDER_IDS: [&str; 3] = ["openai", "ollama", "lmstudio"];

#[derive(Debug, Default, Deserialize)]
struct CodexConfig {
	profile: Option<String>,
	#[serde(default)]
	model_providers: HashMap<String, CodexProvider>,
	#[serde(default)]
	profiles: HashMap<String, CodexProfile>,
}

#[derive(Debug, Default, Deserialize)]
struct CodexProfile {
	#[serde(default)]
	model_providers: HashMap<String, CodexProvider>,
}

#[derive(Debug, Default, Clone, Deserialize)]
struct CodexProvider {
	name: Option<String>,
	base_url: Option<String>,
	env_key: Option<String>,
}

impl CodexProvider {
	fn merge_from(&mut self, other: &Self) {
		if other.name.is_some() {
			self.name = other.name.clone();
		}
		if other.base_url.is_some() {
			self.base_url = other.base_url.clone();
		}
		if other.env_key.is_some() {
			self.env_key = other.env_key.clone();
		}
	}
}

pub(super) fn import_credientials(
	project_root: Option<&Path>,
	scope: ResourceScope,
) -> Result<Vec<Credential>> {
	let Some(path) = config_path(project_root, scope)? else {
		return Ok(Vec::new());
	};

	let content = match fs::read_to_string(&path) {
		Ok(content) => content,
		Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
			return Ok(Vec::new())
		}
		Err(e) => return Err(e.into()),
	};

	let config: CodexConfig = toml::from_str(&content).map_err(|e| {
		ConfigError::InvalidConfig(format!(
			"Failed to parse Codex config TOML: {e}"
		))
	})?;

	let mut credentials = Vec::new();
	for (id, provider) in merged_providers(config) {
		if BUILTIN_PROVIDER_IDS.contains(&id.as_str()) {
			continue;
		}

		let base = clean_string(provider.base_url);
		if base.is_none() {
			continue;
		}

		let mut credential = Credential::new(
			clean_string(provider.name).unwrap_or(id),
			CredentialType::Openai,
		);
		credential.base = base;
		credential.key = resolve_env_key(provider.env_key);
		credentials.push(credential);
	}

	credentials.sort_by(|a, b| a.name.cmp(&b.name));
	Ok(credentials)
}

fn config_path(
	project_root: Option<&Path>,
	scope: ResourceScope,
) -> Result<Option<PathBuf>> {
	match scope {
		ResourceScope::GlobalOnly => Ok(mcp::global_path()),
		ResourceScope::ProjectOnly => {
			Ok(project_root.and_then(mcp::project_path))
		}
		ResourceScope::Both => Err(ConfigError::InvalidConfig(
			"Credential path unavailable for Both scope".to_string(),
		)),
	}
}

fn merged_providers(config: CodexConfig) -> HashMap<String, CodexProvider> {
	let mut providers = config.model_providers;

	if let Some(profile_name) = config.profile.as_deref() {
		if let Some(profile) = config.profiles.get(profile_name) {
			for (provider_id, profile_provider) in &profile.model_providers {
				let provider =
					providers.entry(provider_id.clone()).or_default();
				provider.merge_from(profile_provider);
			}
		}
	}

	providers
}

fn clean_string(value: Option<String>) -> Option<String> {
	value.and_then(|value| {
		let trimmed = value.trim();
		if trimmed.is_empty() {
			None
		} else {
			Some(trimmed.to_string())
		}
	})
}

fn resolve_env_key(env_key: Option<String>) -> Option<String> {
	let env_key = clean_string(env_key)?;
	std::env::var(&env_key)
		.ok()
		.and_then(|value| clean_string(Some(value)))
}
