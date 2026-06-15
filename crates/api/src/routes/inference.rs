use aghub_inference::AgentProviderBindingModelUpdate;
use aghub_inference::{
	AgentProviderAdapter, AgentProviderBinding, ClaudeModelRouting,
	ClaudeProviderAdapter, CodexProviderAdapter, InferenceProvider,
	InferenceProviderRepository, InferenceProviderStore,
	OpenCodeProviderAdapter,
};
use rocket::http::Status;
use rocket::response::status::NoContent;
use rocket::serde::json::Json;
use rocket::State;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::time::Duration;

use crate::auth::ApiAuth;
use crate::dto::inference::{
	AgentProviderResponse, ClaudeProviderStateResponse,
	CodexProviderStateResponse, CreateAgentProviderRequest,
	CreateInferenceProviderRequest, InferenceProviderFormatDto,
	InferenceProviderPasswordResponse, InferenceProviderPresetResponse,
	InferenceProviderResponse, UpdateAgentProviderRequest,
	UpdateCodexActiveProfileRequest, UpdateCodexProfileProviderRequest,
	UpdateInferenceProviderRequest,
};
use crate::error::{ApiCreated, ApiError, ApiNoContent, ApiResult};
use crate::state::InferenceProviderState;

fn store(state: &State<InferenceProviderState>) -> InferenceProviderStore {
	InferenceProviderStore::new(state.app_data_dir.clone())
}

fn find_by_latin_name(
	store: &InferenceProviderStore,
	latin_name: &str,
) -> Result<InferenceProvider, ApiError> {
	store
		.list()
		.map_err(ApiError::from)?
		.into_iter()
		.find(|provider| provider.latin_name == latin_name)
		.ok_or_else(|| {
			ApiError::new(
				Status::NotFound,
				format!("inference provider '{latin_name}' not found"),
				"RESOURCE_NOT_FOUND",
			)
		})
}

fn opencode_adapter() -> Result<OpenCodeProviderAdapter, ApiError> {
	OpenCodeProviderAdapter::global().map_err(ApiError::from)
}

fn codex_adapter() -> Result<CodexProviderAdapter, ApiError> {
	CodexProviderAdapter::global().map_err(ApiError::from)
}

fn claude_adapter() -> Result<ClaudeProviderAdapter, ApiError> {
	ClaudeProviderAdapter::global().map_err(ApiError::from)
}

fn get_inventory_provider(
	store: &InferenceProviderStore,
	id: &str,
) -> Result<(InferenceProvider, String), ApiError> {
	let provider = store.get(id).map_err(ApiError::from)?;
	let api_key = store
		.get_api_key(&provider.id)
		.map_err(ApiError::from)?
		.ok_or_else(|| {
			ApiError::new(
				Status::UnprocessableEntity,
				format!(
					"inference provider '{}' has no stored API key",
					provider.display_name
				),
				"MISSING_CREDENTIAL",
			)
		})?;
	Ok((provider, api_key))
}

fn same_api_base_url(left: &str, right: &str) -> bool {
	left.trim().trim_end_matches('/') == right.trim().trim_end_matches('/')
}

fn inventory_providers_with_api_keys(
	store: &InferenceProviderStore,
) -> Result<Vec<(InferenceProvider, String)>, ApiError> {
	let mut providers = Vec::new();
	for provider in store.list().map_err(ApiError::from)? {
		let Some(api_key) =
			store.get_api_key(&provider.id).map_err(ApiError::from)?
		else {
			continue;
		};
		providers.push((provider, api_key));
	}
	Ok(providers)
}

fn opencode_inventory_providers_with_api_keys(
	store: &InferenceProviderStore,
) -> Result<Vec<(InferenceProvider, String)>, ApiError> {
	Ok(inventory_providers_with_api_keys(store)?
		.into_iter()
		.map(|(provider, api_key)| {
			(
				OpenCodeProviderAdapter::normalize_inventory_provider(
					&provider,
				),
				api_key,
			)
		})
		.collect())
}

