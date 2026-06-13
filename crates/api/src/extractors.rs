use aghub_core::models::AgentType;
use aghub_core::paths::find_project_root;
use rocket::http::Status;
use rocket::request::FromParam;
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

pub struct TrustedLocalOrigin;

fn origin_host(origin: &str) -> Option<(&str, &str)> {
	let origin = origin.trim();
	let (scheme, rest) = origin.split_once("://")?;
	let authority = rest.split('/').next()?;
	let host = if let Some(rest) = authority.strip_prefix('[') {
		rest.split_once(']')?.0
	} else {
		authority.split(':').next()?
	};

	Some((scheme, host))
}

fn is_trusted_local_origin(origin: &str) -> bool {
	let Some((scheme, host)) = origin_host(origin) else {
		return false;
	};
	let scheme = scheme.to_ascii_lowercase();
	let host = host.to_ascii_lowercase();

	matches!(scheme.as_str(), "http" | "https" | "tauri")
		&& matches!(
			host.as_str(),
			"localhost" | "127.0.0.1" | "::1" | "tauri.localhost"
		)
}

#[rocket::async_trait]
impl<'r> rocket::request::FromRequest<'r> for TrustedLocalOrigin {
	type Error = ();

	async fn from_request(
		request: &'r rocket::Request<'_>,
	) -> rocket::request::Outcome<Self, Self::Error> {
		match request.headers().get_one("Origin") {
			Some(origin) if !is_trusted_local_origin(origin) => {
				rocket::request::Outcome::Error((Status::Forbidden, ()))
			}
			_ => rocket::request::Outcome::Success(Self),
		}
	}
}

#[cfg(test)]
mod tests {
	use super::is_trusted_local_origin;

	#[test]
	fn recognizes_trusted_desktop_origins() {
		assert!(is_trusted_local_origin("http://localhost:1420"));
		assert!(is_trusted_local_origin("https://127.0.0.1:8000"));
		assert!(is_trusted_local_origin("tauri://localhost"));
		assert!(is_trusted_local_origin("http://tauri.localhost"));
	}

	#[test]
	fn rejects_remote_browser_origins() {
		assert!(!is_trusted_local_origin("https://evil.example"));
		assert!(!is_trusted_local_origin("null"));
		assert!(!is_trusted_local_origin("https://localhost.evil.example"));
	}
}
