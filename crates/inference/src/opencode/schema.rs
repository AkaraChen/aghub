//! OpenCode JSON schema fragments used by the provider adapter.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub(super) struct OpenCodeConfig {
	#[serde(rename = "$schema", skip_serializing_if = "Option::is_none")]
	pub schema: Option<String>,
	#[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
	pub provider: BTreeMap<String, OpenCodeProviderConfig>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub model: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub small_model: Option<String>,
	#[serde(flatten)]
	pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub(super) struct OpenCodeProviderConfig {
	#[serde(skip_serializing_if = "Option::is_none")]
	pub npm: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub name: Option<String>,
	#[serde(default, skip_serializing_if = "is_json_map_empty")]
	pub options: Map<String, Value>,
	#[serde(default, skip_serializing_if = "is_model_map_empty")]
	pub models: BTreeMap<String, OpenCodeModelConfig>,
	#[serde(flatten)]
	pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub(super) struct OpenCodeModelConfig {
	#[serde(skip_serializing_if = "Option::is_none")]
	pub id: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub name: Option<String>,
	#[serde(default, skip_serializing_if = "is_json_map_empty")]
	pub options: Map<String, Value>,
	#[serde(flatten)]
	pub extra: Map<String, Value>,
}

fn is_json_map_empty(map: &Map<String, Value>) -> bool {
	map.is_empty()
}

fn is_model_map_empty(map: &BTreeMap<String, OpenCodeModelConfig>) -> bool {
	map.is_empty()
}
