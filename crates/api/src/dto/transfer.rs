use aghub_core::transfer::{
	InstallScope, InstallTarget, OperationAction, OperationBatchResult,
	OperationResult, ResourceLocator,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::error::ApiError;

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InstallScopeDto {
	Global,
	Project,
}

impl From<InstallScopeDto> for InstallScope {
	fn from(value: InstallScopeDto) -> Self {
		match value {
			InstallScopeDto::Global => InstallScope::Global,
			InstallScopeDto::Project => InstallScope::Project,
		}
	}
}

impl From<InstallScope> for InstallScopeDto {
	fn from(value: InstallScope) -> Self {
		match value {
			InstallScope::Global => InstallScopeDto::Global,
			InstallScope::Project => InstallScopeDto::Project,
		}
	}
}

#[derive(Debug, Clone, Deserialize)]
pub struct TargetDto {
	pub agent: String,
	pub scope: InstallScopeDto,
	pub project_root: Option<String>,
}

impl TargetDto {
	pub fn to_core(&self) -> Result<InstallTarget, ApiError> {
		let agent = self.agent.parse().map_err(|_| {
			ApiError::new(
				rocket::http::Status::BadRequest,
				format!("Unknown agent '{}'", self.agent),
				"INVALID_PARAM",
			)
		})?;

		Ok(InstallTarget {
			agent,
			scope: self.scope.into(),
			project_root: self.project_root.as_deref().map(PathBuf::from),
		})
	}
}

#[derive(Debug, Clone, Deserialize)]
pub struct ResourceLocatorDto {
	pub agent: String,
	pub scope: InstallScopeDto,
	pub project_root: Option<String>,
	pub name: String,
}

impl ResourceLocatorDto {
	pub fn to_core(&self) -> Result<ResourceLocator, ApiError> {
		let agent = self.agent.parse().map_err(|_| {
			ApiError::new(
				rocket::http::Status::BadRequest,
				format!("Unknown agent '{}'", self.agent),
				"INVALID_PARAM",
			)
		})?;

		Ok(ResourceLocator {
			agent,
			scope: self.scope.into(),
			project_root: self.project_root.as_deref().map(PathBuf::from),
			name: self.name.clone(),
		})
	}
}

#[derive(Debug, Clone, Deserialize)]
pub struct TransferRequest {
	pub source: ResourceLocatorDto,
	pub destinations: Vec<TargetDto>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReconcileRequest {
	pub source: ResourceLocatorDto,
	pub added: Option<Vec<String>>,
	pub removed: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationActionDto {
	Copy,
	Delete,
}

impl From<OperationAction> for OperationActionDto {
	fn from(value: OperationAction) -> Self {
		match value {
			OperationAction::Copy => OperationActionDto::Copy,
			OperationAction::Delete => OperationActionDto::Delete,
		}
	}
}

#[derive(Debug, Clone, Serialize)]
pub struct OperationResultDto {
	pub agent: String,
	pub scope: InstallScopeDto,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub project_root: Option<String>,
	pub action: OperationActionDto,
	pub success: bool,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
}

impl From<OperationResult> for OperationResultDto {
	fn from(value: OperationResult) -> Self {
		OperationResultDto {
			agent: value.target.agent.as_str().to_string(),
			scope: value.target.scope.into(),
			project_root: value
				.target
				.project_root
				.map(|path| path.to_string_lossy().to_string()),
			action: value.action.into(),
			success: value.success,
			error: value.error,
		}
	}
}

#[derive(Debug, Clone, Serialize)]
pub struct OperationBatchResponse {
	pub success_count: usize,
	pub failed_count: usize,
	pub results: Vec<OperationResultDto>,
}

impl From<OperationBatchResult> for OperationBatchResponse {
	fn from(value: OperationBatchResult) -> Self {
		OperationBatchResponse {
			success_count: value.success_count(),
			failed_count: value.failed_count(),
			results: value.results.into_iter().map(Into::into).collect(),
		}
	}
}
