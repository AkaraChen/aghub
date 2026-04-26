use std::fs;

use toml_edit::{DocumentMut, Item};

use super::*;
use crate::agent::{
	AgentProviderAdapter, AgentProviderCredential, AgentProviderSource,
};
use crate::error::InferenceProviderError;
use crate::model::{InferenceProvider, InferenceProviderFormat};

fn adapter(temp: &tempfile::TempDir) -> CodexProviderAdapter {
	CodexProviderAdapter::new(temp.path().join("config.toml"))
}

fn provider() -> InferenceProvider {
	InferenceProvider {
		id: "inventory-id".to_string(),
		name: "openrouter".to_string(),
		display_name: "OpenRouter".to_string(),
		format: InferenceProviderFormat::OpenAiResponses,
		api_base_url: "https://openrouter.ai/api/v1".to_string(),
		masked_api_key: "sk****st".to_string(),
		models: vec!["openai/gpt-5.4".to_string()],
	}
}

#[test]
fn load_reads_model_providers_and_default_selection() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"
model = "openai/gpt-5.4"
model_provider = "openrouter"

[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
wire_api = "responses"
env_key = "OPENROUTER_API_KEY"
"#,
	)
	.unwrap();

	let state = adapter.load_providers().unwrap();

	assert_eq!(state.providers.len(), 2);
	let provider = state
		.providers
		.iter()
		.find(|provider| provider.id == "openrouter")
		.unwrap();
	assert_eq!(provider.id, "openrouter");
	assert_eq!(provider.name, "OpenRouter");
	assert_eq!(
		provider.format,
		Some(InferenceProviderFormat::OpenAiResponses)
	);
	assert_eq!(
		provider.api_base_url.as_deref(),
		Some("https://openrouter.ai/api/v1")
	);
	assert_eq!(
		provider.credential,
		AgentProviderCredential::EnvVar {
			name: "OPENROUTER_API_KEY".to_string()
		}
	);
	let default = state.default_model.unwrap();
	assert_eq!(default.provider_id.as_deref(), Some("openrouter"));
	assert_eq!(default.model_id, "openai/gpt-5.4");
}

#[test]
fn profile_state_defaults_to_openai_login() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(adapter.config_path(), r#"model = "gpt-5.4""#).unwrap();

	let state = adapter.load_profile_state().unwrap();

	assert_eq!(state.active_profile_id, DEFAULT_PROFILE_ID);
	assert_eq!(state.providers.len(), 1);
	let openai = &state.providers[0];
	assert_eq!(openai.id, "openai");
	assert_eq!(openai.source, AgentProviderSource::BuiltIn);
	assert_eq!(openai.api_base_url, None);
	assert_eq!(
		openai.credential,
		AgentProviderCredential::AgentStore {
			id: Some("openai".to_string())
		}
	);
	let profile = &state.profiles[0];
	assert!(profile.is_default);
	assert!(profile.is_active);
	assert_eq!(profile.selected_provider_id, "openai");
	assert_eq!(profile.model.as_deref(), Some("gpt-5.4"));
}

#[test]
fn profile_state_uses_active_profile_overrides() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"
profile = "work"
model = "gpt-5.4"
model_provider = "openai"

[profiles.work]
model = "openai/gpt-5.4"
model_provider = "openrouter"

[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
wire_api = "responses"
"#,
	)
	.unwrap();

	let state = adapter.load_profile_state().unwrap();

	assert_eq!(state.active_profile_id, "work");
	let work = state
		.profiles
		.iter()
		.find(|profile| profile.id == "work")
		.unwrap();
	assert!(work.is_active);
	assert_eq!(work.selected_provider_id, "openrouter");
	assert_eq!(work.model.as_deref(), Some("openai/gpt-5.4"));
	let default = state
		.profiles
		.iter()
		.find(|profile| profile.is_default)
		.unwrap();
	assert_eq!(default.selected_provider_id, "openai");
	assert_eq!(default.model.as_deref(), Some("gpt-5.4"));
}

#[test]
fn set_active_profile_preserves_comments() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"# user note
model = "gpt-5.4"

[profiles.work]
model_provider = "openrouter"
"#,
	)
	.unwrap();

	let state = adapter.set_active_profile("work").unwrap();

	assert_eq!(state.active_profile_id, "work");
	let content = fs::read_to_string(adapter.config_path()).unwrap();
	assert!(content.contains("# user note"));
	let config = content.parse::<DocumentMut>().unwrap();
	assert_eq!(config["profile"].as_str(), Some("work"));

	let state = adapter.set_active_profile(DEFAULT_PROFILE_ID).unwrap();
	assert_eq!(state.active_profile_id, DEFAULT_PROFILE_ID);
	let config = fs::read_to_string(adapter.config_path())
		.unwrap()
		.parse::<DocumentMut>()
		.unwrap();
	assert!(config.get("profile").is_none());
}