fn find_matching_inventory_provider(
	inventory: &[(InferenceProvider, String)],
	binding: &AgentProviderBinding,
	agent_api_key: Option<String>,
) -> Result<Option<(InferenceProvider, String)>, ApiError> {
	let Some(api_base_url) = binding.api_base_url.as_deref() else {
		return Ok(None);
	};
	let Some(agent_api_key) = agent_api_key else {
		return Ok(None);
	};

	for (provider, api_key) in inventory {
		if !same_api_base_url(&provider.api_base_url, api_base_url) {
			continue;
		}
		if api_key == &agent_api_key {
			return Ok(Some((provider.clone(), api_key.clone())));
		}
	}

	Ok(None)
}

fn opencode_provider_response(
	inventory: &[(InferenceProvider, String)],
	adapter: &OpenCodeProviderAdapter,
	binding: AgentProviderBinding,
) -> Result<AgentProviderResponse, ApiError> {
	let agent_api_key = adapter.api_key(&binding.id).map_err(ApiError::from)?;
	let matched =
		find_matching_inventory_provider(inventory, &binding, agent_api_key)?;
	let response = AgentProviderResponse::from(binding);
	Ok(match matched {
		Some((provider, _)) => {
			response.with_matched_inference_provider(&provider)
		}
		None => response,
	})
}

fn codex_provider_response(
	store: &InferenceProviderStore,
	inventory: &[(InferenceProvider, String)],
	adapter: &CodexProviderAdapter,
	binding: AgentProviderBinding,
) -> Result<AgentProviderResponse, ApiError> {
	let agent_api_key = adapter
		.api_key(store, &binding.id)
		.map_err(ApiError::from)?;
	let matched =
		find_matching_inventory_provider(inventory, &binding, agent_api_key)?;
	let response = AgentProviderResponse::from(binding);
	Ok(match matched {
		Some((provider, _)) => {
			response.with_matched_inference_provider(&provider)
		}
		None => response,
	})
}

fn codex_state_response(
	store: &InferenceProviderStore,
	adapter: &CodexProviderAdapter,
) -> Result<CodexProviderStateResponse, ApiError> {
	let inventory = inventory_providers_with_api_keys(store)?;
	let state = adapter.load_profile_state(store).map_err(ApiError::from)?;
	let providers = state
		.providers
		.iter()
		.cloned()
		.map(|binding| {
			codex_provider_response(store, &inventory, adapter, binding)
		})
		.collect::<Result<Vec<_>, _>>()?;
	Ok(CodexProviderStateResponse::from_state(state, providers))
}

#[get("/inference/providers")]
pub fn list_inference_providers(
	_auth: ApiAuth,
	state: &State<InferenceProviderState>,
) -> ApiResult<Vec<InferenceProviderResponse>> {
	let providers = store(state)
		.list()
		.map_err(ApiError::from)?
		.into_iter()
		.map(InferenceProviderResponse::from)
		.collect();
	Ok(Json(providers))
}

const MODELS_DEV_API_JSON: &str =
	include_str!("../dto/data/models_dev_api.json");
const MODELS_DEV_API_URL: &str = "https://models.dev/api.json";

fn models_dev_presets_from_json(
	json: &str,
) -> serde_json::Result<Vec<InferenceProviderPresetResponse>> {
	let providers =
		serde_json::from_str::<BTreeMap<String, ModelsDevProvider>>(json)?;
	let mut presets = providers
		.into_values()
		.filter_map(models_dev_provider_to_preset)
		.collect::<Vec<_>>();
	presets.sort_by_key(|preset| preset.name.to_lowercase());
	Ok(presets)
}

fn vendored_models_dev_presets() -> &'static [InferenceProviderPresetResponse] {
	use std::sync::OnceLock;
	static PRESETS: OnceLock<Vec<InferenceProviderPresetResponse>> =
		OnceLock::new();
	PRESETS.get_or_init(|| {
		models_dev_presets_from_json(MODELS_DEV_API_JSON)
			.expect("models_dev_api.json must be valid")
	})
}

#[derive(Debug, Deserialize)]
struct ModelsDevProvider {
	id: String,
	name: String,
	#[serde(default)]
	npm: Option<String>,
	#[serde(default)]
	api: Option<String>,
	#[serde(default)]
	doc: Option<String>,
	#[serde(default)]
	models: BTreeMap<String, serde_json::Value>,
}

