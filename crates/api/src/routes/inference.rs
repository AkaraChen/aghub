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
	CreateInferenceProviderRequest, InferenceProviderPasswordResponse,
	InferenceProviderResponse, UpdateAgentProviderRequest,
	UpdateClaudeProviderRequest, UpdateCodexActiveProfileRequest,
	UpdateCodexProfileProviderRequest, UpdateInferenceProviderRequest,
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
	inventory: &[(InferenceProvider, String)],
	adapter: &CodexProviderAdapter,
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

fn codex_state_response(
	store: &InferenceProviderStore,
	adapter: &CodexProviderAdapter,
) -> Result<CodexProviderStateResponse, ApiError> {
	let inventory = inventory_providers_with_api_keys(store)?;
	let state = adapter.load_profile_state().map_err(ApiError::from)?;
	let providers = state
		.providers
		.iter()
		.cloned()
		.map(|binding| codex_provider_response(&inventory, adapter, binding))
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
		.load_providers()
		.map_err(ApiError::from)?
		.providers
		.into_iter()
		.map(|binding| codex_provider_response(&inventory, &adapter, binding))
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
		.add_inventory_provider(&provider, &api_key)
		.map_err(ApiError::from)?;
	adapter
		.set_active_provider(&binding.id)
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
	id: &str,
	body: Json<UpdateAgentProviderRequest>,
) -> ApiResult<AgentProviderResponse> {
	let body = body.into_inner();
	let binding = codex_adapter()?
		.update_provider(id, body.name.as_deref(), body.api_key.as_deref())
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
		.set_active_profile(&body.profile_id)
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
		.set_profile_provider(profile_id, &body.provider_id)
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
		.load_providers()
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
	let agent_api_key = adapter.api_key(&binding.id).map_err(ApiError::from)?;
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
pub fn delete_codex_provider(id: &str) -> ApiNoContent {
	codex_adapter()?
		.remove_provider(id)
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
// Claude Code routes
// ============================================================================

#[get("/inference/agents/claude/state")]
pub fn get_claude_state() -> ApiResult<ClaudeProviderStateResponse> {
	let adapter = claude_adapter()?;
	let state = adapter.load_config_state().map_err(ApiError::from)?;
	Ok(Json(state.into()))
}

#[put("/inference/agents/claude/state", data = "<body>")]
pub fn update_claude_state(
	body: Json<UpdateClaudeProviderRequest>,
) -> ApiResult<ClaudeProviderStateResponse> {
	let adapter = claude_adapter()?;
	let state = aghub_inference::ClaudeConfigState {
		api_base_url: body.api_base_url.clone(),
		api_key: body.api_key.clone(),
		api_key_env_name: None,
		model: body.model.clone(),
		haiku_model: None,
		sonnet_model: None,
		opus_model: None,
	};
	adapter.save_config_state(&state).map_err(ApiError::from)?;
	Ok(Json(state.into()))
}

#[delete("/inference/agents/claude/state")]
pub fn clear_claude_state() -> ApiNoContent {
	let adapter = claude_adapter()?;
	adapter.clear_provider_config().map_err(ApiError::from)?;
	Ok(NoContent)
}

#[delete("/inference/agents/codex/state")]
pub fn clear_codex_state() -> ApiNoContent {
	let adapter = codex_adapter()?;
	adapter.clear_active_provider().map_err(ApiError::from)?;
	Ok(NoContent)
}
