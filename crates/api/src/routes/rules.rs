use std::path::Path;

use aghub_core::models::ResourceScope;
use aghub_core::rule_versions::RuleVersionStore;
use aghub_core::{registry, rules};
use rocket::http::Status;
use rocket::serde::json::Json;
use rocket::State;

use crate::{
	auth::ApiAuth,
	dto::rule::{
		RuleContentQuery, RuleFileContentResponse, RuleFileResponse,
		RuleVersionResponse, UpdateRuleContentRequest,
	},
	error::{ApiError, ApiResult},
	extractors::{AgentParam, ScopeParams, TrustedLocalOrigin},
	routes::{require_writable_scope, resolved_to_resource_scope},
	state::RuleState,
};

const RULE_PATH_NOT_ALLOWED: &str = "RULE_PATH_NOT_ALLOWED";
const RULE_FILE_CHANGED: &str = "RULE_FILE_CHANGED";

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

	let snapshot = rules::read_rule_file_snapshot(&path).map_err(|err| {
		ApiError::new(
			Status::InternalServerError,
			format!("Failed to read rule file: {err}"),
			"RULE_FILE_READ_FAILED",
		)
	})?;

	Ok(Json(RuleFileContentResponse {
		path: rules::display_path(&path),
		content: snapshot.content,
		exists: snapshot.exists,
		revision: snapshot.revision,
	}))
}

#[get("/rules/versions?<query..>")]
pub fn list_rule_versions(
	_auth: ApiAuth,
	state: &State<RuleState>,
	query: RuleContentQuery,
) -> ApiResult<Vec<RuleVersionResponse>> {
	let resolved = ScopeParams {
		scope: query.scope.clone(),
		project_root: query.project_root.clone(),
	}
	.resolve()?;
	let (scope, project_root) = resolved_to_resource_scope(&resolved);
	let path = rules::expand_tilde(&query.path);
	ensure_rule_path_allowed(&path, scope, project_root.as_deref())?;

	let versions = RuleVersionStore::new(&state.app_data_dir)
		.list(&path)
		.map_err(|error| {
			ApiError::new(
				Status::InternalServerError,
				format!("Failed to read rule versions: {error}"),
				"RULE_VERSION_READ_FAILED",
			)
		})?;
	Ok(Json(
		versions
			.into_iter()
			.map(RuleVersionResponse::from)
			.collect(),
	))
}

#[put("/rules/content", format = "json", data = "<body>")]
pub fn update_rule_content(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<RuleState>,
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
	let current = rules::read_rule_file_snapshot(&path).map_err(|error| {
		ApiError::new(
			Status::InternalServerError,
			format!("Failed to read rule file: {error}"),
			"RULE_FILE_READ_FAILED",
		)
	})?;
	if current.revision != request.expected_revision {
		return Err(ApiError::new(
			Status::Conflict,
			"Rule file changed after it was loaded",
			RULE_FILE_CHANGED,
		));
	}
	if current.content != request.content {
		RuleVersionStore::new(&state.app_data_dir)
			.record(&path, &current)
			.map_err(|error| {
				ApiError::new(
					Status::InternalServerError,
					format!("Failed to record rule version: {error}"),
					"RULE_VERSION_WRITE_FAILED",
				)
			})?;
	}

	let snapshot = rules::write_rule_file_if_unchanged(
		&path,
		&request.content,
		&request.expected_revision,
	)
	.map_err(|error| match error {
		rules::RuleWriteError::Changed => ApiError::new(
			Status::Conflict,
			"Rule file changed after it was loaded",
			RULE_FILE_CHANGED,
		),
		rules::RuleWriteError::Io(error) => ApiError::new(
			Status::InternalServerError,
			format!("Failed to write rule file: {error}"),
			"RULE_FILE_WRITE_FAILED",
		),
	})?;

	Ok(Json(RuleFileContentResponse {
		path: rules::display_path(&path),
		content: snapshot.content,
		exists: snapshot.exists,
		revision: snapshot.revision,
	}))
}