fn default_api_base_url(provider_id: &str) -> Option<&'static str> {
	match provider_id {
		"anthropic" => Some("https://api.anthropic.com"),
		"openai" => Some("https://api.openai.com/v1"),
		_ => None,
	}
}

fn preset_format(npm: Option<&str>) -> Option<InferenceProviderFormatDto> {
	match npm {
		Some("@ai-sdk/anthropic") => {
			Some(InferenceProviderFormatDto::Anthropic)
		}
		Some("@ai-sdk/openai") => {
			Some(InferenceProviderFormatDto::OpenAiResponses)
		}
		Some("@ai-sdk/openai-compatible") => {
			Some(InferenceProviderFormatDto::OpenAiCompletions)
		}
		_ => None,
	}
}

fn models_dev_provider_to_preset(
	provider: ModelsDevProvider,
) -> Option<InferenceProviderPresetResponse> {
	let api_base_url = provider
		.api
		.or_else(|| default_api_base_url(&provider.id).map(str::to_string))?;
	let format = preset_format(provider.npm.as_deref())?;
	let models = provider.models.into_keys().collect::<Vec<_>>();

	Some(InferenceProviderPresetResponse {
		id: provider.id.clone(),
		name: provider.name.clone(),
		api_base_url,
		format,
		models,
		logo: provider.id,
		homepage: provider.doc,
		description: None,
	})
}

async fn fetch_models_dev_presets() -> Result<
	Vec<InferenceProviderPresetResponse>,
	Box<dyn std::error::Error + Send + Sync>,
> {
	let json = reqwest::Client::builder()
		.timeout(Duration::from_secs(8))
		.build()?
		.get(MODELS_DEV_API_URL)
		.send()
		.await?
		.error_for_status()?
		.text()
		.await?;
	Ok(models_dev_presets_from_json(&json)?)
}

#[get("/inference/presets")]
pub async fn list_inference_provider_presets(
	_auth: ApiAuth,
) -> Json<Vec<InferenceProviderPresetResponse>> {
	match fetch_models_dev_presets().await {
		Ok(presets) if !presets.is_empty() => Json(presets),
		_ => Json(vendored_models_dev_presets().to_vec()),
	}
}

#[get("/inference/agents/opencode/providers")]
pub fn list_opencode_providers(
	_auth: ApiAuth,
	state: &State<InferenceProviderState>,
) -> ApiResult<Vec<AgentProviderResponse>> {
	let store = store(state);
	let adapter = opencode_adapter()?;
	let inventory = opencode_inventory_providers_with_api_keys(&store)?;
	let providers = adapter
		.load_providers()
		.map_err(ApiError::from)?
		.providers
		.into_iter()
		.map(|binding| {
			opencode_provider_response(&inventory, &adapter, binding)
		})
		.collect::<Result<Vec<_>, _>>()?;
	Ok(Json(providers))
}

#[get("/inference/agents/codex/providers")]
pub fn list_codex_providers(
	_auth: ApiAuth,
	state: &State<InferenceProviderState>,
) -> ApiResult<Vec<AgentProviderResponse>> {
	let store = store(state);
	let adapter = codex_adapter()?;
	let inventory = inventory_providers_with_api_keys(&store)?;
	let providers = adapter
		.load_profile_state(&store)
		.map_err(ApiError::from)?
		.providers
		.into_iter()
		.map(|binding| {
			codex_provider_response(&store, &inventory, &adapter, binding)
		})
		.collect::<Result<Vec<_>, _>>()?;
	Ok(Json(providers))
}

#[get("/inference/agents/codex/state")]
pub fn get_codex_state(
	_auth: ApiAuth,
	state: &State<InferenceProviderState>,
) -> ApiResult<CodexProviderStateResponse> {
	let store = store(state);
	let adapter = codex_adapter()?;
	Ok(Json(codex_state_response(&store, &adapter)?))
}

