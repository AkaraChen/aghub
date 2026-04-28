//! Mapping between Codex config.toml and normalized agent state.

use serde_json::Value as JsonValue;
use toml_edit::{value, Item, Table};

use crate::agent::{
	AgentProviderBinding, AgentProviderCredential, AgentProviderModel,
	AgentProviderSource,
};
use crate::error::{InferenceProviderError, Result};
use crate::model::InferenceProviderFormat;

pub(super) const OPENAI_PROVIDER_ID: &str = "openai";

const WIRE_API_RESPONSES: &str = "responses";
const AUTHORIZATION_HEADER: &str = "Authorization";
const RESERVED_PROVIDER_IDS: &[&str] =
	&[OPENAI_PROVIDER_ID, "ollama", "lmstudio"];

pub(super) fn built_in_openai_binding(
	api_base_url: Option<String>,
) -> AgentProviderBinding {
	AgentProviderBinding {
		id: OPENAI_PROVIDER_ID.to_string(),
		source_provider_id: None,
		name: "OpenAI".to_string(),
		format: Some(InferenceProviderFormat::OpenAiResponses),
		api_base_url,
		credential: AgentProviderCredential::AgentStore {
			id: Some(OPENAI_PROVIDER_ID.to_string()),
		},
		models: Vec::<AgentProviderModel>::new(),
		source: AgentProviderSource::BuiltIn,
	}
}

pub(super) fn binding_from_table(
	provider_id: &str,
	table: &Table,
) -> Result<AgentProviderBinding> {
	let credential = credential_from_table(table);
	Ok(AgentProviderBinding {
		id: clean_provider_id(provider_id)?,
		source_provider_id: None,
		name: string_field(table, "name")
			.unwrap_or_else(|| provider_id.to_string()),
		format: format_from_table(table),
		api_base_url: string_field(table, "base_url"),
		credential: match credential {
			AgentProviderCredential::AgentStore { .. } => {
				AgentProviderCredential::AgentStore {
					id: Some(provider_id.to_string()),
				}
			}
			other => other,
		},
		models: Vec::<AgentProviderModel>::new(),
		source: AgentProviderSource::Custom,
	})
}

pub(super) fn provider_table_from_binding(
	binding: &AgentProviderBinding,
	api_key: Option<&str>,
	existing: Option<&Table>,
) -> Table {
	let mut table = existing.cloned().unwrap_or_default();
	table["name"] = value(binding.name.clone());
	if let Some(api_base_url) = &binding.api_base_url {
		table["base_url"] = value(api_base_url.clone());
	}
	table["wire_api"] = value(WIRE_API_RESPONSES);
	apply_credential(&mut table, &binding.credential, api_key);
	table
}

pub(super) fn api_key_from_table(table: &Table) -> Option<String> {
	if let Some(token) = string_field(table, "experimental_bearer_token") {
		return Some(token);
	}

	if let Some(env_key) = string_field(table, "env_key") {
		return std::env::var(env_key).ok();
	}

	let auth = table
		.get("http_headers")
		.and_then(Item::as_table_like)
		.and_then(|headers| headers.get(AUTHORIZATION_HEADER))
		.and_then(Item::as_str)?;
	auth.strip_prefix("Bearer ")
		.map(str::trim)
		.filter(|token| !token.is_empty())
		.map(ToString::to_string)
}

pub(super) fn api_key_from_auth_file(auth: &JsonValue) -> Option<String> {
	auth.get("OPENAI_API_KEY")
		.and_then(JsonValue::as_str)
		.map(str::trim)
		.filter(|value| !value.is_empty())
		.map(ToString::to_string)
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
	} else if is_reserved_provider_id(&out) {
		format!("aghub-{out}")
	} else {
		out
	}
}

pub(super) fn clean_provider_id(provider_id: &str) -> Result<String> {
	let provider_id = provider_id.trim().trim_end_matches('/').to_string();
	if provider_id.is_empty() {
		return Err(InferenceProviderError::EmptyAgentProviderId);
	}
	if is_reserved_provider_id(&provider_id) {
		return Err(InferenceProviderError::InvalidAgentProviderConfig {
			agent_id: super::AGENT_ID.to_string(),
			path: "config.toml".to_string(),
			message: format!(
				"'{provider_id}' is a built-in Codex provider id and cannot \
				 be managed as a custom provider"
			),
		});
	}
	Ok(provider_id)
}

