use aghub_prompt::PromptStore;
use rocket::http::Status;
use rocket::response::status::NoContent;
use rocket::serde::json::Json;
use rocket::State;

use crate::{
	auth::ApiAuth,
	dto::prompt::{
		CreatePromptRequest, ImportPromptBackupRequest, PromptBackupDto,
		PromptImportResultResponse, PromptResponse, UpdatePromptRequest,
	},
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

#[get("/prompts/backup")]
pub fn export_prompt_backup(
	_auth: ApiAuth,
	state: &State<PromptState>,
) -> ApiResult<PromptBackupDto> {
	let backup = store(state).export_backup()?;
	Ok(Json(backup.into()))
}

#[post("/prompts/backup/import", format = "json", data = "<body>")]
pub fn import_prompt_backup(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<PromptState>,
	body: Json<ImportPromptBackupRequest>,
) -> ApiResult<PromptImportResultResponse> {
	let request = body.into_inner();
	let result = store(state)
		.import_backup(request.backup.into(), request.mode.into())?;
	Ok(Json(result.into()))
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
	store(state).delete(id)?;
	Ok(NoContent)
}
