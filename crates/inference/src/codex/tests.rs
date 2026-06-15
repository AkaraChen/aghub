use std::fs;
use std::sync::{Arc, Mutex};

use toml_edit::{DocumentMut, Item};

use super::*;
use crate::agent::{
	AgentProviderAdapter, AgentProviderCredential, AgentProviderSource,
};
use crate::credentials::CredentialStore;
use crate::error::InferenceProviderError;
use crate::model::{
	CreateInferenceProvider, InferenceProvider, InferenceProviderFormat,
};
use crate::store::InferenceProviderStore;

fn adapter(temp: &tempfile::TempDir) -> CodexProviderAdapter {
	CodexProviderAdapter::new(temp.path().join("config.toml"))
}

#[derive(Debug, Clone, Default)]
struct MemoryCredentialStore {
	values: Arc<Mutex<std::collections::HashMap<String, String>>>,
}

impl CredentialStore for MemoryCredentialStore {
	fn get_api_key(
		&self,
		provider_id: &str,
	) -> crate::error::Result<Option<String>> {
		Ok(self.values.lock().unwrap().get(provider_id).cloned())
	}

	fn set_api_key(
		&self,
		provider_id: &str,
		api_key: &str,
	) -> crate::error::Result<()> {
		self.values
			.lock()
			.unwrap()
			.insert(provider_id.to_string(), api_key.to_string());
		Ok(())
	}

	fn delete_api_key(&self, provider_id: &str) -> crate::error::Result<()> {
		self.values.lock().unwrap().remove(provider_id);
		Ok(())
	}
}

fn store(
	temp: &tempfile::TempDir,
) -> InferenceProviderStore<MemoryCredentialStore> {
	InferenceProviderStore::with_credentials(
		temp.path(),
		MemoryCredentialStore::default(),
	)
}

fn auth_path(temp: &tempfile::TempDir) -> std::path::PathBuf {
	temp.path().join("auth.json")
}

fn provider() -> InferenceProvider {
	InferenceProvider {
		id: "inventory-id".to_string(),
		latin_name: "openrouter".to_string(),
		display_name: "OpenRouter".to_string(),
		format: InferenceProviderFormat::OpenAiResponses,
		api_base_url: "https://openrouter.ai/api/v1".to_string(),
		preset: None,
		masked_api_key: "sk****st".to_string(),
		models: vec!["openai/gpt-5.4".to_string()],
	}
}

fn provider_without_versioned_base_url() -> InferenceProvider {
	InferenceProvider {
		api_base_url: "https://api.example.com".to_string(),
		..provider()
	}
}

fn create_inventory_provider(
	store: &InferenceProviderStore<MemoryCredentialStore>,
) -> InferenceProvider {
	create_inventory_provider_with_models(store, vec!["openai/gpt-5.4"])
}

fn create_inventory_provider_with_models(
	store: &InferenceProviderStore<MemoryCredentialStore>,
	models: Vec<&str>,
) -> InferenceProvider {
	store
		.create(CreateInferenceProvider {
			latin_name: "openrouter".to_string(),
			display_name: "OpenRouter".to_string(),
			format: InferenceProviderFormat::OpenAiResponses,
			api_base_url: "https://openrouter.ai/api/v1".to_string(),
			preset: None,
			api_key: "sk-test".to_string(),
			models: models.into_iter().map(ToString::to_string).collect(),
		})
		.unwrap()
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
	assert_eq!(provider.source, AgentProviderSource::External);
	let default = state.default_model.clone().unwrap();
	assert_eq!(default.provider_id.as_deref(), Some("openrouter"));
	assert_eq!(default.model_id, "openai/gpt-5.4");
}

