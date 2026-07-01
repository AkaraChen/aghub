use aghub_prompt::PromptStore;
use rocket::http::Status;
use rocket::response::status::NoContent;
use rocket::serde::json::Json;
use rocket::State;

use crate::{
	auth::ApiAuth,
	dto::prompt::{CreatePromptRequest, PromptResponse, UpdatePromptRequest},
	error::{ApiCreated, ApiNoContent, ApiResult},
	extractors::TrustedLocalOrigin,
	state::PromptState,
};

fn store(state: &State<PromptState>) -> PromptStore {
	PromptStore::new(state.app_data_dir.clone())
}

#[get("/prompts")]
pub fn list_prompts(
	_auth: ApiAuth,
	state: &State<PromptState>,
) -> ApiResult<Vec<PromptResponse>> {
	let prompts = store(state).list()?;
	Ok(Json(
		prompts.into_iter().map(PromptResponse::from).collect(),
	))
}

#[get("/prompts/<id>")]
pub fn get_prompt(
	_auth: ApiAuth,
	state: &State<PromptState>,
	id: &str,
) -> ApiResult<PromptResponse> {
	let prompt = store(state).get(id)?;
	Ok(Json(prompt.into()))
}

#[post("/prompts", format = "json", data = "<body>")]
pub fn create_prompt(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<PromptState>,
	body: Json<CreatePromptRequest>,
) -> ApiCreated<PromptResponse> {
	let _guard = lock(state);
	let prompt = store(state).create(body.into_inner().into())?;
	Ok((Status::Created, Json(prompt.into())))
}

#[put("/prompts/<id>", format = "json", data = "<body>")]
pub fn update_prompt(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<PromptState>,
	id: &str,
	body: Json<UpdatePromptRequest>,
) -> ApiResult<PromptResponse> {
	let _guard = lock(state);
	let prompt = store(state).update(id, body.into_inner().into())?;
	Ok(Json(prompt.into()))
}

#[delete("/prompts/<id>")]
pub fn delete_prompt(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<PromptState>,
	id: &str,
) -> ApiNoContent {
	let _guard = lock(state);
	store(state).delete(id)?;
	Ok(NoContent)
}

/// Hold the mutation lock, recovering from a poisoned mutex rather than
/// propagating the panic.
fn lock(state: &State<PromptState>) -> std::sync::MutexGuard<'_, ()> {
	state
		.write_lock
		.lock()
		.unwrap_or_else(|poisoned| poisoned.into_inner())
}
