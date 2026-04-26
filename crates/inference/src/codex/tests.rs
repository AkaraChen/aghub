use std::fs;

use toml_edit::{DocumentMut, Item};

use super::*;
use crate::agent::{AgentProviderAdapter, AgentProviderCredential};
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

	assert_eq!(state.providers.len(), 1);
	let provider = &state.providers[0];
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
