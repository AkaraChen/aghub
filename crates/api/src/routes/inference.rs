use aghub_inference::{
	InferenceProvider, InferenceProviderRepository, InferenceProviderStore,
};
use rocket::http::Status;
use rocket::response::status::NoContent;
use rocket::serde::json::Json;
use rocket::State;

use crate::dto::inference::{
	CreateInferenceProviderRequest, InferenceProviderPasswordResponse,
	InferenceProviderResponse, UpdateInferenceProviderRequest,
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