#[post("/inference/agents/opencode/providers", data = "<body>")]
pub fn create_opencode_provider(
	_auth: ApiAuth,
	state: &State<InferenceProviderState>,
	body: Json<CreateAgentProviderRequest>,
) -> ApiCreated<AgentProviderResponse> {
	let store = store(state);
	let (provider, api_key) =
		get_inventory_provider(&store, &body.inference_provider_id)?;
	let binding = opencode_adapter()?
		.add_inventory_provider(&provider, &api_key)
		.map_err(ApiError::from)?;

	Ok((Status::Created, Json(binding.into())))
}

#[post("/inference/agents/codex/providers", data = "<body>")]
pub fn create_codex_provider(
	_auth: ApiAuth,
	state: &State<InferenceProviderState>,
	body: Json<CreateAgentProviderRequest>,
) -> ApiCreated<AgentProviderResponse> {
	let store = store(state);
	let body = body.into_inner();
	let (provider, api_key) =
		get_inventory_provider(&store, &body.inference_provider_id)?;
	let requested_model = match body.model.as_deref() {
		Some(model) => {
			let model = model.trim();
			if model.is_empty()
				|| !provider.models.iter().any(|item| item == model)
			{
				return Err(ApiError::new(
					Status::BadRequest,
					format!(
						"model '{model}' is not available for inference \
						 provider '{}'",
						provider.display_name
					),
					"INVALID_MODEL",
				));
			}
			Some(model.to_string())
		}
		None => None,
	};
	let adapter = codex_adapter()?;
	let binding = adapter
		.add_inventory_provider(&store, &provider, &api_key)
		.map_err(ApiError::from)?;
	let row = if let Some(model) = requested_model.as_deref() {
		adapter
			.set_active_provider_model(&store, &binding.id, Some(Some(model)))
			.map_err(ApiError::from)?;
		store
			.update_agent_binding(
				"codex",
				&binding.id,
				Some(Some(model.to_string())),
			)
			.map_err(ApiError::from)?
	} else {
		adapter
			.set_active_provider(&store, &binding.id)
			.map_err(ApiError::from)?;
		store
			.get_agent_binding("codex", &binding.id)
			.map_err(ApiError::from)?
	};

	Ok((
		Status::Created,
		Json(
			AgentProviderResponse::from(binding)
				.with_agent_binding_models(&row)
				.with_matched_inference_provider(&provider),
		),
	))
}

#[put("/inference/agents/opencode/providers/<id>", data = "<body>")]
pub fn update_opencode_provider(
	_auth: ApiAuth,
	id: &str,
	body: Json<UpdateAgentProviderRequest>,
) -> ApiResult<AgentProviderResponse> {
	let body = body.into_inner();
	let binding = opencode_adapter()?
		.update_provider(id, body.name.as_deref(), body.api_key.as_deref())
		.map_err(ApiError::from)?;

	Ok(Json(binding.into()))
}

#[put("/inference/agents/codex/providers/<id>", data = "<body>")]
pub fn update_codex_provider(
	_auth: ApiAuth,
	state: &State<InferenceProviderState>,
	id: &str,
	body: Json<UpdateAgentProviderRequest>,
) -> ApiResult<AgentProviderResponse> {
	let store = store(state);
	let body = body.into_inner();
	let binding = codex_adapter()?
		.update_provider(
			&store,
			id,
			body.name.as_deref(),
			body.api_key.as_deref(),
		)
		.map_err(ApiError::from)?;

	Ok(Json(binding.into()))
}

#[put("/inference/agents/codex/profile", data = "<body>")]
pub fn update_codex_active_profile(
	_auth: ApiAuth,
	state: &State<InferenceProviderState>,
	body: Json<UpdateCodexActiveProfileRequest>,
) -> ApiResult<CodexProviderStateResponse> {
	let store = store(state);
	let adapter = codex_adapter()?;
	adapter
		.set_active_profile(&store, &body.profile_id)
		.map_err(ApiError::from)?;
	Ok(Json(codex_state_response(&store, &adapter)?))
}

