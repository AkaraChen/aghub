use std::path::Path;

use aghub_core::models::ResourceScope;
use aghub_core::rule_versions::{RuleVersionStore, MAX_RULE_VERSIONS_PER_FILE};
use aghub_core::{registry, rules};
use log::warn;
use rocket::http::Status;
use rocket::response::status::NoContent;
use rocket::serde::json::Json;
use rocket::State;

use crate::{
	auth::ApiAuth,
	dto::rule::{
		RuleContentQuery, RuleFileContentResponse, RuleFileResponse,
		RuleVersionResponse, RuleVersionStorageResponse,
		UpdateRuleContentRequest,
	},
	error::{ApiError, ApiNoContent, ApiResult},
	extractors::{AgentParam, ScopeParams, TrustedLocalOrigin},
	routes::{require_writable_scope, resolved_to_resource_scope},
	state::RuleState,
};

const RULE_PATH_NOT_ALLOWED: &str = "RULE_PATH_NOT_ALLOWED";
const RULE_FILE_CHANGED: &str = "RULE_FILE_CHANGED";

fn version_store(state: &State<RuleState>) -> RuleVersionStore {
	RuleVersionStore::new(&state.app_data_dir)
}

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

	let versions = version_store(state).list(&path).map_err(|error| {
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

#[get("/rules/versions/storage")]
pub fn get_rule_version_storage(
	_auth: ApiAuth,
	state: &State<RuleState>,
) -> Json<RuleVersionStorageResponse> {
	Json(RuleVersionStorageResponse {
		file_path: version_store(state)
			.file_path()
			.to_string_lossy()
			.into_owned(),
		max_versions_per_file: MAX_RULE_VERSIONS_PER_FILE,
	})
}

#[delete("/rules/versions")]
pub fn clear_rule_versions(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<RuleState>,
) -> ApiNoContent {
	version_store(state).clear().map_err(|error| {
		ApiError::new(
			Status::InternalServerError,
			format!("Failed to clear rule versions: {error}"),
			"RULE_VERSION_CLEAR_FAILED",
		)
	})?;
	Ok(NoContent)
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
	let outcome = rules::write_rule_file_with_version(
		&path,
		&request.content,
		&request.expected_revision,
		&version_store(state),
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
	if let Some(error) = outcome.version_error {
		warn!(
			"rule saved without recording a version for '{}': {error}",
			rules::display_path(&path)
		);
	}
	let snapshot = outcome.snapshot;

	Ok(Json(RuleFileContentResponse {
		path: rules::display_path(&path),
		content: snapshot.content,
		exists: snapshot.exists,
		revision: snapshot.revision,
	}))
}
