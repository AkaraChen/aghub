use aghub_core::models::AgentType;
use aghub_core::paths::find_project_root;
use rocket::data::{Data, FromData, Limits, Outcome};
use rocket::http::Status;
use rocket::request::{FromParam, Request};
use std::path::PathBuf;

use crate::error::ApiError;

pub struct AgentParam(pub AgentType);

impl<'r> FromParam<'r> for AgentParam {
	type Error = String;

	fn from_param(param: &'r str) -> Result<Self, Self::Error> {
		param.parse::<AgentType>().map(AgentParam)
	}
}

pub enum ResolvedScope {
	Global,
	Project { root: PathBuf },
	All { project_root: Option<PathBuf> },
}

impl ResolvedScope {
	pub fn is_all(&self) -> bool {
		matches!(self, ResolvedScope::All { .. })
	}
}

#[derive(rocket::FromForm)]
pub struct ScopeParams {
	pub scope: Option<String>,
	pub project_root: Option<String>,
}

impl ScopeParams {
	pub fn resolve(&self) -> Result<ResolvedScope, ApiError> {
		let scope = self.scope.as_deref().unwrap_or("global");
		match scope {
			"global" => Ok(ResolvedScope::Global),
			"project" => {
				let root = self.project_root.as_deref().ok_or_else(|| {
					ApiError::new(
						Status::BadRequest,
						"project_root is required when scope=project",
						"MISSING_PARAM",
					)
				})?;
				Ok(ResolvedScope::Project {
					root: PathBuf::from(root),
				})
			}
			"all" => {
				let project_root =
					self.project_root.as_deref().map(PathBuf::from).or_else(
						|| {
							std::env::current_dir()
								.ok()
								.and_then(|cwd| find_project_root(&cwd))
						},
					);
				Ok(ResolvedScope::All { project_root })
			}
			other => Err(ApiError::new(
				Status::BadRequest,
				format!(
					"Unknown scope '{other}'. Use 'global', 'project', or 'all'"
				),
				"INVALID_PARAM",
			)),
		}
	}
}

/// Cached JSON parse error stored in request-local cache by [`JsonBody`].
/// The [`crate::routes::catchers::unprocessable_entity`] catcher reads this
/// to include the actual parse failure reason in the error response body.
pub struct JsonParseError(pub Option<String>);

/// A request body extractor for JSON that stores the deserialization error in
/// the request-local cache so the 422 catcher can surface the real message.
pub struct JsonBody<T>(pub T);

impl<T> JsonBody<T> {
	pub fn into_inner(self) -> T {
		self.0
	}
}

impl<T> std::ops::Deref for JsonBody<T> {
	type Target = T;

	fn deref(&self) -> &T {
		&self.0
	}
}

impl<T> std::ops::DerefMut for JsonBody<T> {
	fn deref_mut(&mut self) -> &mut T {
		&mut self.0
	}
}

#[rocket::async_trait]
impl<'r, T: serde::de::DeserializeOwned> FromData<'r> for JsonBody<T> {
	type Error = String;

	async fn from_data(
		req: &'r Request<'_>,
		data: Data<'r>,
	) -> Outcome<'r, Self> {
		let limit = req.limits().get("json").unwrap_or(Limits::JSON);
		let string = match data.open(limit).into_string().await {
			Ok(s) if s.is_complete() => s.into_inner(),
			Ok(_) => {
				let msg =
					"Request body exceeds the allowed size limit".to_string();
				req.local_cache(|| JsonParseError(Some(msg.clone())));
				return Outcome::Error((Status::PayloadTooLarge, msg));
			}
			Err(e) => {
				let msg = format!("Failed to read request body: {e}");
				req.local_cache(|| JsonParseError(Some(msg.clone())));
				return Outcome::Error((Status::InternalServerError, msg));
			}
		};

		match serde_json::from_str::<T>(&string) {
			Ok(v) => {
				req.local_cache(|| JsonParseError(None));
				Outcome::Success(JsonBody(v))
			}
			Err(e) => {
				let msg = e.to_string();
				req.local_cache(|| JsonParseError(Some(msg.clone())));
				Outcome::Error((Status::UnprocessableEntity, msg))
			}
		}
	}
}
