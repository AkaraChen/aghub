use aghub_workspace::file_ops::{self, FileError};
use aghub_workspace::scanner::{self, ScanError};
use rocket::http::Status;
use rocket::serde::json::Json;
use serde::Deserialize;

use crate::error::{ApiError, ApiResult};
use crate::extractors::AgentParam;

impl From<ScanError> for ApiError {
	fn from(e: ScanError) -> Self {
		match &e {
			ScanError::UnknownAgent(_) => ApiError::new(
				Status::BadRequest,
				e.to_string(),
				"UNKNOWN_AGENT",
			),
			ScanError::NoGlobalDir(_) => {
				ApiError::new(Status::NotFound, e.to_string(), "NO_GLOBAL_DIR")
			}
			ScanError::RootNotFound(_) => {
				ApiError::new(Status::NotFound, e.to_string(), "ROOT_NOT_FOUND")
			}
			ScanError::Io(_, _) => ApiError::new(
				Status::InternalServerError,
				e.to_string(),
				"IO_ERROR",
			),
		}
	}
}

impl From<FileError> for ApiError {
	fn from(e: FileError) -> Self {
		match &e {
			FileError::NotFound(_) => {
				ApiError::new(Status::NotFound, e.to_string(), "FILE_NOT_FOUND")
			}
			FileError::IsDirectory(_) => {
				ApiError::new(Status::BadRequest, e.to_string(), "IS_DIRECTORY")
			}
			FileError::PathTraversal(_) => ApiError::new(
				Status::Forbidden,
				e.to_string(),
				"PATH_TRAVERSAL",
			),
			FileError::TooLarge(_, _) => ApiError::new(
				Status::BadRequest,
				e.to_string(),
				"FILE_TOO_LARGE",
			),
			FileError::Io(_, _) => ApiError::new(
				Status::InternalServerError,
				e.to_string(),
				"IO_ERROR",
			),
			FileError::Scan(_) => ApiError::new(
				Status::InternalServerError,
				e.to_string(),
				"SCAN_ERROR",
			),
		}
	}
}

#[derive(rocket::FromForm)]
pub struct FilePathQuery {
	pub path: String,
}

#[derive(Deserialize)]
pub struct SaveFileRequest {
	pub content: String,
}

/// List all files in the agent's global config directory.
#[get("/workspace/agents/<agent>/files")]
pub fn list_workspace_files(
	agent: AgentParam,
) -> ApiResult<aghub_workspace::model::AgentWorkspaceResponse> {
	let workspace = scanner::scan_workspace(agent.0.as_str())?;
	Ok(Json(workspace))
}

/// Read a single file from the agent's workspace.
#[get("/workspace/agents/<agent>/file?<query..>")]
pub fn get_workspace_file(
	agent: AgentParam,
	query: FilePathQuery,
) -> ApiResult<aghub_workspace::model::FileContentResponse> {
	let content = file_ops::read_file(agent.0.as_str(), &query.path)?;
	Ok(Json(content))
}

/// Save content to a file in the agent's workspace.
#[put("/workspace/agents/<agent>/file?<query..>", data = "<body>")]
pub fn save_workspace_file(
	agent: AgentParam,
	query: FilePathQuery,
	body: Json<SaveFileRequest>,
) -> ApiResult<aghub_workspace::model::FileContentResponse> {
	let result =
		file_ops::write_file(agent.0.as_str(), &query.path, &body.content)?;
	Ok(Json(result))
}
