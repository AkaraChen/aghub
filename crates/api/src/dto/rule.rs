use aghub_core::rules::{self, RuleFile};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::dto::common::{ConfigSource, ResourceOriginDto};

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct RuleVersionStorageResponse {
	pub file_path: String,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct RuleVersionPreferencesResponse {
	pub enabled: bool,
	pub max_versions_per_file: usize,
	pub min_versions_per_file: usize,
	pub max_supported_versions_per_file: usize,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateRuleVersionPreferencesRequest {
	pub enabled: bool,
	pub max_versions_per_file: usize,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct RuleFileResponse {
	pub agent: String,
	pub path: String,
	pub source: ConfigSource,
	pub exists: bool,
	pub origin: ResourceOriginDto,
}

impl From<RuleFile> for RuleFileResponse {
	fn from(file: RuleFile) -> Self {
		Self {
			agent: file.agent,
			path: rules::display_path(&file.path),
			source: file.source.into(),
			exists: file.exists,
			origin: (&file.origin).into(),
		}
	}
}

#[derive(Debug, Deserialize, TS, rocket::FromForm)]
#[ts(export)]
pub struct RuleContentQuery {
	pub path: String,
	pub scope: Option<String>,
	pub project_root: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct RuleFileContentResponse {
	pub path: String,
	pub content: String,
	pub exists: bool,
	pub revision: String,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct RuleVersionResponse {
	pub content: String,
	pub revision: String,
	pub created_at: u64,
}

impl From<aghub_core::rule_versions::RuleVersion> for RuleVersionResponse {
	fn from(version: aghub_core::rule_versions::RuleVersion) -> Self {
		Self {
			content: version.content,
			revision: version.revision,
			created_at: version.created_at,
		}
	}
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateRuleContentRequest {
	pub path: String,
	pub content: String,
	pub expected_revision: String,
	pub scope: Option<String>,
	pub project_root: Option<String>,
}
