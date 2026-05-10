use std::fs;

use serde_json::Value;

use super::*;
use crate::agent::{AgentProviderAdapter, AgentProviderCredential};
use crate::model::{InferenceProvider, InferenceProviderFormat};

fn adapter(temp: &tempfile::TempDir) -> OpenCodeProviderAdapter {
	OpenCodeProviderAdapter::new(
		temp.path().join("opencode.json"),
		temp.path().join("auth.json"),
	)
}

fn provider() -> InferenceProvider {
	InferenceProvider {
		id: "inventory-id".to_string(),
		name: "OpenRouter".to_string(),
		display_name: "OpenRouter".to_string(),
		format: InferenceProviderFormat::OpenAiCompletions,
		api_base_url: "https://openrouter.ai/api/v1".to_string(),
		masked_api_key: "sk****st".to_string(),
		models: vec!["anthropic/claude-sonnet-4-5".to_string()],
	}
}

#[test]
fn load_scans_config_and_auth_store() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"{
			"$schema": "https://opencode.ai/config.json",
			"model": "myprovider/my-model",
			"small_model": "myprovider/small-model",
			"provider": {
				"myprovider": {
					"npm": "@ai-sdk/openai-compatible",
					"name": "My Provider",
					"options": {
						"baseURL": "https://api.example.com/v1"
					},
					"models": {
						"my-model": { "name": "My Model" }
					}
				}
			}
		}"#,
	)
	.unwrap();
	fs::write(
		adapter.auth_path(),
		r#"{
			"myprovider": { "type": "api", "key": "secret" },
			"auth-only": { "type": "oauth", "access": "a", "refresh": "r", "expires": 1 }
		}"#,
	)
	.unwrap();

	let state = adapter.load_providers().unwrap();

	assert_eq!(state.providers.len(), 2);
	let configured = state
		.providers
		.iter()
		.find(|provider| provider.id == "myprovider")
		.unwrap();
	assert_eq!(configured.name, "My Provider");
	assert_eq!(
		configured.format,
		Some(InferenceProviderFormat::OpenAiCompletions)
	);
	assert_eq!(
		configured.credential,
		AgentProviderCredential::AgentStore {
			id: Some("myprovider".to_string())
		}
	);
	assert_eq!(configured.models[0].name.as_deref(), Some("My Model"));

	let auth_only = state
		.providers
		.iter()
		.find(|provider| provider.id == "auth-only")
		.unwrap();
	assert_eq!(auth_only.source, AgentProviderSource::StoredCredential);
	assert_eq!(auth_only.format, None);
	assert_eq!(
		state
			.default_model
			.as_ref()
			.unwrap()
			.qualified_model_id
			.as_deref(),
		Some("myprovider/my-model")
	);
	assert_eq!(
		state
			.small_model
			.as_ref()
			.unwrap()
			.qualified_model_id
			.as_deref(),
		Some("myprovider/small-model")
	);
}

#[test]
fn load_detects_env_api_key_reference() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"{
			"provider": {
				"env-provider": {
					"options": {
						"apiKey": "{env:OPENROUTER_API_KEY}"
					}
				}
			}
		}"#,
	)
	.unwrap();

	let state = adapter.load_providers().unwrap();

	assert_eq!(
		state.providers[0].credential,
		AgentProviderCredential::EnvVar {
			name: "OPENROUTER_API_KEY".to_string()
		}
	);
}

#[test]
fn add_provider_writes_config_and_auth_json() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);

	let binding = adapter
		.add_provider("openrouter", &provider(), "sk-test")
		.unwrap();

	assert_eq!(binding.id, "openrouter");
	let config: Value = serde_json::from_str(
		&fs::read_to_string(adapter.config_path()).unwrap(),
	)
	.unwrap();
	assert_eq!(
		config["provider"]["openrouter"]["npm"],
		"@ai-sdk/openai-compatible"
	);
	assert_eq!(
		config["provider"]["openrouter"]["options"]["baseURL"],
		"https://openrouter.ai/api/v1"
	);
	assert!(config["provider"]["openrouter"]["options"]
		.get("apiKey")
		.is_none());

	let auth: Value =
		serde_json::from_str(&fs::read_to_string(adapter.auth_path()).unwrap())
			.unwrap();
	assert_eq!(auth["openrouter"]["type"], "api");
	assert_eq!(auth["openrouter"]["key"], "sk-test");
}