#[test]
fn set_profile_provider_can_select_openai_without_base_or_key() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"
model_provider = "openrouter"

[profiles.work]
model_provider = "openrouter"

[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
wire_api = "responses"
"#,
	)
	.unwrap();

	let state = adapter.set_profile_provider("work", "openai").unwrap();

	let work = state
		.profiles
		.iter()
		.find(|profile| profile.id == "work")
		.unwrap();
	assert_eq!(work.selected_provider_id, "openai");
	let content = fs::read_to_string(adapter.config_path()).unwrap();
	let config = content.parse::<DocumentMut>().unwrap();
	assert_eq!(
		config["profiles"]["work"]["model_provider"].as_str(),
		Some("openai")
	);

	let state = adapter
		.set_profile_provider(DEFAULT_PROFILE_ID, "openai")
		.unwrap();
	let default = state
		.profiles
		.iter()
		.find(|profile| profile.is_default)
		.unwrap();
	assert_eq!(default.selected_provider_id, "openai");
	let config = fs::read_to_string(adapter.config_path())
		.unwrap()
		.parse::<DocumentMut>()
		.unwrap();
	assert!(config.get("model_provider").is_none());
}

#[test]
fn add_provider_writes_responses_config_and_inline_token() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);

	let binding = adapter
		.add_provider("openrouter", &provider(), "sk-test")
		.unwrap();

	assert_eq!(binding.name, "OpenRouter");
	assert_eq!(
		binding.format,
		Some(InferenceProviderFormat::OpenAiResponses)
	);
	let content = fs::read_to_string(adapter.config_path()).unwrap();
	let config = content.parse::<DocumentMut>().unwrap();
	let provider = config["model_providers"]["openrouter"].as_table().unwrap();
	assert_eq!(provider["name"].as_str(), Some("OpenRouter"));
	assert_eq!(
		provider["base_url"].as_str(),
		Some("https://openrouter.ai/api/v1")
	);
	assert_eq!(provider["wire_api"].as_str(), Some("responses"));
	assert_eq!(
		provider["experimental_bearer_token"].as_str(),
		Some("sk-test")
	);
}

#[test]
fn add_provider_rejects_chat_completion_inventory() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	let mut provider = provider();
	provider.format = InferenceProviderFormat::OpenAiCompletions;

	let error = adapter
		.add_provider("openrouter", &provider, "sk-test")
		.unwrap_err();

	assert!(matches!(error, InferenceProviderError::InvalidFormat(_)));
}

#[test]
fn update_provider_edits_name_and_token_preserving_comments() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"# user note
model = "gpt-5.4"

[model_providers.openrouter]
# provider note
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
wire_api = "responses"
experimental_bearer_token = "sk-old"
"#,
	)
	.unwrap();

	let binding = adapter
		.update_provider("openrouter", Some("OpenRouter Team"), Some("sk-new"))
		.unwrap();

	assert_eq!(binding.name, "OpenRouter Team");
	let content = fs::read_to_string(adapter.config_path()).unwrap();
	assert!(content.contains("# user note"));
	assert!(content.contains("# provider note"));
	let config = content.parse::<DocumentMut>().unwrap();
	let provider = config["model_providers"]["openrouter"].as_table().unwrap();
	assert_eq!(provider["name"].as_str(), Some("OpenRouter Team"));
	assert_eq!(
		provider["experimental_bearer_token"].as_str(),
		Some("sk-new")
	);
}

#[test]
fn api_key_reads_inline_token() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"
[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
experimental_bearer_token = "sk-inline"
"#,
	)
	.unwrap();

	assert_eq!(
		adapter.api_key("openrouter").unwrap(),
		Some("sk-inline".to_string())
	);
}

#[test]
fn api_key_for_openai_login_provider_is_not_config_backed() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);

	assert_eq!(adapter.api_key("openai").unwrap(), None);
}

#[test]
fn remove_provider_clears_default_provider() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"
model = "openai/gpt-5.4"
model_provider = "openrouter"

[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
"#,
	)
	.unwrap();

	let removed = adapter.remove_provider("openrouter").unwrap();

	assert_eq!(removed.id, "openrouter");
	let content = fs::read_to_string(adapter.config_path()).unwrap();
	let config = content.parse::<DocumentMut>().unwrap();
	assert!(config.get("model_provider").is_none());
	assert!(config
		.get("model_providers")
		.and_then(Item::as_table)
		.and_then(|providers| providers.get("openrouter"))
		.is_none());
}
