use std::fs;

use serde_json::Value;

use super::*;
use crate::agent::{
	AgentProviderAdapter, AgentProviderCredential, AgentProviderSource,
};
use crate::model::InferenceProviderFormat;

fn adapter(temp: &tempfile::TempDir) -> ClaudeProviderAdapter {
	ClaudeProviderAdapter::new(temp.path().join("settings.json"))
}

#[test]
fn load_reads_auth_token_and_normalized_model_state() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"{
			"model": "claude-top",
			"permissions": { "allow": ["Read"] },
			"env": {
				"ANTHROPIC_BASE_URL": "https://api.example.com",
				"ANTHROPIC_AUTH_TOKEN": "sk-test",
				"ANTHROPIC_MODEL": "claude-env",
				"ANTHROPIC_SMALL_FAST_MODEL": "claude-haiku",
				"ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet",
				"KEEP": "1"
			}
		}"#,
	)
	.unwrap();

	let config = adapter.load_config_state().unwrap();
	assert_eq!(
		config.api_base_url.as_deref(),
		Some("https://api.example.com")
	);
	assert_eq!(config.api_key.as_deref(), Some("sk-test"));
	assert_eq!(
		config.api_key_env_name.as_deref(),
		Some("ANTHROPIC_AUTH_TOKEN")
	);
	assert_eq!(config.model.as_deref(), Some("claude-top"));
	assert_eq!(config.haiku_model.as_deref(), Some("claude-haiku"));
	assert_eq!(config.sonnet_model.as_deref(), Some("claude-sonnet"));
	assert_eq!(config.opus_model.as_deref(), Some("claude-top"));

	let state = adapter.load_providers().unwrap();
	assert_eq!(state.providers.len(), 1);
	assert_eq!(state.default_model.unwrap().model_id, "claude-top");

	let provider = &state.providers[0];
	assert_eq!(provider.id, PRIMARY_PROVIDER_ID);
	assert_eq!(provider.name, "Custom");
	assert_eq!(provider.source, AgentProviderSource::ClosedSlot);
	assert_eq!(provider.format, Some(InferenceProviderFormat::Anthropic));
	assert_eq!(
		provider.api_base_url.as_deref(),
		Some("https://api.example.com")
	);
	assert_eq!(
		provider.credential,
		AgentProviderCredential::EnvVar {
			name: "ANTHROPIC_AUTH_TOKEN".to_string()
		}
	);
	assert_eq!(provider.models.len(), 3);
	assert_eq!(provider.models[0].id, "claude-top");
	assert_eq!(provider.models[1].id, "claude-haiku");
	assert_eq!(provider.models[2].id, "claude-sonnet");
}

#[test]
fn save_providers_preserves_existing_auth_field_and_alias_models() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"{
			"model": "claude-sonnet-4-5",
			"env": {
				"ANTHROPIC_BASE_URL": "https://api.example.com",
				"ANTHROPIC_AUTH_TOKEN": "sk-test",
				"ANTHROPIC_MODEL": "claude-sonnet-4-5",
				"ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-haiku-4-5",
				"ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-5",
				"ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-5",
				"KEEP": "1"
			}
		}"#,
	)
	.unwrap();

	let state = adapter.load_providers().unwrap();
	adapter.save_providers(&state).unwrap();

	let config: Value = serde_json::from_str(
		&fs::read_to_string(adapter.config_path()).unwrap(),
	)
	.unwrap();
	assert_eq!(
		config["env"]["ANTHROPIC_AUTH_TOKEN"].as_str(),
		Some("sk-test")
	);
	assert!(config["env"].get("ANTHROPIC_API_KEY").is_none());
	assert_eq!(
		config["env"]["ANTHROPIC_BASE_URL"].as_str(),
		Some("https://api.example.com")
	);
	assert_eq!(config["model"].as_str(), Some("claude-sonnet-4-5"));
	assert_eq!(
		config["env"]["ANTHROPIC_MODEL"].as_str(),
		Some("claude-sonnet-4-5")
	);
	assert_eq!(
		config["env"]["ANTHROPIC_DEFAULT_HAIKU_MODEL"].as_str(),
		Some("claude-haiku-4-5")
	);
	assert_eq!(
		config["env"]["ANTHROPIC_DEFAULT_SONNET_MODEL"].as_str(),
		Some("claude-sonnet-4-5")
	);
	assert_eq!(
		config["env"]["ANTHROPIC_DEFAULT_OPUS_MODEL"].as_str(),
		Some("claude-opus-4-5")
	);
	assert_eq!(config["env"]["KEEP"].as_str(), Some("1"));
}

