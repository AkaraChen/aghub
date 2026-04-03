use aghub_core::errors::ConfigError;
use rocket::http::{ContentType, Status};
use rocket::response::{self, Responder};
use rocket::serde::json::serde_json;
use serde::Serialize;

#[derive(Serialize)]
pub struct ErrorBody {
	pub error: String,
	pub code: &'static str,
}

pub struct ApiError {
	pub status: Status,
	pub body: ErrorBody,
}

impl ApiError {
	pub fn new(
		status: Status,
		error: impl Into<String>,
		code: &'static str,
	) -> Self {
		Self {
			status,
			body: ErrorBody {
				error: error.into(),
				code,
			},
		}
	}
}

impl From<ConfigError> for ApiError {
	fn from(e: ConfigError) -> Self {
		match e {
			ConfigError::ResourceNotFound {
				resource_type,
				name,
			} => ApiError::new(
				Status::NotFound,
				format!("{resource_type} '{name}' not found"),
				"RESOURCE_NOT_FOUND",
			),
			ConfigError::ResourceExists {
				resource_type,
				name,
			} => ApiError::new(
				Status::Conflict,
				format!("{resource_type} '{name}' already exists"),
				"RESOURCE_EXISTS",
			),
			ConfigError::NotFound { path } => ApiError::new(
				Status::NotFound,
				format!("Config file not found: {}", path.display()),
				"CONFIG_NOT_FOUND",
			),
			ConfigError::UnsupportedOperation(msg) => ApiError::new(
				Status::UnprocessableEntity,
				msg,
				"UNSUPPORTED_OPERATION",
			),
			ConfigError::ValidationFailed(msg) => ApiError::new(
				Status::UnprocessableEntity,
				msg,
				"VALIDATION_FAILED",
			),
			ConfigError::InvalidConfig(msg) => {
				ApiError::new(Status::BadRequest, msg, "INVALID_CONFIG")
			}
			ConfigError::Json(e) => ApiError::new(
				Status::BadRequest,
				e.to_string(),
				"JSON_PARSE_ERROR",
			),
			ConfigError::Io(e) => ApiError::new(
				Status::InternalServerError,
				e.to_string(),
				"IO_ERROR",
			),
		}
	}
}

impl<'r> Responder<'r, 'static> for ApiError {
	fn respond_to(
		self,
		_: &'r rocket::Request<'_>,
	) -> response::Result<'static> {
		let body = serde_json::to_string(&self.body).unwrap_or_else(|_| {
			r#"{"error":"Internal error","code":"INTERNAL_ERROR"}"#.to_string()
		});
		rocket::Response::build()
			.status(self.status)
			.header(ContentType::JSON)
			.sized_body(body.len(), std::io::Cursor::new(body))
			.ok()
	}
}

pub type ApiResult<T> = Result<rocket::serde::json::Json<T>, ApiError>;
pub type ApiCreated<T> =
	Result<(Status, rocket::serde::json::Json<T>), ApiError>;
pub type ApiNoContent = Result<rocket::response::status::NoContent, ApiError>;
