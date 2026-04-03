use rocket::serde::json::Json;
use rocket::Request;

use crate::error::{ErrorBody, JsonParseError};

#[catch(404)]
pub fn not_found(req: &Request) -> Json<ErrorBody> {
	Json(ErrorBody {
		error: format!("Route '{}' not found", req.uri()),
		code: "NOT_FOUND",
	})
}

#[catch(422)]
pub fn unprocessable_entity(req: &Request) -> Json<ErrorBody> {
	let cached = req.local_cache(|| JsonParseError(None));
	let error = match &cached.0 {
		Some(detail) => {
			format!("Unprocessable entity: {detail}")
		}
		None => {
			"Unprocessable entity — check your request body and parameters"
				.to_string()
		}
	};
	Json(ErrorBody {
		error,
		code: "UNPROCESSABLE_ENTITY",
	})
}

#[catch(500)]
pub fn internal_error(_: &Request) -> Json<ErrorBody> {
	Json(ErrorBody {
		error: "Internal server error".to_string(),
		code: "INTERNAL_SERVER_ERROR",
	})
}

#[catch(default)]
pub fn default_catcher(
	status: rocket::http::Status,
	_: &Request,
) -> Json<ErrorBody> {
	Json(ErrorBody {
		error: format!(
			"{} {}",
			status.code,
			status.reason().unwrap_or("Unknown Error")
		),
		code: "UNKNOWN_ERROR",
	})
}
