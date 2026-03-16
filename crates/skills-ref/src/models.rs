//! Data models for Agent Skills.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Properties parsed from a skill's SKILL.md frontmatter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillProperties {
	/// Skill name in kebab-case (required).
	pub name: String,

	/// What the skill does and when the model should use it (required).
	pub description: String,

	/// License for the skill (optional).
	#[serde(skip_serializing_if = "Option::is_none")]
	pub license: Option<String>,

	/// Compatibility information for the skill (optional).
	#[serde(skip_serializing_if = "Option::is_none")]
	pub compatibility: Option<String>,

	/// Tool patterns the skill requires (optional, experimental).
	#[serde(rename = "allowed-tools", skip_serializing_if = "Option::is_none")]
	pub allowed_tools: Option<String>,

	/// Key-value pairs for client-specific properties.
	#[serde(default, skip_serializing_if = "HashMap::is_empty")]
	pub metadata: HashMap<String, String>,
}

impl SkillProperties {
	/// Convert to a JSON value, excluding None and empty values.
	pub fn to_dict(&self) -> serde_json::Value {
		let mut map = serde_json::Map::new();

		map.insert(
			"name".to_string(),
			serde_json::Value::String(self.name.clone()),
		);
		map.insert(
			"description".to_string(),
			serde_json::Value::String(self.description.clone()),
		);

		if let Some(license) = &self.license {
			map.insert(
				"license".to_string(),
				serde_json::Value::String(license.clone()),
			);
		}

		if let Some(compatibility) = &self.compatibility {
			map.insert(
				"compatibility".to_string(),
				serde_json::Value::String(compatibility.clone()),
			);
		}

		if let Some(allowed_tools) = &self.allowed_tools {
			map.insert(
				"allowed-tools".to_string(),
				serde_json::Value::String(allowed_tools.clone()),
			);
		}

		if !self.metadata.is_empty() {
			let metadata_map: serde_json::Map<String, serde_json::Value> = self
				.metadata
				.iter()
				.map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone())))
				.collect();
			map.insert(
				"metadata".to_string(),
				serde_json::Value::Object(metadata_map),
			);
		}

		serde_json::Value::Object(map)
	}
}