pub(super) fn clean_provider_name(name: &str) -> Result<String> {
	let name = name.trim().to_string();
	if name.is_empty() {
		Err(InferenceProviderError::EmptyName)
	} else {
		Ok(name)
	}
}

pub(super) fn ensure_api_key(api_key: &str) -> Result<()> {
	if api_key.trim().is_empty() {
		Err(InferenceProviderError::EmptyApiKey)
	} else {
		Ok(())
	}
}

pub(super) fn ensure_responses_format(
	format: Option<InferenceProviderFormat>,
) -> Result<()> {
	match format {
		Some(InferenceProviderFormat::OpenAiResponses) => Ok(()),
		Some(other) => Err(InferenceProviderError::InvalidFormat(format!(
			"Codex only supports openai_responses providers, got {other}"
		))),
		None => Ok(()),
	}
}

pub(super) fn uses_auth_command(table: &Table) -> bool {
	table.contains_key("auth")
}

pub(super) fn uses_shared_openai_api_key(table: &Table) -> bool {
	table
		.get("requires_openai_auth")
		.and_then(Item::as_bool)
		.unwrap_or(false)
		&& !uses_auth_command(table)
}

fn apply_credential(
	table: &mut Table,
	credential: &AgentProviderCredential,
	api_key: Option<&str>,
) {
	match credential {
		AgentProviderCredential::EnvVar { name } => {
			table["env_key"] = value(name.clone());
			table.remove("experimental_bearer_token");
			table.remove("requires_openai_auth");
			table.remove("auth");
			remove_authorization_header(table);
		}
		AgentProviderCredential::AgentStore { .. } => {
			table.remove("env_key");
			table.remove("experimental_bearer_token");
			remove_authorization_header(table);
			if table.get("auth").is_none() {
				table["requires_openai_auth"] = value(true);
			}
		}
		AgentProviderCredential::Inline => {
			table.remove("env_key");
			table.remove("requires_openai_auth");
			table.remove("auth");
			if let Some(api_key) = api_key {
				table["experimental_bearer_token"] = value(api_key.to_string());
				remove_authorization_header(table);
			}
		}
		AgentProviderCredential::None => {
			table.remove("env_key");
			table.remove("experimental_bearer_token");
			table.remove("requires_openai_auth");
			table.remove("auth");
			remove_authorization_header(table);
		}
	}
}

fn remove_authorization_header(table: &mut Table) {
	let remove_headers = table
		.get_mut("http_headers")
		.and_then(Item::as_table_like_mut)
		.map(|headers| {
			headers.remove(AUTHORIZATION_HEADER);
			headers.is_empty()
		})
		.unwrap_or(false);
	if remove_headers {
		table.remove("http_headers");
	}
}

fn format_from_table(table: &Table) -> Option<InferenceProviderFormat> {
	match string_field(table, "wire_api").as_deref() {
		None | Some(WIRE_API_RESPONSES) => {
			Some(InferenceProviderFormat::OpenAiResponses)
		}
		Some(_) => None,
	}
}

fn credential_from_table(table: &Table) -> AgentProviderCredential {
	if let Some(env_key) = string_field(table, "env_key") {
		return AgentProviderCredential::EnvVar { name: env_key };
	}
	if table.contains_key("experimental_bearer_token")
		|| authorization_header(table).is_some()
	{
		return AgentProviderCredential::Inline;
	}
	if table
		.get("requires_openai_auth")
		.and_then(Item::as_bool)
		.unwrap_or(false)
		|| table.contains_key("auth")
	{
		return AgentProviderCredential::AgentStore { id: None };
	}
	AgentProviderCredential::None
}

fn authorization_header(table: &Table) -> Option<&str> {
	table
		.get("http_headers")
		.and_then(Item::as_table_like)
		.and_then(|headers| headers.get(AUTHORIZATION_HEADER))
		.and_then(Item::as_str)
}

fn string_field(table: &Table, key: &str) -> Option<String> {
	table.get(key)?.as_str().map(ToString::to_string)
}

pub(super) fn is_reserved_provider_id(provider_id: &str) -> bool {
	RESERVED_PROVIDER_IDS
		.iter()
		.any(|reserved| provider_id.eq_ignore_ascii_case(reserved))
}