#[test]
fn profile_state_defaults_to_openai_login() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(adapter.config_path(), r#"model = "gpt-5.4""#).unwrap();

	let store = store(&temp);
	let state = adapter.load_profile_state(&store).unwrap();

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
fn load_reads_openai_base_url_override() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"
model = "gpt-5.4"
openai_base_url = "https://proxy.example/v1"
"#,
	)
	.unwrap();

	let state = adapter.load_providers().unwrap();
	let openai = state
		.providers
		.iter()
		.find(|provider| provider.id == "openai")
		.unwrap();
	assert_eq!(
		openai.api_base_url.as_deref(),
		Some("https://proxy.example/v1")
	);
}

#[test]
fn load_canonicalizes_explicit_openai_selection() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"
model_provider = "openai"
model = "gpt-5.4"
base_url = "https://legacy-openai.example/v1"
"#,
	)
	.unwrap();

	let state = adapter.load_providers().unwrap();
	let default = state.default_model.clone().unwrap();
	assert_eq!(default.provider_id, None);
	assert_eq!(default.model_id, "gpt-5.4");

	let openai = state
		.providers
		.iter()
		.find(|provider| provider.id == "openai")
		.unwrap();
	assert_eq!(
		openai.api_base_url.as_deref(),
		Some("https://legacy-openai.example/v1")
	);

	adapter.save_providers(&state).unwrap();

	let config = fs::read_to_string(adapter.config_path())
		.unwrap()
		.parse::<DocumentMut>()
		.unwrap();
	assert!(config.get("model_provider").is_none());
	assert_eq!(config["model"].as_str(), Some("gpt-5.4"));
	assert_eq!(
		config["base_url"].as_str(),
		Some("https://legacy-openai.example/v1")
	);
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

	let store = store(&temp);
	let state = adapter.load_profile_state(&store).unwrap();

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

	let store = store(&temp);
	let state = adapter.set_active_profile(&store, "work").unwrap();

	assert_eq!(state.active_profile_id, "work");
	let content = fs::read_to_string(adapter.config_path()).unwrap();
	assert!(content.contains("# user note"));
	let config = content.parse::<DocumentMut>().unwrap();
	assert_eq!(config["profile"].as_str(), Some("work"));

	let state = adapter
		.set_active_profile(&store, DEFAULT_PROFILE_ID)
		.unwrap();
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

	let store = store(&temp);
	let state = adapter
		.set_profile_provider(&store, "work", "openai")
		.unwrap();

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
		.set_profile_provider(&store, DEFAULT_PROFILE_ID, "openai")
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
fn set_active_provider_targets_current_active_profile() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"
profile = "work"
model_provider = "openai"

[profiles.work]
model_provider = "openai"

[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
wire_api = "responses"
"#,
	)
	.unwrap();

	let store = store(&temp);
	let state = adapter.set_active_provider(&store, "openrouter").unwrap();

	assert_eq!(state.active_profile_id, "work");
	let work = state
		.profiles
		.iter()
		.find(|profile| profile.id == "work")
		.unwrap();
	assert_eq!(work.selected_provider_id, "openrouter");
	let config = fs::read_to_string(adapter.config_path())
		.unwrap()
		.parse::<DocumentMut>()
		.unwrap();
	assert_eq!(
		config["profiles"]["work"]["model_provider"].as_str(),
		Some("openrouter")
	);
	assert_eq!(config["model_provider"].as_str(), Some("openai"));
}

#[test]
fn set_profile_provider_uses_first_model_for_inventory_binding() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"
profile = "work"

[profiles.work]
model = "gpt-5"
model_provider = "openai"
"#,
	)
	.unwrap();

	let store = store(&temp);
	let provider = create_inventory_provider(&store);
	adapter
		.add_inventory_provider(&store, &provider, "sk-test")
		.unwrap();

	let state = adapter
		.set_profile_provider(&store, "work", "openrouter")
		.unwrap();

	let work = state
		.profiles
		.iter()
		.find(|profile| profile.id == "work")
		.unwrap();
	assert_eq!(work.selected_provider_id, "openrouter");
	assert_eq!(work.model.as_deref(), Some("openai/gpt-5.4"));

	let config = fs::read_to_string(adapter.config_path())
		.unwrap()
		.parse::<DocumentMut>()
		.unwrap();
	assert_eq!(
		config["profiles"]["work"]["model_provider"].as_str(),
		Some("openrouter")
	);
	assert_eq!(
		config["profiles"]["work"]["model"].as_str(),
		Some("openai/gpt-5.4")
	);
	assert!(config.get("model").is_none());
}

