use aghub_core::{errors::ConfigError, load_all_agents, models::SubAgent, transfer};
use rocket::http::Status;
use rocket::response::status::NoContent;
use rocket::serde::json::Json;

use crate::{
	dto::sub_agent::{
		CreateSubAgentRequest, SubAgentResponse, UpdateSubAgentRequest,
	},
	dto::transfer::{
		OperationBatchResponse, ReconcileRequest, TransferRequest,
	},
	error::{ApiCreated, ApiError, ApiNoContent, ApiResult},
	extractors::{AgentParam, ScopeParams},
	routes::{
		build_manager_from_resolved, require_writable_scope,
		resolved_to_resource_scope,
	},
};

fn check_sub_agent_supported(
	agent: &AgentParam,
	scope: aghub_core::models::ResourceScope,
) -> Result<(), ApiError> {
	let descriptor = aghub_core::registry::get(agent.0);
	if !descriptor.supports_sub_agent_scope(scope) {
		return Err(ApiError::new(
			Status::UnprocessableEntity,
			format!(
				"Agent '{}' does not support sub-agents in {:?} scope",
				descriptor.id, scope
			),
			"UNSUPPORTED_OPERATION",
		));
	}
	Ok(())
}

#[post("/sub-agents/transfer", data = "<body>")]
pub fn transfer_sub_agent_route(
	body: Json<TransferRequest>,
) -> ApiResult<OperationBatchResponse> {
	let req = body.into_inner();
	let source = req.source.to_core()?;
	let destinations = req
		.destinations
		.iter()
		.map(|target| target.to_core())
		.collect::<Result<Vec<_>, _>>()?;
	let result = transfer::transfer_sub_agent(source, destinations)
		.map_err(ApiError::from)?;
	Ok(Json(result.into()))
}

#[post("/sub-agents/reconcile", data = "<body>")]
pub fn reconcile_sub_agent_route(
	body: Json<ReconcileRequest>,
) -> ApiResult<OperationBatchResponse> {
	let req = body.into_inner();
	let source = req.source.to_core()?;

	let added: Vec<_> = req
		.added
		.unwrap_or_default()
		.iter()
		.map(|agent_str| {
			agent_str.parse().map_err(|_| {
				ApiError::new(
					rocket::http::Status::BadRequest,
					format!("Unknown agent '{agent_str}'"),
					"INVALID_PARAM",
				)
			})
		})
		.collect::<Result<Vec<_>, _>>()?;

	let removed: Vec<_> = req
		.removed
		.unwrap_or_default()
		.iter()
		.map(|agent_str| {
			agent_str.parse().map_err(|_| {
				ApiError::new(
					rocket::http::Status::BadRequest,
					format!("Unknown agent '{agent_str}'"),
					"INVALID_PARAM",
				)
			})
		})
		.collect::<Result<Vec<_>, _>>()?;

	let result = transfer::reconcile_sub_agent(source, added, removed)
		.map_err(ApiError::from)?;
	Ok(Json(result.into()))
}

#[get("/agents/<agent>/sub-agents?<scope..>")]
pub fn list_sub_agents(
	agent: AgentParam,
	scope: ScopeParams,
) -> ApiResult<Vec<SubAgentResponse>> {
	let resolved = scope.resolve()?;
	let (resource_scope, _) = resolved_to_resource_scope(&resolved);
	check_sub_agent_supported(&agent, resource_scope)?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;

	if resolved.is_all() {
		let (_, _, sub_agents) =
			manager.load_both_annotated().map_err(ApiError::from)?;
		let items = sub_agents.iter().map(SubAgentResponse::from).collect();
		return Ok(Json(items));
	}

	let config = manager.load().map_err(ApiError::from)?;
	let items = config
		.sub_agents
		.iter()
		.map(SubAgentResponse::from)
		.collect();
	Ok(Json(items))
}

