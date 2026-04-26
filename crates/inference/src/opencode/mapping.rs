//! Mapping between OpenCode provider files and normalized agent state.

use std::collections::BTreeMap;

use serde_json::Value;

use super::schema::OpenCodeProviderConfig;
use crate::agent::{
	AgentModelSelection, AgentProviderBinding, AgentProviderCredential,
	AgentProviderModel, AgentProviderSource,
};
use crate::error::{InferenceProviderError, Result};
use crate::model::InferenceProviderFormat;

const OPENAI_COMPATIBLE_NPM: &str = "@ai-sdk/openai-compatible";
const OPENAI_NPM: &str = "@ai-sdk/openai";
const ANTHROPIC_NPM: &str = "@ai-sdk/anthropic";

pub(super) fn binding_from_config(
	provider_id: &str,
	provider: &OpenCodeProviderConfig,
	auth: &BTreeMap<String, Value>,
) -> Result<AgentProviderBinding> {
	Ok(AgentProviderBinding {
		id: clean_provider_id(provider_id)?,
		source_provider_id: None,
		name: provider
			.name
			.clone()
			.unwrap_or_else(|| provider_id.to_string()),
		format: provider.npm.as_deref().and_then(format_from_npm),
		api_base_url: provider
			.options
			.get("baseURL")
			.and_then(Value::as_str)
			.or_else(|| {
				provider.options.get("endpoint").and_then(Value::as_str)
			})
			.map(ToString::to_string),
		credential: credential_from_config(provider_id, provider, auth),
		models: provider
			.models
			.iter()
			.map(|(model_id, model)| AgentProviderModel {
				id: model_id.clone(),
				name: model.name.clone(),
			})
			.collect(),
		source: AgentProviderSource::Custom,
	})
}

pub(super) fn binding_from_auth(
	provider_id: &str,
	entry: &Value,
) -> AgentProviderBinding {
	let credential = match entry.get("type").and_then(Value::as_str) {
		Some("api") | Some("oauth") | Some("wellknown") => {
			AgentProviderCredential::AgentStore {
				id: Some(provider_id.to_string()),
			}
		}
		_ => AgentProviderCredential::None,
	};

	AgentProviderBinding {
		id: provider_id.to_string(),
		source_provider_id: None,
		name: provider_id.to_string(),
		format: None,
		api_base_url: None,
		credential,
		models: Vec::new(),
		source: AgentProviderSource::StoredCredential,
	}
}

pub(super) fn provider_config_from_binding(
	binding: &AgentProviderBinding,
	existing: Option<&OpenCodeProviderConfig>,
) -> OpenCodeProviderConfig {
	let mut provider = existing.cloned().unwrap_or_default();
	if let Some(format) = binding.format {
		provider.npm = Some(npm_from_format(format).to_string());
	}

	provider.name = Some(binding.name.clone());

	if let Some(api_base_url) = &binding.api_base_url {
		provider
			.options
			.insert("baseURL".to_string(), Value::String(api_base_url.clone()));
	} else {
		provider.options.remove("baseURL");
	}

	match &binding.credential {
		AgentProviderCredential::EnvVar { name } => {
			provider.options.insert(
				"apiKey".to_string(),
				Value::String(format!("{{env:{name}}}")),
			);
		}
		AgentProviderCredential::AgentStore { .. } => {
			provider.options.remove("apiKey");
		}
		AgentProviderCredential::None => {
			provider.options.remove("apiKey");
		}
		AgentProviderCredential::Inline => {}
	}

	let original_models = provider.models;
	provider.models = binding
		.models
		.iter()
		.map(|model| {
			let mut next =
				original_models.get(&model.id).cloned().unwrap_or_default();
			next.name = model.name.clone();
			(model.id.clone(), next)
		})
		.collect();

	provider
}

pub(super) fn parse_opencode_model_selection(
	value: &str,
) -> AgentModelSelection {
	let Some((provider_id, model_id)) = value.split_once('/') else {
		return AgentModelSelection::qualified(value.to_string());
	};

	AgentModelSelection {
		provider_id: Some(provider_id.to_string()),
		model_id: model_id.to_string(),
		qualified_model_id: Some(value.to_string()),
	}
}

pub(super) fn format_selection(selection: &AgentModelSelection) -> String {
	if let Some(qualified_model_id) = &selection.qualified_model_id {
		return qualified_model_id.clone();
	}
	if let Some(provider_id) = &selection.provider_id {
		return format!("{provider_id}/{}", selection.model_id);
	}
	selection.model_id.clone()
}

pub(super) fn provider_id_from_name(name: &str) -> String {
	let mut out = String::new();
	let mut previous_was_dash = false;

	for ch in name.chars().flat_map(char::to_lowercase) {
		if ch.is_ascii_alphanumeric() {
			out.push(ch);
			previous_was_dash = false;
		} else if !previous_was_dash && !out.is_empty() {
			out.push('-');
			previous_was_dash = true;
		}
	}

	while out.ends_with('-') {
		out.pop();
	}

	if out.is_empty() {
		"provider".to_string()
	} else {
		out
	}
}

pub(super) fn clean_provider_id(provider_id: &str) -> Result<String> {
	let provider_id = provider_id.trim().trim_end_matches('/').to_string();
	if provider_id.is_empty() {
		Err(InferenceProviderError::EmptyAgentProviderId)
	} else {
		Ok(provider_id)
	}
}

pub(super) fn ensure_api_key(api_key: &str) -> Result<()> {
	if api_key.trim().is_empty() {
		Err(InferenceProviderError::EmptyApiKey)
	} else {
		Ok(())
	}
}

fn credential_from_config(
	provider_id: &str,
	provider: &OpenCodeProviderConfig,
	auth: &BTreeMap<String, Value>,
) -> AgentProviderCredential {
	if auth.contains_key(provider_id) {
		return AgentProviderCredential::AgentStore {
			id: Some(provider_id.to_string()),
		};
	}

	let Some(api_key) = provider.options.get("apiKey").and_then(Value::as_str)
	else {
		return AgentProviderCredential::None;
	};

	parse_env_var_ref(api_key)
		.map(|name| AgentProviderCredential::EnvVar { name })
		.unwrap_or(AgentProviderCredential::Inline)
}

fn format_from_npm(npm: &str) -> Option<InferenceProviderFormat> {
	match npm {
		OPENAI_COMPATIBLE_NPM => {
			Some(InferenceProviderFormat::OpenAiCompletions)
		}
		OPENAI_NPM => Some(InferenceProviderFormat::OpenAiResponses),
		ANTHROPIC_NPM => Some(InferenceProviderFormat::Anthropic),
		_ => None,
	}
}

fn npm_from_format(format: InferenceProviderFormat) -> &'static str {
	match format {
		InferenceProviderFormat::Anthropic => ANTHROPIC_NPM,
		InferenceProviderFormat::OpenAiCompletions => OPENAI_COMPATIBLE_NPM,
		InferenceProviderFormat::OpenAiResponses => OPENAI_NPM,
	}
}

fn parse_env_var_ref(value: &str) -> Option<String> {
	let name = value.strip_prefix("{env:")?.strip_suffix('}')?.trim();
	if name.is_empty() {
		None
	} else {
		Some(name.to_string())
	}
}
