use aghub_core::{
	errors::ConfigError, load_all_agents, models::McpServer, transfer,
};
use rocket::http::Status;
use rocket::response::status::NoContent;
use rocket::serde::json::Json;

use crate::{
	dto::mcp::{CreateMcpRequest, McpResponse, UpdateMcpRequest},
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

#[get("/agents/<agent>/mcps?<scope..>")]
pub fn list_mcps(
	agent: AgentParam,
	scope: ScopeParams,
) -> ApiResult<Vec<McpResponse>> {
	let resolved = scope.resolve()?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;

	if resolved.is_all() {
		let (_, mcps) =
			manager.load_both_annotated().map_err(ApiError::from)?;
		let items = mcps.iter().map(McpResponse::from).collect();
		return Ok(Json(items));
	}

	let config = manager.load().map_err(ApiError::from)?;
	let mcps = config.mcps.iter().map(McpResponse::from).collect();
	Ok(Json(mcps))
}

#[post("/mcps/transfer", data = "<body>")]
pub fn transfer_mcp_route(
	body: Json<TransferRequest>,
) -> ApiResult<OperationBatchResponse> {
	let req = body.into_inner();
	let source = req.source.to_core()?;
	let destinations = req
		.destinations
		.iter()
		.map(|target| target.to_core())
		.collect::<Result<Vec<_>, _>>()?;
	let result =
		transfer::transfer_mcp(source, destinations).map_err(ApiError::from)?;
	Ok(Json(result.into()))
}

#[post("/mcps/reconcile", data = "<body>")]
pub fn reconcile_mcp_route(
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
					format!("Unknown agent '{}'", agent_str),
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
					format!("Unknown agent '{}'", agent_str),
					"INVALID_PARAM",
				)
			})
		})
		.collect::<Result<Vec<_>, _>>()?;

	let result = transfer::reconcile_mcp(source, added, removed)
		.map_err(ApiError::from)?;
	Ok(Json(result.into()))
}

#[post("/agents/<agent>/mcps?<scope..>", data = "<body>")]
pub fn create_mcp(
	agent: AgentParam,
	scope: ScopeParams,
	body: Json<CreateMcpRequest>,
) -> ApiCreated<McpResponse> {
	let resolved = scope.resolve()?;
	require_writable_scope(&resolved)?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;
	match manager.load() {
		Ok(_) => {}
		Err(ConfigError::NotFound { .. }) => manager.init_empty_config(),
		Err(e) => return Err(ApiError::from(e)),
	}
	let mcp = McpServer::from(body.into_inner());
	let response = McpResponse::from(&mcp);
	manager.add_mcp(mcp).map_err(ApiError::from)?;
	Ok((Status::Created, Json(response)))
}

#[get("/agents/<agent>/mcps/<name>?<scope..>")]
pub fn get_mcp(
	agent: AgentParam,
	name: &str,
	scope: ScopeParams,
) -> ApiResult<McpResponse> {
	let resolved = scope.resolve()?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;

	if resolved.is_all() {
		let (_, mcps) =
			manager.load_both_annotated().map_err(ApiError::from)?;
		let mcp = mcps.iter().find(|m| m.name == name).ok_or_else(|| {
			ApiError::from(ConfigError::resource_not_found("mcp", name))
		})?;
		return Ok(Json(McpResponse::from(mcp)));
	}

	manager.load().map_err(ApiError::from)?;
	let mcp = manager.get_mcp(name).ok_or_else(|| {
		ApiError::from(ConfigError::resource_not_found("mcp", name))
	})?;
	Ok(Json(McpResponse::from(mcp)))
}

#[put("/agents/<agent>/mcps/<name>?<scope..>", data = "<body>")]
pub fn update_mcp(
	agent: AgentParam,
	name: &str,
	scope: ScopeParams,
	body: Json<UpdateMcpRequest>,
) -> ApiResult<McpResponse> {
	let resolved = scope.resolve()?;
	require_writable_scope(&resolved)?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;
	manager.load().map_err(ApiError::from)?;
	let existing = manager
		.get_mcp(name)
		.ok_or_else(|| {
			ApiError::from(ConfigError::resource_not_found("mcp", name))
		})?
		.clone();
	let updated = body.into_inner().apply_to(existing);
	let response = McpResponse::from(&updated);
	manager.update_mcp(name, updated).map_err(ApiError::from)?;
	Ok(Json(response))
}

#[delete("/agents/<agent>/mcps/<name>?<scope..>")]
pub fn delete_mcp(
	agent: AgentParam,
	name: &str,
	scope: ScopeParams,
) -> ApiNoContent {
	let resolved = scope.resolve()?;
	require_writable_scope(&resolved)?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;
	manager.load().map_err(ApiError::from)?;
	manager.remove_mcp(name).map_err(ApiError::from)?;
	Ok(NoContent)
}

#[post("/agents/<agent>/mcps/<name>/enable?<scope..>")]
pub fn enable_mcp(
	agent: AgentParam,
	name: &str,
	scope: ScopeParams,
) -> ApiResult<McpResponse> {
	let resolved = scope.resolve()?;
	require_writable_scope(&resolved)?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;
	manager.load().map_err(ApiError::from)?;
	manager.enable_mcp(name).map_err(ApiError::from)?;
	let mcp = manager.get_mcp(name).expect("mcp present after enable");
	Ok(Json(McpResponse::from(mcp)))
}

#[post("/agents/<agent>/mcps/<name>/disable?<scope..>")]
pub fn disable_mcp(
	agent: AgentParam,
	name: &str,
	scope: ScopeParams,
) -> ApiResult<McpResponse> {
	let resolved = scope.resolve()?;
	require_writable_scope(&resolved)?;
	let mut manager = build_manager_from_resolved(&agent, &resolved)?;
	manager.load().map_err(ApiError::from)?;
	manager.disable_mcp(name).map_err(ApiError::from)?;
	let mcp = manager.get_mcp(name).expect("mcp present after disable");
	Ok(Json(McpResponse::from(mcp)))
}

#[get("/agents/all/mcps?<scope..>")]
pub fn list_all_agents_mcps(scope: ScopeParams) -> ApiResult<Vec<McpResponse>> {
	let resolved = scope.resolve()?;
	let (resource_scope, project_root) = resolved_to_resource_scope(&resolved);
	let items = load_all_agents(resource_scope, project_root.as_deref())
		.into_iter()
		.flat_map(|ar| {
			let id = ar.agent_id;
			ar.mcps.into_iter().map(move |m| McpResponse::from((m, id)))
		})
		.collect();
	Ok(Json(items))
}

#[cfg(test)]
mod tests {
	use super::*;
	use aghub_core::models::AgentType;
	use rocket::serde::json::Json;

	use crate::{
		dto::mcp::{CreateMcpRequest, TransportDto},
		extractors::AgentParam,
	};

	#[test]
	fn test_create_mcp_rejects_pi_agent() {
		let result = create_mcp(
			AgentParam(AgentType::Pi),
			ScopeParams {
				scope: Some("global".to_string()),
				project_root: None,
			},
			Json(CreateMcpRequest {
				name: "pi-mcp".to_string(),
				transport: TransportDto::Stdio {
					command: "echo".to_string(),
					args: vec!["hello".to_string()],
					env: None,
					timeout: None,
				},
				timeout: None,
			}),
		);

		let err = result.expect_err("pi should reject MCP creation");
		assert_eq!(err.status, Status::UnprocessableEntity);
		assert_eq!(err.body.code, "UNSUPPORTED_OPERATION");
		assert!(err.body.error.contains("Cannot add MCP server"));
		assert!(err.body.error.contains("pi"));
	}
}
