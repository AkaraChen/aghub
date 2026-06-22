use std::path::Path;

use aghub_core::models::ResourceScope;
use aghub_core::{registry, rules};
use rocket::http::Status;
use rocket::serde::json::Json;

use crate::{
	auth::ApiAuth,
	dto::rule::{
		RuleContentQuery, RuleFileContentResponse, RuleFileResponse,
		UpdateRuleContentRequest,
	},
	error::{ApiError, ApiResult},
	extractors::{AgentParam, ScopeParams, TrustedLocalOrigin},
	routes::{require_writable_scope, resolved_to_resource_scope},
};

const RULE_PATH_NOT_ALLOWED: &str = "RULE_PATH_NOT_ALLOWED";

/// Reject any path that is not one of the rule files an agent declares for the
/// scope. Keeps reads and writes confined to managed instruction files.
fn ensure_rule_path_allowed(
	path: &Path,
	scope: ResourceScope,
	project_root: Option<&Path>,
) -> Result<(), ApiError> {
	if rules::known_rule_paths(scope, project_root).contains(path) {
		Ok(())
	} else {
		Err(ApiError::new(
			Status::Forbidden,
			format!(
				"Path '{}' is not a managed rule file",
				rules::display_path(path)
			),
			RULE_PATH_NOT_ALLOWED,
		))
	}
}

#[get("/agents/all/rules?<params..>")]
pub fn list_all_rules(
	_auth: ApiAuth,
	params: ScopeParams,
) -> ApiResult<Vec<RuleFileResponse>> {
	let resolved = params.resolve()?;
	let (scope, project_root) = resolved_to_resource_scope(&resolved);
	let files = rules::list_all_rule_files(scope, project_root.as_deref());
	Ok(Json(
		files.into_iter().map(RuleFileResponse::from).collect(),
	))
}

#[get("/agents/<agent>/rules?<scope..>")]
pub fn list_rules(
	_auth: ApiAuth,
	agent: AgentParam,
	scope: ScopeParams,
) -> ApiResult<Vec<RuleFileResponse>> {
	let resolved = scope.resolve()?;
	let (resource_scope, project_root) = resolved_to_resource_scope(&resolved);
	let descriptor = registry::get(agent.0);
	let files = rules::list_rule_files(
		descriptor,
		resource_scope,
		project_root.as_deref(),
	);
	Ok(Json(
		files.into_iter().map(RuleFileResponse::from).collect(),
	))
}

#[get("/rules/content?<query..>")]
pub fn get_rule_content(
	_auth: ApiAuth,
	query: RuleContentQuery,
) -> ApiResult<RuleFileContentResponse> {
	let resolved = ScopeParams {
		scope: query.scope.clone(),
		project_root: query.project_root.clone(),
	}
	.resolve()?;
	let (scope, project_root) = resolved_to_resource_scope(&resolved);

	let path = rules::expand_tilde(&query.path);
	ensure_rule_path_allowed(&path, scope, project_root.as_deref())?;

	let content = rules::read_rule_file(&path).map_err(|err| {
		ApiError::new(
			Status::InternalServerError,
			format!("Failed to read rule file: {err}"),
			"RULE_FILE_READ_FAILED",
		)
	})?;

	Ok(Json(RuleFileContentResponse {
		path: rules::display_path(&path),
		exists: path.is_file(),
		content,
	}))
}

#[put("/rules/content", format = "json", data = "<body>")]
pub fn update_rule_content(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	body: Json<UpdateRuleContentRequest>,
) -> ApiResult<RuleFileContentResponse> {
	let request = body.into_inner();
	let resolved = ScopeParams {
		scope: request.scope.clone(),
		project_root: request.project_root.clone(),
	}
	.resolve()?;
	require_writable_scope(&resolved)?;
	let (scope, project_root) = resolved_to_resource_scope(&resolved);

	let path = rules::expand_tilde(&request.path);
	ensure_rule_path_allowed(&path, scope, project_root.as_deref())?;

	rules::write_rule_file(&path, &request.content).map_err(|err| {
		ApiError::new(
			Status::InternalServerError,
			format!("Failed to write rule file: {err}"),
			"RULE_FILE_WRITE_FAILED",
		)
	})?;

	Ok(Json(RuleFileContentResponse {
		path: rules::display_path(&path),
		exists: true,
		content: request.content,
	}))
}
