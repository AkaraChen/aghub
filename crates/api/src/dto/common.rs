use aghub_core::models;
use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum ConfigSource {
	Global,
	Project,
}

impl From<models::ConfigSource> for ConfigSource {
	fn from(value: models::ConfigSource) -> Self {
		match value {
			models::ConfigSource::Global => Self::Global,
			models::ConfigSource::Project => Self::Project,
		}
	}
}