#[get("/agents/all/sub-agents?<scope..>")]
pub fn list_all_agents_sub_agents(
	scope: ScopeParams,
) -> ApiResult<Vec<SubAgentResponse>> {
	let resolved = scope.resolve()?;
	let (resource_scope, project_root) = resolved_to_resource_scope(&resolved);
	let all = load_all_agents(resource_scope, project_root.as_deref());
	let items = all
		.into_iter()
		.flat_map(|r| {
			r.sub_agents
				.into_iter()
				.map(|a| SubAgentResponse::from((a, r.agent_id)))
				.collect::<Vec<_>>()
		})
		.collect();
	Ok(Json(items))
}

#[get("/agents/<agent>/sub-agents/<name>?<scope..>")]
pub fn get_sub_agent(
	agent: AgentParam,
	name: String,
	scope: ScopeParams,
) -> ApiResult<SubAgentResponse> {
	let resolved = scope.resolve()?;
	let (resource_scope, _) = resolved_to_resource_scope(&resolved);
	check_sub_agent_supported(&agent, resource_scope)?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;

	if resolved.is_all() {
		let (_, _, sub_agents) =
			manager.load_both_annotated().map_err(ApiError::from)?;
		return sub_agents
			.into_iter()
			.find(|a| a.name == name)
			.map(SubAgentResponse::from)
			.map(Json)
			.ok_or_else(|| {
				ApiError::from(ConfigError::resource_not_found(
					"sub_agent",
					&name,
				))
			});
	}

	let config = manager.load().map_err(ApiError::from)?;
	config
		.sub_agents
		.iter()
		.find(|a| a.name == name)
		.map(SubAgentResponse::from)
		.map(Json)
		.ok_or_else(|| {
			ApiError::from(ConfigError::resource_not_found("sub_agent", &name))
		})
}

#[post("/agents/<agent>/sub-agents?<scope..>", data = "<body>")]
pub fn create_sub_agent(
	agent: AgentParam,
	scope: ScopeParams,
	body: Json<CreateSubAgentRequest>,
) -> ApiCreated<SubAgentResponse> {
	let resolved = scope.resolve()?;
	require_writable_scope(&resolved)?;
	let (resource_scope, _) = resolved_to_resource_scope(&resolved);
	check_sub_agent_supported(&agent, resource_scope)?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;
	manager.load().map_err(ApiError::from)?;

	let new_agent = SubAgent::from(body.into_inner());
	let response = SubAgentResponse::from(&new_agent);
	manager.add_sub_agent(new_agent).map_err(ApiError::from)?;
	Ok((Status::Created, Json(response)))
}

#[put("/agents/<agent>/sub-agents/<name>?<scope..>", data = "<body>")]
pub fn update_sub_agent(
	agent: AgentParam,
	name: String,
	scope: ScopeParams,
	body: Json<UpdateSubAgentRequest>,
) -> ApiResult<SubAgentResponse> {
	let resolved = scope.resolve()?;
	require_writable_scope(&resolved)?;
	let (resource_scope, _) = resolved_to_resource_scope(&resolved);
	check_sub_agent_supported(&agent, resource_scope)?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;
	manager.load().map_err(ApiError::from)?;

	let body = body.into_inner();
	// Capture the effective name after the patch so we can look it up
	// after a potential rename (patch.name takes precedence over route name).
	let effective_name = body.name.clone().unwrap_or_else(|| name.clone());
	let patch = body.into();
	manager
		.update_sub_agent(&name, patch)
		.map_err(ApiError::from)?;

	let config = manager.config().unwrap();
	let updated = config
		.sub_agents
		.iter()
		.find(|a| a.name == effective_name)
		.map(SubAgentResponse::from)
		.ok_or_else(|| {
			ApiError::from(ConfigError::resource_not_found(
				"sub_agent",
				&effective_name,
			))
		})?;
	Ok(Json(updated))
}

#[delete("/agents/<agent>/sub-agents/<name>?<scope..>")]
pub fn delete_sub_agent(
	agent: AgentParam,
	name: String,
	scope: ScopeParams,
) -> ApiNoContent {
	let resolved = scope.resolve()?;
	require_writable_scope(&resolved)?;
	let (resource_scope, _) = resolved_to_resource_scope(&resolved);
	check_sub_agent_supported(&agent, resource_scope)?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;
	manager.load().map_err(ApiError::from)?;
	manager.remove_sub_agent(&name).map_err(ApiError::from)?;
	Ok(NoContent)
}
