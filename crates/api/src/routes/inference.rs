use aghub_inference::{
	AgentProviderAdapter, AgentProviderBinding, ClaudeProviderAdapter,
	CodexProviderAdapter, InferenceProvider, InferenceProviderRepository,
	InferenceProviderStore, OpenCodeProviderAdapter,
};
use rocket::http::Status;
use rocket::response::status::NoContent;
use rocket::serde::json::Json;
use rocket::State;

use crate::dto::inference::{
	AgentProviderResponse, ClaudeProviderStateResponse,
	CodexProviderStateResponse, CreateAgentProviderRequest,
	CreateInferenceProviderRequest, FetchedModelDto, FetchProviderModelsRequest,
	FetchProviderModelsResponse, InferenceProviderFormatDto,
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

fn find_by_name(
	store: &InferenceProviderStore,
	name: &str,
) -> Result<InferenceProvider, ApiError> {
	store
		.list()
		.map_err(ApiError::from)?
		.into_iter()
		.find(|provider| provider.name.eq_ignore_ascii_case(name))
		.ok_or_else(|| {
			ApiError::new(
				Status::NotFound,
				format!("inference provider '{name}' not found"),
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

const INFERENCE_PROVIDER_PRESETS_JSON: &str =
	include_str!("../dto/data/inference_provider_presets.json");

fn inference_provider_presets() -> &'static [InferenceProviderPresetResponse] {
	use std::sync::OnceLock;
	static PRESETS: OnceLock<Vec<InferenceProviderPresetResponse>> =
		OnceLock::new();
	PRESETS.get_or_init(|| {
		serde_json::from_str(INFERENCE_PROVIDER_PRESETS_JSON)
			.expect("inference_provider_presets.json must be valid")
	})
}

#[get("/inference/presets")]
pub fn list_inference_provider_presets(
) -> Json<Vec<InferenceProviderPresetResponse>> {
	Json(inference_provider_presets().to_vec())
}

#[post("/inference/fetch-models", data = "<body>")]
pub async fn fetch_inference_provider_models(
	body: Json<FetchProviderModelsRequest>,
) -> ApiResult<FetchProviderModelsResponse> {
	let api_base_url = body.api_base_url.trim().trim_end_matches('/');
	if api_base_url.is_empty() {
		return Err(ApiError::bad_request("api_base_url is required"));
	}
	let api_key = body.api_key.trim();
	if api_key.is_empty() {
		return Err(ApiError::bad_request("api_key is required"));
	}

	let client = reqwest::Client::builder()
		.timeout(std::time::Duration::from_secs(15))
		.build()
		.map_err(|e| ApiError::internal(format!("http client init: {e}")))?;

	let url = format!("{api_base_url}/models");
	let request = match body.format {
		InferenceProviderFormatDto::Anthropic => client
			.get(&url)
			.header("x-api-key", api_key)
			.header("anthropic-version", "2023-06-01"),
		InferenceProviderFormatDto::OpenAiCompletions
		| InferenceProviderFormatDto::OpenAiResponses => client
			.get(&url)
			.header("Authorization", format!("Bearer {api_key}")),
	};

	let response = request.send().await.map_err(|e| {
		ApiError::new(
			Status::BadGateway,
			format!("upstream request failed: {e}"),
			"UPSTREAM_REQUEST_FAILED",
		)
	})?;

	if !response.status().is_success() {
		let status = response.status().as_u16();
		let body = response.text().await.unwrap_or_default();
		return Err(ApiError::new(
			Status::BadGateway,
			if body.is_empty() {
				format!("upstream returned HTTP {status}")
			} else {
				body
			},
			"UPSTREAM_ERROR",
		));
	}

	let raw = response
		.text()
		.await
		.map_err(|e| ApiError::internal(format!("failed to read response: {e}")))?;

	let payload: serde_json::Value = serde_json::from_str(&raw)
		.map_err(|e| ApiError::internal(format!("invalid JSON from upstream: {e}")))?;

	let models = parse_models(&payload, body.format);
	if models.is_empty() {
		return Err(ApiError::new(
			Status::BadGateway,
			"upstream returned no models".to_string(),
			"NO_MODELS",
		));
	}

	Ok(Json(FetchProviderModelsResponse { models }))
}

fn parse_models(
	payload: &serde_json::Value,
	format: InferenceProviderFormatDto,
) -> Vec<FetchedModelDto> {
	let data = match payload.get("data").and_then(|v| v.as_array()) {
		Some(arr) => arr,
		None => return Vec::new(),
	};

	data.iter()
		.filter_map(|entry| {
			let id = entry.get("id")?.as_str()?.to_string();
			if id.is_empty() {
				return None;
			}
			let name = match format {
				InferenceProviderFormatDto::Anthropic => entry
					.get("display_name")
					.and_then(|v| v.as_str())
					.map(str::to_string),
				InferenceProviderFormatDto::OpenAiCompletions
				| InferenceProviderFormatDto::OpenAiResponses => None,
			};
			Some(FetchedModelDto { id, name })
		})
		.collect()
}

#[get("/inference/agents/opencode/providers")]
pub fn list_opencode_providers(
	state: &State<InferenceProviderState>,
) -> ApiResult<Vec<AgentProviderResponse>> {
	let store = store(state);
	let adapter = opencode_adapter()?;
	let inventory = inventory_providers_with_api_keys(&store)?;
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
	state: &State<InferenceProviderState>,
) -> ApiResult<CodexProviderStateResponse> {
	let store = store(state);
	let adapter = codex_adapter()?;
	Ok(Json(codex_state_response(&store, &adapter)?))
}

#[post("/inference/agents/opencode/providers", data = "<body>")]
pub fn create_opencode_provider(
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
	state: &State<InferenceProviderState>,
	body: Json<CreateAgentProviderRequest>,
) -> ApiCreated<AgentProviderResponse> {
	let store = store(state);
	let (provider, api_key) =
		get_inventory_provider(&store, &body.inference_provider_id)?;
	let adapter = codex_adapter()?;
	let binding = adapter
		.add_inventory_provider(&store, &provider, &api_key)
		.map_err(ApiError::from)?;
	adapter
		.set_active_provider(&store, &binding.id)
		.map_err(ApiError::from)?;

	Ok((
		Status::Created,
		Json(
			AgentProviderResponse::from(binding)
				.with_matched_inference_provider(&provider),
		),
	))
}

#[put("/inference/agents/opencode/providers/<id>", data = "<body>")]
pub fn update_opencode_provider(
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
	state: &State<InferenceProviderState>,
	profile_id: &str,
	body: Json<UpdateCodexProfileProviderRequest>,
) -> ApiResult<CodexProviderStateResponse> {
	let store = store(state);
	let adapter = codex_adapter()?;
	adapter
		.set_profile_provider(&store, profile_id, &body.provider_id)
		.map_err(ApiError::from)?;
	Ok(Json(codex_state_response(&store, &adapter)?))
}

#[post("/inference/agents/opencode/providers/<id>/sync")]
pub fn sync_opencode_provider(
	state: &State<InferenceProviderState>,
	id: &str,
) -> ApiResult<AgentProviderResponse> {
	let store = store(state);
	let adapter = opencode_adapter()?;
	let inventory = inventory_providers_with_api_keys(&store)?;
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
pub fn delete_opencode_provider(id: &str) -> ApiNoContent {
	opencode_adapter()?
		.remove_provider(id)
		.map_err(ApiError::from)?;
	Ok(NoContent)
}

#[delete("/inference/agents/codex/providers/<id>")]
pub fn delete_codex_provider(
	state: &State<InferenceProviderState>,
	id: &str,
) -> ApiNoContent {
	let store = store(state);
	codex_adapter()?
		.remove_provider(&store, id)
		.map_err(ApiError::from)?;
	Ok(NoContent)
}

#[get("/inference/providers/<name>/password")]
pub fn get_inference_provider_password(
	state: &State<InferenceProviderState>,
	name: &str,
) -> ApiResult<InferenceProviderPasswordResponse> {
	let store = store(state);
	let provider = find_by_name(&store, name)?;
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
		name: provider.name,
		api_key,
	}))
}

#[post("/inference/providers", data = "<body>")]
pub fn create_inference_provider(
	state: &State<InferenceProviderState>,
	body: Json<CreateInferenceProviderRequest>,
) -> ApiCreated<InferenceProviderResponse> {
	let provider = store(state)
		.create(body.into_inner().into())
		.map_err(ApiError::from)?;
	Ok((Status::Created, Json(provider.into())))
}

#[put("/inference/providers/<name>", data = "<body>")]
pub fn update_inference_provider(
	state: &State<InferenceProviderState>,
	name: &str,
	body: Json<UpdateInferenceProviderRequest>,
) -> ApiResult<InferenceProviderResponse> {
	let store = store(state);
	let provider = find_by_name(&store, name)?;
	let updated = store
		.update(&provider.id, body.into_inner().into())
		.map_err(ApiError::from)?;
	Ok(Json(updated.into()))
}

#[delete("/inference/providers/<name>")]
pub fn delete_inference_provider(
	state: &State<InferenceProviderState>,
	name: &str,
) -> ApiNoContent {
	let store = store(state);
	let provider = find_by_name(&store, name)?;
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
	let providers = state
		.providers
		.iter()
		.cloned()
		.map(|binding| {
			// Built-in providers have no inventory backing; skip matching.
			let matched = match binding.source_provider_id.as_deref() {
				Some(id) if !id.is_empty() => inventory
					.iter()
					.find(|(provider, _)| provider.id == id)
					.cloned(),
				_ => None,
			};
			let response = AgentProviderResponse::from(binding);
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
	Ok(ClaudeProviderStateResponse {
		providers,
		active_provider_id,
	})
}

#[get("/inference/agents/claude/state")]
pub fn get_claude_state(
	state: &State<InferenceProviderState>,
) -> ApiResult<ClaudeProviderStateResponse> {
	let store = store(state);
	let adapter = claude_adapter()?;
	Ok(Json(claude_state_response(&store, &adapter)?))
}

#[post("/inference/agents/claude/providers", data = "<body>")]
pub fn create_claude_provider(
	state: &State<InferenceProviderState>,
	body: Json<CreateAgentProviderRequest>,
) -> ApiCreated<AgentProviderResponse> {
	let store = store(state);
	let (provider, api_key) =
		get_inventory_provider(&store, &body.inference_provider_id)?;
	let adapter = claude_adapter()?;
	let binding = adapter
		.add_binding(&store, &provider, &api_key, true)
		.map_err(ApiError::from)?;

	Ok((
		Status::Created,
		Json(
			AgentProviderResponse::from(binding)
				.with_matched_inference_provider(&provider),
		),
	))
}

#[put("/inference/agents/claude/providers/<id>", data = "<body>")]
pub fn update_claude_provider(
	state: &State<InferenceProviderState>,
	id: &str,
	body: Json<UpdateAgentProviderRequest>,
) -> ApiResult<ClaudeProviderStateResponse> {
	let store = store(state);
	let adapter = claude_adapter()?;

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
		.set_active_binding(&store, id)
		.map_err(ApiError::from)?;

	Ok(Json(claude_state_response(&store, &adapter)?))
}

#[post("/inference/agents/claude/providers/<id>/sync")]
pub fn sync_claude_provider(
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
		.sync_active_binding(&provider, &api_key, row.model.as_deref())
		.map_err(ApiError::from)?;

	let binding = store.binding_from_row(&row).map_err(ApiError::from)?;
	Ok(Json(
		AgentProviderResponse::from(binding)
			.with_matched_inference_provider(&provider),
	))
}

#[delete("/inference/agents/claude/providers/<id>")]
pub fn delete_claude_provider(
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
	state: &State<InferenceProviderState>,
) -> ApiNoContent {
	let _store = store(state);
	let adapter = claude_adapter()?;
	adapter.clear_provider_config().map_err(ApiError::from)?;
	Ok(NoContent)
}

#[delete("/inference/agents/codex/state")]
pub fn clear_codex_state(
	state: &State<InferenceProviderState>,
) -> ApiNoContent {
	let store = store(state);
	let adapter = codex_adapter()?;
	adapter
		.clear_active_provider(&store)
		.map_err(ApiError::from)?;
	Ok(NoContent)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parse_models_anthropic() {
		let payload = serde_json::json!({
			"data": [
				{"id": "claude-sonnet-4-6", "display_name": "Claude Sonnet 4.6"},
				{"id": "claude-opus-4-7", "display_name": "Claude Opus 4.7"}
			]
		});
		let models =
			parse_models(&payload, InferenceProviderFormatDto::Anthropic);
		assert_eq!(models.len(), 2);
		assert_eq!(models[0].id, "claude-sonnet-4-6");
		assert_eq!(
			models[0].name.as_deref(),
			Some("Claude Sonnet 4.6")
		);
		assert_eq!(models[1].id, "claude-opus-4-7");
		assert_eq!(models[1].name.as_deref(), Some("Claude Opus 4.7"));
	}

	#[test]
	fn parse_models_openai_completions() {
		let payload = serde_json::json!({
			"data": [
				{"id": "gpt-5", "created": 1234567890},
				{"id": "gpt-5-mini", "created": 1234567890}
			]
		});
		let models = parse_models(
			&payload,
			InferenceProviderFormatDto::OpenAiCompletions,
		);
		assert_eq!(models.len(), 2);
		assert_eq!(models[0].id, "gpt-5");
		assert!(models[0].name.is_none());
		assert_eq!(models[1].id, "gpt-5-mini");
		assert!(models[1].name.is_none());
	}

	#[test]
	fn parse_models_openai_responses() {
		let payload = serde_json::json!({
			"data": [
				{"id": "gpt-5"},
				{"id": "o4-mini"}
			]
		});
		let models = parse_models(
			&payload,
			InferenceProviderFormatDto::OpenAiResponses,
		);
		assert_eq!(models.len(), 2);
		assert_eq!(models[0].id, "gpt-5");
		assert!(models[0].name.is_none());
		assert_eq!(models[1].id, "o4-mini");
		assert!(models[1].name.is_none());
	}

	#[test]
	fn parse_models_empty_data_array() {
		let payload = serde_json::json!({"data": []});
		let models =
			parse_models(&payload, InferenceProviderFormatDto::Anthropic);
		assert!(models.is_empty());
	}

	#[test]
	fn parse_models_missing_data_field() {
		let payload = serde_json::json!({"object": "list"});
		let models =
			parse_models(&payload, InferenceProviderFormatDto::Anthropic);
		assert!(models.is_empty());
	}

	#[test]
	fn parse_models_data_not_an_array() {
		let payload = serde_json::json!({"data": "not_an_array"});
		let models =
			parse_models(&payload, InferenceProviderFormatDto::Anthropic);
		assert!(models.is_empty());
	}

	#[test]
	fn parse_models_skips_missing_id() {
		let payload = serde_json::json!({
			"data": [
				{"id": "valid-model"},
				{"display_name": "no id here"},
				{"id": "another-valid"}
			]
		});
		let models =
			parse_models(&payload, InferenceProviderFormatDto::OpenAiCompletions);
		assert_eq!(models.len(), 2);
		assert_eq!(models[0].id, "valid-model");
		assert_eq!(models[1].id, "another-valid");
	}

	#[test]
	fn parse_models_skips_empty_id() {
		let payload = serde_json::json!({
			"data": [
				{"id": ""},
				{"id": "good-one"}
			]
		});
		let models =
			parse_models(&payload, InferenceProviderFormatDto::Anthropic);
		assert_eq!(models.len(), 1);
		assert_eq!(models[0].id, "good-one");
	}
}
