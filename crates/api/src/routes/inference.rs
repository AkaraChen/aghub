use aghub_inference::{
	AgentProviderAdapter, InferenceProvider, InferenceProviderRepository,
	InferenceProviderStore, OpenCodeProviderAdapter,
};
use rocket::http::Status;
use rocket::response::status::NoContent;
use rocket::serde::json::Json;
use rocket::State;

use crate::dto::inference::{
	AgentProviderResponse, CreateAgentProviderRequest,
	CreateInferenceProviderRequest, InferenceProviderPasswordResponse,
	InferenceProviderResponse, UpdateAgentProviderRequest,
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
					provider.name
				),
				"MISSING_CREDENTIAL",
			)
		})?;
	Ok((provider, api_key))
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
pub fn list_opencode_providers() -> ApiResult<Vec<AgentProviderResponse>> {
	let providers = opencode_adapter()?
		.load_providers()
		.map_err(ApiError::from)?
		.providers
		.into_iter()
		.map(AgentProviderResponse::from)
		.collect();
	Ok(Json(providers))
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

#[put("/inference/agents/opencode/providers/<id>", data = "<body>")]
pub fn update_opencode_provider(
	state: &State<InferenceProviderState>,
	id: &str,
	body: Json<UpdateAgentProviderRequest>,
) -> ApiResult<AgentProviderResponse> {
	let store = store(state);
	let (provider, api_key) =
		get_inventory_provider(&store, &body.inference_provider_id)?;
	let adapter = opencode_adapter()?;
	let exists = adapter
		.load_providers()
		.map_err(ApiError::from)?
		.providers
		.iter()
		.any(|provider| provider.id == id);
	if !exists {
		return Err(ApiError::new(
			Status::NotFound,
			format!("OpenCode provider '{id}' not found"),
			"RESOURCE_NOT_FOUND",
		));
	}

	let binding = adapter
		.add_provider(id, &provider, &api_key)
		.map_err(ApiError::from)?;

	Ok(Json(binding.into()))
}

#[delete("/inference/agents/opencode/providers/<id>")]
pub fn delete_opencode_provider(id: &str) -> ApiNoContent {
	opencode_adapter()?
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
					provider.name
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