#[put(
	"/inference/agents/codex/profiles/<profile_id>/provider",
	data = "<body>"
)]
pub fn update_codex_profile_provider(
	_auth: ApiAuth,
	state: &State<InferenceProviderState>,
	profile_id: &str,
	body: Json<UpdateCodexProfileProviderRequest>,
) -> ApiResult<CodexProviderStateResponse> {
	let store = store(state);
	let adapter = codex_adapter()?;
	let body = body.into_inner();
	let model = body.model.as_ref().map(|model| model.as_deref());
	adapter
		.set_profile_provider_model(
			&store,
			profile_id,
			&body.provider_id,
			model,
		)
		.map_err(ApiError::from)?;
	Ok(Json(codex_state_response(&store, &adapter)?))
}

#[post("/inference/agents/opencode/providers/<id>/sync")]
pub fn sync_opencode_provider(
	_auth: ApiAuth,
	state: &State<InferenceProviderState>,
	id: &str,
) -> ApiResult<AgentProviderResponse> {
	let store = store(state);
	let adapter = opencode_adapter()?;
	let inventory = opencode_inventory_providers_with_api_keys(&store)?;
	let binding = adapter
		.load_providers()
		.map_err(ApiError::from)?
		.providers
		.into_iter()
		.find(|provider| provider.id == id)
		.ok_or_else(|| {
			ApiError::new(
				Status::NotFound,
				format!("OpenCode provider '{id}' not found"),
				"RESOURCE_NOT_FOUND",
			)
		})?;
	let agent_api_key = adapter.api_key(&binding.id).map_err(ApiError::from)?;
	let Some((provider, api_key)) =
		find_matching_inventory_provider(&inventory, &binding, agent_api_key)?
	else {
		return Err(ApiError::new(
			Status::UnprocessableEntity,
			format!(
				"OpenCode provider '{id}' is not backed by an aghub \
				 inference provider"
			),
			"UNRECOGNIZED_PROVIDER",
		));
	};

	let updated = adapter
		.add_provider(id, &provider, &api_key)
		.map_err(ApiError::from)?;

	Ok(Json(
		AgentProviderResponse::from(updated)
			.with_matched_inference_provider(&provider),
	))
}

#[post("/inference/agents/codex/providers/<id>/sync")]
pub fn sync_codex_provider(
	_auth: ApiAuth,
	state: &State<InferenceProviderState>,
	id: &str,
) -> ApiResult<AgentProviderResponse> {
	let store = store(state);
	let adapter = codex_adapter()?;
	let inventory = inventory_providers_with_api_keys(&store)?;
	let binding = adapter
		.load_profile_state(&store)
		.map_err(ApiError::from)?
		.providers
		.into_iter()
		.find(|provider| provider.id == id)
		.ok_or_else(|| {
			ApiError::new(
				Status::NotFound,
				format!("Codex provider '{id}' not found"),
				"RESOURCE_NOT_FOUND",
			)
		})?;
	let agent_api_key = adapter
		.api_key(&store, &binding.id)
		.map_err(ApiError::from)?;
	let Some((provider, api_key)) =
		find_matching_inventory_provider(&inventory, &binding, agent_api_key)?
	else {
		return Err(ApiError::new(
			Status::UnprocessableEntity,
			format!(
				"Codex provider '{id}' is not backed by an aghub inference \
				 provider"
			),
			"UNRECOGNIZED_PROVIDER",
		));
	};

	let updated = adapter
		.add_provider(id, &provider, &api_key)
		.map_err(ApiError::from)?;

	Ok(Json(
		AgentProviderResponse::from(updated)
			.with_matched_inference_provider(&provider),
	))
}

#[delete("/inference/agents/opencode/providers/<id>")]
pub fn delete_opencode_provider(_auth: ApiAuth, id: &str) -> ApiNoContent {
	opencode_adapter()?
		.remove_provider(id)
		.map_err(ApiError::from)?;
	Ok(NoContent)
}

#[delete("/inference/agents/codex/providers/<id>")]
pub fn delete_codex_provider(
	_auth: ApiAuth,
	state: &State<InferenceProviderState>,
	id: &str,
) -> ApiNoContent {
	let store = store(state);
	codex_adapter()?
		.remove_provider(&store, id)
		.map_err(ApiError::from)?;
	Ok(NoContent)
}