#[test]
fn add_provider_preserves_jsonc_comments() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"{
			// user-managed defaults
			"model": "existing/model",
			"provider": {
				"existing": {
					// keep endpoint note
					"npm": "@ai-sdk/openai-compatible"
				}
			}
		}"#,
	)
	.unwrap();
	fs::write(
		adapter.auth_path(),
		r#"{
			// logged in from opencode
			"existing": { "type": "api", "key": "old" }
		}"#,
	)
	.unwrap();

	adapter
		.add_provider("openrouter", &provider(), "sk-test")
		.unwrap();

	let config_content = fs::read_to_string(adapter.config_path()).unwrap();
	assert!(config_content.contains("// user-managed defaults"));
	assert!(config_content.contains("// keep endpoint note"));
	assert!(!config_content.contains(r#""apiKey""#));
	let config: Option<Value> =
		aghub_json::parse_jsonc_opt(&config_content).unwrap();
	assert_eq!(
		config.unwrap()["provider"]["openrouter"]["options"]["baseURL"],
		"https://openrouter.ai/api/v1"
	);

	let auth_content = fs::read_to_string(adapter.auth_path()).unwrap();
	assert!(auth_content.contains("// logged in from opencode"));
	let auth: Option<Value> =
		aghub_json::parse_jsonc_opt(&auth_content).unwrap();
	assert_eq!(auth.unwrap()["openrouter"]["key"], "sk-test");
}

#[test]
fn update_provider_edits_name_and_auth_key() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	adapter
		.add_provider("openrouter", &provider(), "sk-old")
		.unwrap();

	let binding = adapter
		.update_provider("openrouter", Some("OpenRouter Team"), Some("sk-new"))
		.unwrap();

	assert_eq!(binding.name, "OpenRouter Team");
	let config: Value = serde_json::from_str(
		&fs::read_to_string(adapter.config_path()).unwrap(),
	)
	.unwrap();
	assert_eq!(config["provider"]["openrouter"]["name"], "OpenRouter Team");
	assert_eq!(
		config["provider"]["openrouter"]["options"]["baseURL"],
		"https://openrouter.ai/api/v1"
	);

	let auth: Value =
		serde_json::from_str(&fs::read_to_string(adapter.auth_path()).unwrap())
			.unwrap();
	assert_eq!(auth["openrouter"]["key"], "sk-new");
}

#[test]
fn update_provider_can_name_auth_only_provider() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.auth_path(),
		r#"{ "auth-only": { "type": "api", "key": "old" } }"#,
	)
	.unwrap();

	let binding = adapter
		.update_provider("auth-only", Some("Auth Only"), None)
		.unwrap();

	assert_eq!(binding.name, "Auth Only");
	assert_eq!(binding.source, AgentProviderSource::Custom);
	let config: Value = serde_json::from_str(
		&fs::read_to_string(adapter.config_path()).unwrap(),
	)
	.unwrap();
	assert_eq!(config["provider"]["auth-only"]["name"], "Auth Only");
}

#[test]
fn api_key_reads_auth_store_before_config() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"{
			"provider": {
				"local": {
					"options": { "apiKey": "inline-key" }
				}
			}
		}"#,
	)
	.unwrap();
	fs::write(
		adapter.auth_path(),
		r#"{ "local": { "type": "api", "key": "auth-key" } }"#,
	)
	.unwrap();

	assert_eq!(
		adapter.api_key("local").unwrap().as_deref(),
		Some("auth-key")
	);
}

#[test]
fn api_key_reads_inline_config_key() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"{
			"provider": {
				"local": {
					"options": { "apiKey": "inline-key" }
				}
			}
		}"#,
	)
	.unwrap();

	assert_eq!(
		adapter.api_key("local").unwrap().as_deref(),
		Some("inline-key")
	);
}

#[test]
fn save_preserves_auth_only_entries_without_configuring_them() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.auth_path(),
		r#"{ "github-copilot": { "type": "oauth", "access": "a", "refresh": "r", "expires": 1 } }"#,
	)
	.unwrap();

	let state = adapter.load_providers().unwrap();
	adapter.save_providers(&state).unwrap();

	let config: Value = serde_json::from_str(
		&fs::read_to_string(adapter.config_path()).unwrap(),
	)
	.unwrap();
	assert!(config.get("provider").is_none());
}

#[test]
fn remove_provider_deletes_config_and_auth_entry() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	adapter
		.add_provider("openrouter", &provider(), "sk-test")
		.unwrap();

	let removed = adapter.remove_provider("openrouter").unwrap();

	assert_eq!(removed.id, "openrouter");
	let state = adapter.load_providers().unwrap();
	assert!(state.providers.is_empty());
	let auth: Option<Value> = aghub_json::parse_jsonc_opt(
		&fs::read_to_string(adapter.auth_path()).unwrap(),
	)
	.unwrap();
	assert!(auth.unwrap().get("openrouter").is_none());
}

#[test]
fn jsonc_comments_are_accepted() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"{
			// keep provider local to this test
			"provider": {
				"local": {
					/* OpenAI-compatible endpoint */
					"npm": "@ai-sdk/openai-compatible"
				}
			}
		}"#,
	)
	.unwrap();

	let state = adapter.load_providers().unwrap();

	assert_eq!(state.providers[0].id, "local");
	assert_eq!(
		state.providers[0].format,
		Some(InferenceProviderFormat::OpenAiCompletions)
	);
}
