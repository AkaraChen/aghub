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