#[get("/inference/providers/<latin_name>/password")]
pub fn get_inference_provider_password(
	_auth: ApiAuth,
	state: &State<InferenceProviderState>,
	latin_name: &str,
) -> ApiResult<InferenceProviderPasswordResponse> {
	let store = store(state);
	let provider = find_by_latin_name(&store, latin_name)?;
	let api_key = store
		.get_api_key(&provider.id)
		.map_err(ApiError::from)?
		.ok_or_else(|| {
			ApiError::new(
				Status::NotFound,
				format!(
					"inference provider '{}' has no stored API key",
					provider.display_name
				),
				"RESOURCE_NOT_FOUND",
			)
		})?;

	Ok(Json(InferenceProviderPasswordResponse {
		latin_name: provider.latin_name,
		api_key,
	}))
}

#[post("/inference/providers", data = "<body>")]
pub fn create_inference_provider(
	_auth: ApiAuth,
	state: &State<InferenceProviderState>,
	body: Json<CreateInferenceProviderRequest>,
) -> ApiCreated<InferenceProviderResponse> {
	let provider = store(state)
		.create(body.into_inner().into())
		.map_err(ApiError::from)?;
	Ok((Status::Created, Json(provider.into())))
}

#[put("/inference/providers/<latin_name>", data = "<body>")]
pub fn update_inference_provider(
	_auth: ApiAuth,
	state: &State<InferenceProviderState>,
	latin_name: &str,
	body: Json<UpdateInferenceProviderRequest>,
) -> ApiResult<InferenceProviderResponse> {
	let store = store(state);
	let provider = find_by_latin_name(&store, latin_name)?;
	let updated = store
		.update(&provider.id, body.into_inner().into())
		.map_err(ApiError::from)?;
	Ok(Json(updated.into()))
}

fn remove_claude_provider_references(
	store: &InferenceProviderStore,
	provider: &InferenceProvider,
) -> Result<(), ApiError> {
	let adapter = claude_adapter()?;
	let binding_ids = store
		.list_agent_bindings("claude")
		.map_err(ApiError::from)?
		.into_iter()
		.filter(|row| row.inference_provider_id == provider.id)
		.map(|row| row.id)
		.collect::<Vec<_>>();

	for binding_id in binding_ids {
		adapter
			.remove_binding(store, &binding_id)
			.map_err(ApiError::from)?;
	}

	Ok(())
}

fn remove_codex_provider_references(
	store: &InferenceProviderStore,
	provider: &InferenceProvider,
) -> Result<(), ApiError> {
	let adapter = codex_adapter()?;
	let binding_ids = store
		.list_agent_bindings("codex")
		.map_err(ApiError::from)?
		.into_iter()
		.filter(|row| row.inference_provider_id == provider.id)
		.map(|row| row.id)
		.collect::<Vec<_>>();

	for binding_id in binding_ids {
		adapter
			.remove_provider(store, &binding_id)
			.map_err(ApiError::from)?;
	}

	Ok(())
}

fn remove_opencode_provider_references(
	store: &InferenceProviderStore,
	provider: &InferenceProvider,
) -> Result<(), ApiError> {
	let Some(api_key) =
		store.get_api_key(&provider.id).map_err(ApiError::from)?
	else {
		return Ok(());
	};

	let adapter = opencode_adapter()?;
	let inventory = vec![(
		OpenCodeProviderAdapter::normalize_inventory_provider(provider),
		api_key,
	)];
	let mut provider_ids = Vec::new();
	for binding in adapter.load_providers().map_err(ApiError::from)?.providers {
		let agent_api_key =
			adapter.api_key(&binding.id).map_err(ApiError::from)?;
		if find_matching_inventory_provider(
			&inventory,
			&binding,
			agent_api_key,
		)?
		.is_some() && !provider_ids.iter().any(|id| id == &binding.id)
		{
			provider_ids.push(binding.id);
		}
	}

	for provider_id in provider_ids {
		adapter
			.remove_provider(&provider_id)
			.map_err(ApiError::from)?;
	}

	Ok(())
}

fn remove_agent_provider_references(
	store: &InferenceProviderStore,
	provider: &InferenceProvider,
) -> Result<(), ApiError> {
	remove_claude_provider_references(store, provider)?;
	remove_codex_provider_references(store, provider)?;
	remove_opencode_provider_references(store, provider)?;
	Ok(())
}

