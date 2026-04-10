use super::mcp;
use crate::errors::{ConfigError, Result};
use crate::models::{Credential, CredentialType, ResourceScope};
use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

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
	experimental_bearer_token: Option<String>,
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
		if other.experimental_bearer_token.is_some() {
			self.experimental_bearer_token =
				other.experimental_bearer_token.clone();
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
	for (id, provider) in profile_override_providers(&config) {
		let Some(base) = clean_string(provider.base_url.clone()) else {
			continue;
		};

		let mut credential = Credential::new(
			clean_string(provider.name.clone()).unwrap_or(id.clone()),
			infer_provider_type(&id, &provider),
		);
		credential.base = Some(base);
		credential.key = resolve_provider_key(&provider);
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
		ResourceScope::ProjectOnly | ResourceScope::Both => {
			let _ = project_root;
			Err(ConfigError::unsupported_operation(
				"import",
				"credentials in non-global scope",
				"codex",
			))
		}
	}
}

fn profile_override_providers(
	config: &CodexConfig,
) -> HashMap<String, CodexProvider> {
	let mut providers = HashMap::new();

	let Some(active_profile) = clean_string(config.profile.clone()) else {
		return providers;
	};
	let Some(profile) = config.profiles.get(&active_profile) else {
		return providers;
	};

	for (provider_id, profile_provider) in &profile.model_providers {
		if clean_string(profile_provider.base_url.clone()).is_none() {
			continue;
		}

		let mut merged = config
			.model_providers
			.get(provider_id)
			.cloned()
			.unwrap_or_default();
		merged.merge_from(profile_provider);
		providers.insert(provider_id.clone(), merged);
	}

	providers
}

fn infer_provider_type(id: &str, provider: &CodexProvider) -> CredentialType {
	if id.to_ascii_lowercase().contains("anthropic")
		|| provider
			.name
			.as_deref()
			.unwrap_or_default()
			.to_ascii_lowercase()
			.contains("anthropic")
	{
		return CredentialType::Anthropic;
	}

	CredentialType::Openai
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

fn resolve_provider_key(provider: &CodexProvider) -> Option<String> {
	clean_string(provider.experimental_bearer_token.clone())
		.or_else(|| resolve_env_key(provider.env_key.clone()))
}

fn resolve_env_key(env_key: Option<String>) -> Option<String> {
	let env_key = clean_string(env_key)?;
	std::env::var(&env_key)
		.ok()
		.and_then(|value| clean_string(Some(value)))
}
