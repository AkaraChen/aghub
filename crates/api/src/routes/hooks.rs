use aghub_core::{errors::ConfigError, hooks, models::AgentType};
use rocket::http::Status;
use rocket::response::status::NoContent;
use rocket::serde::json::Json;

use crate::{
	auth::ApiAuth,
	dto::hooks::{CreateHookRequest, HookResponse, UpdateHookRequest},
	error::{ApiCreated, ApiError, ApiNoContent, ApiResult},
	extractors::AgentParam,
};

const SUPPORTED_HOOK_AGENTS: &[AgentType] =
	&[AgentType::Claude, AgentType::Codex];

fn check_hooks_supported(agent: AgentType) -> Result<(), ApiError> {
	if SUPPORTED_HOOK_AGENTS.contains(&agent) {
		return Ok(());
	}

	Err(ApiError::new(
		Status::UnprocessableEntity,
		format!("Agent '{}' does not support global hooks", agent.as_str()),
		"UNSUPPORTED_OPERATION",
	))
}

#[get("/agents/all/hooks")]
pub fn list_all_agents_hooks(_auth: ApiAuth) -> ApiResult<Vec<HookResponse>> {
	let mut items = Vec::new();
	for agent in SUPPORTED_HOOK_AGENTS {
		items.extend(
			hooks::list_hooks(*agent)
				.map_err(ApiError::from)?
				.into_iter()
				.map(HookResponse::from),
		);
	}
	Ok(Json(items))
}

#[get("/agents/<agent>/hooks")]
pub fn list_hooks(
	_auth: ApiAuth,
	agent: AgentParam,
) -> ApiResult<Vec<HookResponse>> {
	check_hooks_supported(agent.0)?;
	let items = hooks::list_hooks(agent.0)
		.map_err(ApiError::from)?
		.into_iter()
		.map(HookResponse::from)
		.collect();
	Ok(Json(items))
}

#[post("/agents/<agent>/hooks", data = "<body>")]
pub fn create_hook(
	_auth: ApiAuth,
	agent: AgentParam,
	body: Json<CreateHookRequest>,
) -> ApiCreated<HookResponse> {
	check_hooks_supported(agent.0)?;
	let record = hooks::create_hook(agent.0, body.into_inner().into())
		.map_err(ApiError::from)?;
	Ok((Status::Created, Json(record.into())))
}

#[put("/agents/<agent>/hooks/<id>", data = "<body>")]
pub fn update_hook(
	_auth: ApiAuth,
	agent: AgentParam,
	id: String,
	body: Json<UpdateHookRequest>,
) -> ApiResult<HookResponse> {
	check_hooks_supported(agent.0)?;
	let record = hooks::update_hook(agent.0, &id, body.into_inner().into())
		.map_err(ApiError::from)?;
	Ok(Json(record.into()))
}

#[delete("/agents/<agent>/hooks/<id>")]
pub fn delete_hook(
	_auth: ApiAuth,
	agent: AgentParam,
	id: String,
) -> ApiNoContent {
	check_hooks_supported(agent.0)?;
	hooks::delete_hook(agent.0, &id).map_err(ApiError::from)?;
	Ok(NoContent)
}

#[get("/agents/<agent>/hooks/<id>")]
pub fn get_hook(
	_auth: ApiAuth,
	agent: AgentParam,
	id: String,
) -> ApiResult<HookResponse> {
	check_hooks_supported(agent.0)?;
	hooks::list_hooks(agent.0)
		.map_err(ApiError::from)?
		.into_iter()
		.find(|record| record.id == id)
		.map(HookResponse::from)
		.map(Json)
		.ok_or_else(|| {
			ApiError::from(ConfigError::resource_not_found("hook", id))
		})
}
