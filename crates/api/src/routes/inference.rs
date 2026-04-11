use aghub_core::{
	create_adapter, models::AgentType, transfer_opencode_providers_to_codex,
	ConfigManager,
};
use rocket::http::Status;
use rocket::serde::json::Json;

use crate::{
	dto::inference::{
		CreateInferenceProviderRequest, InferenceCredentialDto,
		InferenceProviderResponseDto, ProviderTransferResponseDto,
		UpdateInferenceProviderRequest,
	},
	error::{ApiCreated, ApiError, ApiNoContent, ApiResult},
	provider_store::{
		CreateProviderInput, ProviderStoreError, StoredProvider,
		UpdateProviderInput,
	},
	state::InferenceProviderStoreState,
};

fn provider_store_error(error: ProviderStoreError) -> ApiError {
	match error {
		ProviderStoreError::NotFound(name) => ApiError::new(
			Status::NotFound,
			format!("provider '{name}' not found"),
			"RESOURCE_NOT_FOUND",
		),
		ProviderStoreError::Exists(name) => ApiError::new(
			Status::Conflict,
			format!("provider '{name}' already exists"),
			"RESOURCE_EXISTS",
		),
		ProviderStoreError::Validation(message) => ApiError::new(
			Status::UnprocessableEntity,
			message,
			"VALIDATION_FAILED",
		),
		ProviderStoreError::Internal(message) => ApiError::new(
			Status::InternalServerError,
			message,
			"STRONGHOLD_ERROR",
		),
	}
}

impl From<StoredProvider> for InferenceProviderResponseDto {
	fn from(value: StoredProvider) -> Self {
		let has_key = value.has_key();
		InferenceProviderResponseDto {
			id: value.id,
			name: value.name,
			r#type: value.r#type.into(),
			base: value.base,
			has_key,
		}
	}
}

#[get("/inference/providers/managed")]
pub fn list_managed_providers(
	store: &rocket::State<InferenceProviderStoreState>,
) -> ApiResult<Vec<InferenceProviderResponseDto>> {
	let mut vault = store.store.lock().unwrap();
	let providers = vault.list().map_err(provider_store_error)?;
	let items = providers.into_iter().map(Into::into).collect();
	Ok(Json(items))
}

#[get("/inference/providers/managed/<id>")]
pub fn get_managed_provider(
	id: &str,
	store: &rocket::State<InferenceProviderStoreState>,
) -> ApiResult<InferenceProviderResponseDto> {
	let mut vault = store.store.lock().unwrap();
	let provider = vault.get(id).map_err(provider_store_error)?;
	Ok(Json(provider.into()))
}

#[post("/inference/providers/managed", data = "<body>")]
pub fn create_managed_provider(
	body: Json<CreateInferenceProviderRequest>,
	store: &rocket::State<InferenceProviderStoreState>,
) -> ApiCreated<InferenceProviderResponseDto> {
	let mut vault = store.store.lock().unwrap();
	let provider = vault
		.create(CreateProviderInput {
			name: body.name.clone(),
			r#type: body.r#type.into(),
			base: body.base.clone(),
			key: body.key.clone(),
		})
		.map_err(provider_store_error)?;
	Ok((Status::Created, Json(provider.into())))
}

#[put("/inference/providers/managed/<id>", data = "<body>")]
pub fn update_managed_provider(
	id: &str,
	body: Json<UpdateInferenceProviderRequest>,
	store: &rocket::State<InferenceProviderStoreState>,
) -> ApiResult<InferenceProviderResponseDto> {
	let body = body.into_inner();
	let mut vault = store.store.lock().unwrap();
	let provider = vault
		.update(
			id,
			UpdateProviderInput {
				name: body.name,
				r#type: body.r#type.map(Into::into),
				base: body.base,
				key: body.key,
				clear_key: body.clear_key,
			},
		)
		.map_err(provider_store_error)?;
	Ok(Json(provider.into()))
}

#[delete("/inference/providers/managed/<id>")]
pub fn delete_managed_provider(
	id: &str,
	store: &rocket::State<InferenceProviderStoreState>,
) -> ApiNoContent {
	let mut vault = store.store.lock().unwrap();
	vault.delete(id).map_err(provider_store_error)?;
	Ok(rocket::response::status::NoContent)
}

#[get("/inference/providers/opencode")]
pub fn list_opencode_providers() -> ApiResult<Vec<InferenceCredentialDto>> {
	let manager =
		ConfigManager::new(create_adapter(AgentType::OpenCode), true, None);
	let credentials = manager.import_credentials().map_err(ApiError::from)?;
	let items = credentials.into_iter().map(Into::into).collect();
	Ok(Json(items))
}

#[post("/inference/providers/transfer/opencode-to-codex")]
pub fn transfer_opencode_to_codex_route(
) -> ApiResult<ProviderTransferResponseDto> {
	let result =
		transfer_opencode_providers_to_codex().map_err(ApiError::from)?;
	Ok(Json(result.into()))
}