#[delete("/inference/providers/<latin_name>")]
pub fn delete_inference_provider(
	_auth: ApiAuth,
	state: &State<InferenceProviderState>,
	latin_name: &str,
) -> ApiNoContent {
	let store = store(state);
	let provider = find_by_latin_name(&store, latin_name)?;
	remove_agent_provider_references(&store, &provider)?;
	store.delete(&provider.id).map_err(ApiError::from)?;
	Ok(NoContent)
}

// ============================================================================
// Claude Code routes (binding-table backed)
// ============================================================================

fn claude_state_response(
	store: &InferenceProviderStore,
	adapter: &ClaudeProviderAdapter,
) -> Result<ClaudeProviderStateResponse, ApiError> {
	let state = adapter.load_bindings_state(store).map_err(ApiError::from)?;
	let inventory = inventory_providers_with_api_keys(store)?;
	let rows = store
		.list_agent_bindings("claude")
		.map_err(ApiError::from)?;
	let providers = state
		.providers
		.iter()
		.map(|binding| {
			// Built-in providers have no inventory backing; skip matching.
			let matched = match binding.source_provider_id.as_deref() {
				Some(id) if !id.is_empty() => inventory
					.iter()
					.find(|(provider, _)| provider.id == id)
					.cloned(),
				_ => None,
			};
			let mut response = AgentProviderResponse::from(binding);
			if let Some(row) = rows.iter().find(|row| row.id == binding.id) {
				response = response.with_agent_binding_models(row);
			}
			let result: Result<AgentProviderResponse, ApiError> =
				Ok(match matched {
					Some((provider, _)) => {
						response.with_matched_inference_provider(&provider)
					}
					None => response,
				});
			result
		})
		.collect::<Result<Vec<_>, _>>()?;
	let active_provider_id = adapter
		.derive_active_provider_id(store)
		.map_err(ApiError::from)?;
	let active_model = state
		.default_model
		.as_ref()
		.map(|selection| selection.model_id.clone());
	let active_row = rows.iter().find(|row| row.id == active_provider_id);
	Ok(ClaudeProviderStateResponse {
		providers,
		active_provider_id,
		active_model,
		active_haiku_model: active_row.and_then(|row| {
			row.haiku_model.clone().or_else(|| row.model.clone())
		}),
		active_sonnet_model: active_row.and_then(|row| {
			row.sonnet_model.clone().or_else(|| row.model.clone())
		}),
		active_opus_model: active_row.and_then(|row| {
			row.opus_model.clone().or_else(|| row.model.clone())
		}),
	})
}

#[get("/inference/agents/claude/state")]
pub fn get_claude_state(
	_auth: ApiAuth,
	state: &State<InferenceProviderState>,
) -> ApiResult<ClaudeProviderStateResponse> {
	let store = store(state);
	let adapter = claude_adapter()?;
	Ok(Json(claude_state_response(&store, &adapter)?))
}

#[post("/inference/agents/claude/providers", data = "<body>")]
pub fn create_claude_provider(
	_auth: ApiAuth,
	state: &State<InferenceProviderState>,
	body: Json<CreateAgentProviderRequest>,
) -> ApiCreated<AgentProviderResponse> {
	let store = store(state);
	let body = body.into_inner();
	let (provider, api_key) =
		get_inventory_provider(&store, &body.inference_provider_id)?;
	let adapter = claude_adapter()?;
	let binding = adapter
		.add_binding_with_models(
			&store,
			&provider,
			&api_key,
			ClaudeModelRouting {
				model: body.model,
				haiku_model: body.haiku_model,
				sonnet_model: body.sonnet_model,
				opus_model: body.opus_model,
			},
			true,
		)
		.map_err(ApiError::from)?;
	let row = store
		.get_agent_binding("claude", &binding.id)
		.map_err(ApiError::from)?;

	Ok((
		Status::Created,
		Json(
			AgentProviderResponse::from(binding)
				.with_agent_binding_models(&row)
				.with_matched_inference_provider(&provider),
		),
	))
}