#[test]
fn save_config_state_model_change_defaults_aliases_and_cleans_legacy_fields() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"{
			"env": {
				"ANTHROPIC_BASE_URL": "https://api.example.com",
				"ANTHROPIC_API_KEY": "sk-old",
				"ANTHROPIC_MODEL": "claude-old",
				"ANTHROPIC_SMALL_FAST_MODEL": "claude-haiku-old"
			}
		}"#,
	)
	.unwrap();

	adapter
		.save_config_state(&ClaudeConfigState {
			api_base_url: Some("https://api.example.com".to_string()),
			api_key: Some("sk-new".to_string()),
			api_key_env_name: None,
			model: Some("claude-new".to_string()),
			haiku_model: None,
			sonnet_model: None,
			opus_model: None,
		})
		.unwrap();

	let config: Value = serde_json::from_str(
		&fs::read_to_string(adapter.config_path()).unwrap(),
	)
	.unwrap();
	assert_eq!(config["model"].as_str(), Some("claude-new"));
	assert_eq!(config["env"]["ANTHROPIC_API_KEY"].as_str(), Some("sk-new"));
	assert!(config["env"].get("ANTHROPIC_AUTH_TOKEN").is_none());
	assert_eq!(
		config["env"]["ANTHROPIC_MODEL"].as_str(),
		Some("claude-new")
	);
	assert_eq!(
		config["env"]["ANTHROPIC_DEFAULT_HAIKU_MODEL"].as_str(),
		Some("claude-new")
	);
	assert_eq!(
		config["env"]["ANTHROPIC_DEFAULT_SONNET_MODEL"].as_str(),
		Some("claude-new")
	);
	assert_eq!(
		config["env"]["ANTHROPIC_DEFAULT_OPUS_MODEL"].as_str(),
		Some("claude-new")
	);
	assert!(config["env"].get("ANTHROPIC_SMALL_FAST_MODEL").is_none());
}

#[test]
fn clear_provider_config_removes_only_provider_env_keys() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"{
			"model": "claude-sonnet-4-5",
			"permissions": { "allow": ["Read"] },
			"env": {
				"ANTHROPIC_BASE_URL": "https://api.example.com",
				"ANTHROPIC_API_KEY": "sk-test",
				"ANTHROPIC_MODEL": "claude-sonnet-4-5",
				"ANTHROPIC_AUTH_TOKEN": "legacy",
				"ANTHROPIC_SMALL_FAST_MODEL": "small-fast",
				"ANTHROPIC_DEFAULT_HAIKU_MODEL": "haiku",
				"ANTHROPIC_DEFAULT_SONNET_MODEL": "sonnet",
				"ANTHROPIC_DEFAULT_OPUS_MODEL": "opus",
				"KEEP": "1"
			}
		}"#,
	)
	.unwrap();

	adapter.clear_provider_config().unwrap();

	let config: Value = serde_json::from_str(
		&fs::read_to_string(adapter.config_path()).unwrap(),
	)
	.unwrap();
	let env = config["env"].as_object().unwrap();
	assert_eq!(env.get("KEEP").and_then(Value::as_str), Some("1"));
	assert!(!env.contains_key("ANTHROPIC_BASE_URL"));
	assert!(!env.contains_key("ANTHROPIC_API_KEY"));
	assert!(!env.contains_key("ANTHROPIC_MODEL"));
	assert!(!env.contains_key("ANTHROPIC_AUTH_TOKEN"));
	assert!(!env.contains_key("ANTHROPIC_SMALL_FAST_MODEL"));
	assert!(!env.contains_key("ANTHROPIC_DEFAULT_HAIKU_MODEL"));
	assert!(!env.contains_key("ANTHROPIC_DEFAULT_SONNET_MODEL"));
	assert!(!env.contains_key("ANTHROPIC_DEFAULT_OPUS_MODEL"));
	assert!(config.get("permissions").is_some());
	assert!(config.get("model").is_none());
}