#[test]
fn set_profile_provider_uses_requested_model_for_inventory_binding() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"
profile = "work"

[profiles.work]
model = "gpt-5"
model_provider = "openai"
"#,
	)
	.unwrap();

	let store = store(&temp);
	let provider = create_inventory_provider_with_models(
		&store,
		vec!["model-a", "model-b"],
	);
	adapter
		.add_inventory_provider(&store, &provider, "sk-test")
		.unwrap();

	let state = adapter
		.set_profile_provider_model(
			&store,
			"work",
			"openrouter",
			Some(Some("model-b")),
		)
		.unwrap();

	let work = state
		.profiles
		.iter()
		.find(|profile| profile.id == "work")
		.unwrap();
	assert_eq!(work.selected_provider_id, "openrouter");
	assert_eq!(work.model.as_deref(), Some("model-b"));

	let config = fs::read_to_string(adapter.config_path())
		.unwrap()
		.parse::<DocumentMut>()
		.unwrap();
	assert_eq!(
		config["profiles"]["work"]["model_provider"].as_str(),
		Some("openrouter")
	);
	assert_eq!(
		config["profiles"]["work"]["model"].as_str(),
		Some("model-b")
	);
}

#[test]
fn set_profile_provider_writes_model_catalog_for_inventory_binding() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"
model_context_window = 64000
model_provider = "openai"
"#,
	)
	.unwrap();

	let store = store(&temp);
	let provider = create_inventory_provider_with_models(
		&store,
		vec!["model-a", "model-b"],
	);
	adapter
		.add_inventory_provider(&store, &provider, "sk-test")
		.unwrap();

	adapter
		.set_profile_provider_model(
			&store,
			DEFAULT_PROFILE_ID,
			"openrouter",
			Some(Some("model-b")),
		)
		.unwrap();

	let content = fs::read_to_string(adapter.config_path()).unwrap();
	let config = content.parse::<DocumentMut>().unwrap();
	assert_eq!(
		config["model_catalog_json"].as_str(),
		Some(GENERATED_MODEL_CATALOG_PATH)
	);

	let catalog: serde_json::Value = serde_json::from_str(
		&fs::read_to_string(model_catalog_path(adapter.config_path())).unwrap(),
	)
	.unwrap();
	let models = catalog["models"].as_array().unwrap();
	assert_eq!(models.len(), 2);
	assert_eq!(models[0]["slug"].as_str(), Some("model-a"));
	assert_eq!(models[1]["slug"].as_str(), Some("model-b"));
	assert_eq!(models[0]["context_window"].as_u64(), Some(64_000));
	assert_eq!(models[0]["max_context_window"].as_u64(), Some(64_000));
	assert!(
		models[0].get("model_messages").is_some(),
		"Codex custom catalogs need model prompt metadata"
	);
	assert_eq!(
		models[0]["additional_speed_tiers"]
			.as_array()
			.unwrap()
			.len(),
		0
	);
	assert_eq!(models[0]["service_tiers"].as_array().unwrap().len(), 0);
	assert!(models[0]["availability_nux"].is_null());
	assert!(models[0]["upgrade"].is_null());
}

