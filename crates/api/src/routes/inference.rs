use aghub_core::{
	create_adapter, models::AgentType, transfer_opencode_providers_to_codex,
	ConfigManager,
};
use rocket::serde::json::Json;

use crate::{
	dto::inference::{InferenceCredentialDto, ProviderTransferResponseDto},
	error::{ApiError, ApiResult},
};

#[get("/inference/providers/opencode")]
pub fn list_opencode_providers() -> ApiResult<Vec<InferenceCredentialDto>> {
	let manager =
		ConfigManager::new(create_adapter(AgentType::OpenCode), true, None);
	let credentials = manager.import_credientials().map_err(ApiError::from)?;
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
