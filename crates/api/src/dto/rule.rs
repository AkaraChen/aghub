use aghub_core::rules::{self, RuleFile};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::dto::common::ConfigSource;

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct RuleFileResponse {
	pub agent: String,
	pub path: String,
	pub source: ConfigSource,
	pub exists: bool,
}

impl From<RuleFile> for RuleFileResponse {
	fn from(file: RuleFile) -> Self {
		Self {
			agent: file.agent,
			path: rules::display_path(&file.path),
			source: file.source.into(),
			exists: file.exists,
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

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateRuleContentRequest {
	pub path: String,
	pub content: String,
	pub expected_revision: String,
	pub scope: Option<String>,
	pub project_root: Option<String>,
}