#[test]
fn set_provider_to_default_clears_generated_model_catalog() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		format!(
			r#"
model = "model-a"
model_provider = "openrouter"
model_catalog_json = "{GENERATED_MODEL_CATALOG_PATH}"

[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
wire_api = "responses"
"#
		),
	)
	.unwrap();
	let catalog_path = model_catalog_path(adapter.config_path());
	fs::create_dir_all(catalog_path.parent().unwrap()).unwrap();
	fs::write(catalog_path, r#"{"models":[]}"#).unwrap();

	let store = store(&temp);
	adapter
		.set_profile_provider(&store, DEFAULT_PROFILE_ID, "openai")
		.unwrap();

	let config = fs::read_to_string(adapter.config_path())
		.unwrap()
		.parse::<DocumentMut>()
		.unwrap();
	assert!(config.get("model_catalog_json").is_none());
	assert!(!model_catalog_path(adapter.config_path()).exists());
}

#[test]
fn set_provider_to_default_preserves_user_model_catalog_pointer() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"
model = "model-a"
model_provider = "openrouter"
model_catalog_json = "my-custom-catalog.json"

[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
wire_api = "responses"
"#,
	)
	.unwrap();
	let catalog_path = model_catalog_path(adapter.config_path());
	fs::create_dir_all(catalog_path.parent().unwrap()).unwrap();
	fs::write(&catalog_path, r#"{"models":[]}"#).unwrap();

	let store = store(&temp);
	adapter
		.set_profile_provider(&store, DEFAULT_PROFILE_ID, "openai")
		.unwrap();

	let config = fs::read_to_string(adapter.config_path())
		.unwrap()
		.parse::<DocumentMut>()
		.unwrap();
	assert_eq!(
		config["model_catalog_json"].as_str(),
		Some("my-custom-catalog.json")
	);
	assert!(catalog_path.exists());
}

#[test]
fn set_profile_provider_updates_model_without_provider_change() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"
profile = "work"

[profiles.work]
model = "model-a"
model_provider = "openrouter"
"#,
	)
	.unwrap();

	let store = store(&temp);
	let provider = create_inventory_provider_with_models(
		&store,
		vec!["model-a", "model-b"],
	);
	adapter
		.add_inventory_provider(&store, &provider, "sk-test")
		.unwrap();

	let state = adapter
		.set_profile_provider_model(
			&store,
			"work",
			"openrouter",
			Some(Some("model-b")),
		)
		.unwrap();

	let work = state
		.profiles
		.iter()
		.find(|profile| profile.id == "work")
		.unwrap();
	assert_eq!(work.selected_provider_id, "openrouter");
	assert_eq!(work.model.as_deref(), Some("model-b"));
}

#[test]
fn set_profile_provider_rejects_unknown_inventory_model() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"
profile = "work"

[profiles.work]
model_provider = "openai"
"#,
	)
	.unwrap();

	let store = store(&temp);
	let provider = create_inventory_provider_with_models(
		&store,
		vec!["model-a", "model-b"],
	);
	adapter
		.add_inventory_provider(&store, &provider, "sk-test")
		.unwrap();

	let error = adapter
		.set_profile_provider_model(
			&store,
			"work",
			"openrouter",
			Some(Some("missing-model")),
		)
		.unwrap_err();

	assert!(matches!(error, InferenceProviderError::NotFound(_)));
}

#[test]
fn set_default_provider_uses_first_model_for_inventory_binding() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"
model = "gpt-5"
model_provider = "openai"
"#,
	)
	.unwrap();

	let store = store(&temp);
	let provider = create_inventory_provider(&store);
	adapter
		.add_inventory_provider(&store, &provider, "sk-test")
		.unwrap();

	let state = adapter
		.set_profile_provider(&store, DEFAULT_PROFILE_ID, "openrouter")
		.unwrap();

	let default = state
		.profiles
		.iter()
		.find(|profile| profile.is_default)
		.unwrap();
	assert_eq!(default.selected_provider_id, "openrouter");
	assert_eq!(default.model.as_deref(), Some("openai/gpt-5.4"));

	let config = fs::read_to_string(adapter.config_path())
		.unwrap()
		.parse::<DocumentMut>()
		.unwrap();
	assert_eq!(config["model_provider"].as_str(), Some("openrouter"));
	assert_eq!(config["model"].as_str(), Some("openai/gpt-5.4"));
}