#[put("/inference/agents/claude/providers/<id>", data = "<body>")]
pub fn update_claude_provider(
	_auth: ApiAuth,
	state: &State<InferenceProviderState>,
	id: &str,
	body: Json<UpdateAgentProviderRequest>,
) -> ApiResult<ClaudeProviderStateResponse> {
	let store = store(state);
	let adapter = claude_adapter()?;
	let body = body.into_inner();

	if body.name.as_deref().is_some() {
		return Err(ApiError::new(
			Status::BadRequest,
			"Claude provider name cannot be changed".to_string(),
			"UNSUPPORTED_OPERATION",
		));
	}

	if let Some(api_key) = body.api_key.as_deref() {
		let row = store
			.get_agent_binding("claude", id)
			.map_err(ApiError::from)?;
		let provider = store
			.get(&row.inference_provider_id)
			.map_err(ApiError::from)?;
		store
			.set_api_key(&provider.id, api_key)
			.map_err(ApiError::from)?;
	}
	adapter
		.set_active_binding_models(
			&store,
			id,
			AgentProviderBindingModelUpdate {
				model: body.model,
				haiku_model: body.haiku_model,
				sonnet_model: body.sonnet_model,
				opus_model: body.opus_model,
			},
		)
		.map_err(ApiError::from)?;

	Ok(Json(claude_state_response(&store, &adapter)?))
}

#[post("/inference/agents/claude/providers/<id>/sync")]
pub fn sync_claude_provider(
	_auth: ApiAuth,
	state: &State<InferenceProviderState>,
	id: &str,
) -> ApiResult<AgentProviderResponse> {
	let store = store(state);
	let adapter = claude_adapter()?;
	let row = store
		.get_agent_binding("claude", id)
		.map_err(ApiError::from)?;
	let provider = store
		.get(&row.inference_provider_id)
		.map_err(ApiError::from)?;
	let was_active = adapter
		.derive_active_provider_id(&store)
		.map_err(ApiError::from)?
		== id;
	let model = provider.models.first().cloned();
	let row = store
		.update_agent_binding("claude", id, Some(model.clone()))
		.map_err(ApiError::from)?;

	if was_active {
		let api_key = store
			.get_api_key(&provider.id)
			.map_err(ApiError::from)?
			.ok_or_else(|| {
				ApiError::new(
					Status::UnprocessableEntity,
					format!(
						"inference provider '{}' has no stored API key",
						provider.display_name
					),
					"MISSING_CREDENTIAL",
				)
			})?;

		adapter
			.sync_active_binding_models(
				&provider,
				&api_key,
				&ClaudeModelRouting {
					model: row.model.clone(),
					haiku_model: row.haiku_model.clone(),
					sonnet_model: row.sonnet_model.clone(),
					opus_model: row.opus_model.clone(),
				},
			)
			.map_err(ApiError::from)?;
	}

	let binding = store.binding_from_row(&row).map_err(ApiError::from)?;
	Ok(Json(
		AgentProviderResponse::from(binding)
			.with_agent_binding_models(&row)
			.with_matched_inference_provider(&provider),
	))
}

#[delete("/inference/agents/claude/providers/<id>")]
pub fn delete_claude_provider(
	_auth: ApiAuth,
	state: &State<InferenceProviderState>,
	id: &str,
) -> ApiNoContent {
	let store = store(state);
	let adapter = claude_adapter()?;
	adapter.remove_binding(&store, id).map_err(ApiError::from)?;
	Ok(NoContent)
}

#[delete("/inference/agents/claude/state")]
pub fn clear_claude_state(
	_auth: ApiAuth,
	state: &State<InferenceProviderState>,
) -> ApiNoContent {
	let _store = store(state);
	let adapter = claude_adapter()?;
	adapter.clear_provider_config().map_err(ApiError::from)?;
	Ok(NoContent)
}

#[delete("/inference/agents/codex/state")]
pub fn clear_codex_state(
	_auth: ApiAuth,
	state: &State<InferenceProviderState>,
) -> ApiNoContent {
	let store = store(state);
	let adapter = codex_adapter()?;
	adapter
		.clear_active_provider(&store)
		.map_err(ApiError::from)?;
	Ok(NoContent)
}