#[test]
fn set_provider_to_default_clears_model() {
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
"#,
	)
	.unwrap();

	let store = store(&temp);
	let state = adapter
		.set_profile_provider(&store, DEFAULT_PROFILE_ID, "openai")
		.unwrap();

	let default = state
		.profiles
		.iter()
		.find(|profile| profile.is_default)
		.unwrap();
	assert_eq!(default.selected_provider_id, "openai");
	assert_eq!(default.model.as_deref(), None);

	let config = fs::read_to_string(adapter.config_path())
		.unwrap()
		.parse::<DocumentMut>()
		.unwrap();
	assert!(config.get("model_provider").is_none());
	assert!(config.get("model").is_none());
}

#[test]
fn set_active_provider_writes_inventory_key_inline() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(adapter.config_path(), r#"model_provider = "openai""#).unwrap();

	let store = store(&temp);
	let provider = create_inventory_provider(&store);
	adapter
		.add_inventory_provider(&store, &provider, "sk-test")
		.unwrap();

	adapter.set_active_provider(&store, "openrouter").unwrap();

	let config = fs::read_to_string(adapter.config_path())
		.unwrap()
		.parse::<DocumentMut>()
		.unwrap();
	let provider = config["model_providers"]["openrouter"].as_table().unwrap();
	assert_eq!(
		provider["experimental_bearer_token"].as_str(),
		Some("sk-test")
	);
	assert!(provider.get("env_key").is_none());
}

#[test]
fn clear_active_provider_falls_back_to_openai() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"
model_provider = "openrouter"

[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
wire_api = "responses"
"#,
	)
	.unwrap();

	let store = store(&temp);
	let state = adapter.clear_active_provider(&store).unwrap();

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
fn add_provider_appends_v1_for_origin_only_base_url() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);

	let binding = adapter
		.add_provider(
			"openrouter",
			&provider_without_versioned_base_url(),
			"sk-test",
		)
		.unwrap();

	assert_eq!(
		binding.api_base_url.as_deref(),
		Some("https://api.example.com/v1")
	);
	let config = fs::read_to_string(adapter.config_path())
		.unwrap()
		.parse::<DocumentMut>()
		.unwrap();
	let provider = config["model_providers"]["openrouter"].as_table().unwrap();
	assert_eq!(
		provider["base_url"].as_str(),
		Some("https://api.example.com/v1")
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
fn add_inventory_provider_uses_stable_public_id() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	let store = store(&temp);
	let provider = create_inventory_provider(&store);

	let binding = adapter
		.add_inventory_provider(&store, &provider, "sk-test")
		.unwrap();

	assert_eq!(binding.id, "openrouter");
	assert_eq!(
		store
			.get_agent_binding(AGENT_ID, "openrouter")
			.unwrap()
			.inference_provider_id,
		provider.id
	);

	let state = adapter.load_profile_state(&store).unwrap();
	let openrouter = state
		.providers
		.iter()
		.filter(|provider| provider.id == "openrouter")
		.collect::<Vec<_>>();
	assert_eq!(openrouter.len(), 1);
	assert_eq!(openrouter[0].source, AgentProviderSource::Custom);
	assert_eq!(openrouter[0].credential, AgentProviderCredential::Inline);
	assert_eq!(openrouter[0].models[0].id, "openai/gpt-5.4");
}

#[test]
fn update_provider_rejects_config_toml_provider() {
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

	let store = store(&temp);
	let error = adapter
		.update_provider(
			&store,
			"openrouter",
			Some("OpenRouter Team"),
			Some("sk-new"),
		)
		.unwrap_err();

	assert!(matches!(
		error,
		InferenceProviderError::InvalidAgentProviderConfig { .. }
	));
	let content = fs::read_to_string(adapter.config_path()).unwrap();
	assert!(content.contains("# user note"));
	assert!(content.contains("# provider note"));
	let config = content.parse::<DocumentMut>().unwrap();
	let provider = config["model_providers"]["openrouter"].as_table().unwrap();
	assert_eq!(provider["name"].as_str(), Some("OpenRouter"));
	assert_eq!(
		provider["experimental_bearer_token"].as_str(),
		Some("sk-old")
	);
}

#[test]
fn update_provider_rejects_env_key_config_provider() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"
[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
wire_api = "responses"
env_key = "OPENROUTER_API_KEY"
"#,
	)
	.unwrap();

	let store = store(&temp);
	let error = adapter
		.update_provider(&store, "openrouter", Some("OpenRouter Team"), None)
		.unwrap_err();

	assert!(matches!(
		error,
		InferenceProviderError::InvalidAgentProviderConfig { .. }
	));
	let content = fs::read_to_string(adapter.config_path()).unwrap();
	let config = content.parse::<DocumentMut>().unwrap();
	let provider = config["model_providers"]["openrouter"].as_table().unwrap();
	assert_eq!(provider["name"].as_str(), Some("OpenRouter"));
	assert_eq!(provider["env_key"].as_str(), Some("OPENROUTER_API_KEY"));
	assert!(provider.get("experimental_bearer_token").is_none());
}

#[test]
fn save_removes_external_providers_from_config() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"
model = "gpt-5.4"
model_provider = "newapi"

[model_providers.newapi]
name = "NewAPI"
base_url = "https://api.example.com/v1"
wire_api = "responses"
requires_openai_auth = true
"#,
	)
	.unwrap();

	let state = adapter.load_providers().unwrap();
	adapter.save_providers(&state).unwrap();

	let content = fs::read_to_string(adapter.config_path()).unwrap();
	let config = content.parse::<DocumentMut>().unwrap();
	// Since newapi is now External source, save_providers skips it
	// (only Custom sources are saved). The provider should be removed
	// from config.toml since External providers are not managed by aghub.
	assert!(config
		.get("model_providers")
		.and_then(|t| t.get("newapi"))
		.is_none());
	// But the model_provider reference and model should still exist
	assert_eq!(config["model"].as_str(), Some("gpt-5.4"));
	assert_eq!(config["model_provider"].as_str(), Some("newapi"));
}

#[test]
fn update_provider_rejects_shared_auth_config_provider() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"
[model_providers.newapi]
name = "NewAPI"
base_url = "https://api.example.com/v1"
wire_api = "responses"
requires_openai_auth = true
"#,
	)
	.unwrap();
	fs::write(auth_path(&temp), r#"{ "OPENAI_API_KEY": "sk-old" }"#).unwrap();

	let store = store(&temp);
	let error = adapter
		.update_provider(&store, "newapi", Some("New API"), Some("sk-new"))
		.unwrap_err();

	assert!(matches!(
		error,
		InferenceProviderError::InvalidAgentProviderConfig { .. }
	));
	let auth: serde_json::Value =
		serde_json::from_str(&fs::read_to_string(auth_path(&temp)).unwrap())
			.unwrap();
	assert_eq!(auth["OPENAI_API_KEY"].as_str(), Some("sk-old"));
}

#[test]
fn save_clears_default_provider_for_builtin_openai_selection() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"
model = "gpt-5.4"
model_provider = "openrouter"

[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
wire_api = "responses"
experimental_bearer_token = "sk-test"
"#,
	)
	.unwrap();

	let mut state = adapter.load_providers().unwrap();
	state.default_model = Some(AgentModelSelection::model("gpt-5.4"));
	adapter.save_providers(&state).unwrap();

	let content = fs::read_to_string(adapter.config_path()).unwrap();
	let config = content.parse::<DocumentMut>().unwrap();
	assert!(config.get("model_provider").is_none());
	assert_eq!(config["model"].as_str(), Some("gpt-5.4"));
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

	let store = store(&temp);
	assert_eq!(
		adapter.api_key(&store, "openrouter").unwrap(),
		Some("sk-inline".to_string())
	);
}

#[test]
fn api_key_reads_shared_auth_json_for_openai_auth_provider() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"
[model_providers.newapi]
name = "NewAPI"
base_url = "https://api.example.com/v1"
wire_api = "responses"
requires_openai_auth = true
"#,
	)
	.unwrap();
	fs::write(auth_path(&temp), r#"{ "OPENAI_API_KEY": "sk-auth" }"#).unwrap();

	let store = store(&temp);
	assert_eq!(
		adapter.api_key(&store, "newapi").unwrap(),
		Some("sk-auth".to_string())
	);
}

#[test]
fn api_key_for_openai_login_provider_is_not_config_backed() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	let store = store(&temp);

	assert_eq!(adapter.api_key(&store, "openai").unwrap(), None);
}

#[test]
fn remove_provider_rejects_config_toml_provider() {
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

	let store = store(&temp);
	let error = adapter.remove_provider(&store, "openrouter").unwrap_err();

	assert!(matches!(
		error,
		InferenceProviderError::InvalidAgentProviderConfig { .. }
	));
	let content = fs::read_to_string(adapter.config_path()).unwrap();
	let config = content.parse::<DocumentMut>().unwrap();
	assert_eq!(config["model_provider"].as_str(), Some("openrouter"));
	assert!(config
		.get("model_providers")
		.and_then(Item::as_table)
		.and_then(|providers| providers.get("openrouter"))
		.is_some());
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

	let store = store(&temp);
	let inventory = create_inventory_provider(&store);
	store
		.upsert_agent_binding(
			AGENT_ID,
			"openrouter",
			&inventory.id,
			Some("openai/gpt-5.4"),
		)
		.unwrap();
	let removed = adapter.remove_provider(&store, "openrouter").unwrap();

	assert_eq!(removed.id, "openrouter");
	let content = fs::read_to_string(adapter.config_path()).unwrap();
	let config = content.parse::<DocumentMut>().unwrap();
	assert!(config.get("model_provider").is_none());
	assert!(config.get("model").is_none());
	assert!(config
		.get("model_providers")
		.and_then(Item::as_table)
		.and_then(|providers| providers.get("openrouter"))
		.is_none());
}

#[test]
fn remove_provider_clears_profile_provider_references() {
	let temp = tempfile::tempdir().unwrap();
	let adapter = adapter(&temp);
	fs::write(
		adapter.config_path(),
		r#"
model_provider = "openrouter"

[profiles.work]
model = "openrouter/gpt-5.4"
model_provider = "openrouter"

[profiles.review]
model = "openrouter/gpt-5.4"
model_provider = "openrouter"

[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
wire_api = "responses"
"#,
	)
	.unwrap();

	let store = store(&temp);
	let inventory = create_inventory_provider(&store);
	store
		.upsert_agent_binding(
			AGENT_ID,
			"openrouter",
			&inventory.id,
			Some("openai/gpt-5.4"),
		)
		.unwrap();
	adapter.remove_provider(&store, "openrouter").unwrap();

	let content = fs::read_to_string(adapter.config_path()).unwrap();
	let config = content.parse::<DocumentMut>().unwrap();
	assert!(config.get("model_provider").is_none());
	assert!(config.get("model").is_none());
	assert!(config["profiles"]["work"]
		.as_table()
		.unwrap()
		.get("model_provider")
		.is_none());
	assert!(config["profiles"]["work"]
		.as_table()
		.unwrap()
		.get("model")
		.is_none());
	assert!(config["profiles"]["review"]
		.as_table()
		.unwrap()
		.get("model_provider")
		.is_none());
	assert!(config["profiles"]["review"]
		.as_table()
		.unwrap()
		.get("model")
		.is_none());
}
