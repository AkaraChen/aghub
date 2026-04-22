use anyhow::Result;
use serde::de::Deserializer;
use serde::{Deserialize, Serialize};

/// Plugin manifest (plugin.json or .claude-plugin/plugin.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
	pub name: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub version: Option<String>,
	#[serde(default)]
	pub description: String,
	#[serde(default)]
	pub author: PluginAuthor,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub homepage: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub repository: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub license: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub keywords: Option<Vec<String>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub logo: Option<String>,
	/// Path to skills directory relative to plugin root
	#[serde(skip_serializing_if = "Option::is_none")]
	pub skills: Option<PluginPathList>,
	/// Path to agents directory relative to plugin root
	#[serde(skip_serializing_if = "Option::is_none")]
	pub agents: Option<PluginPathList>,
	/// Path to commands directory relative to plugin root
	#[serde(skip_serializing_if = "Option::is_none")]
	pub commands: Option<PluginPathList>,
	/// User configuration schema
	#[serde(skip_serializing_if = "Option::is_none")]
	pub user_config: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct PluginAuthor {
	pub name: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub email: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub url: Option<String>,
}

impl PluginAuthor {
	pub fn is_empty(&self) -> bool {
		self.name.trim().is_empty()
			&& self.email.is_none()
			&& self.url.is_none()
	}

	fn from_value(value: serde_json::Value) -> Self {
		match value {
			serde_json::Value::Null => Self::default(),
			serde_json::Value::String(name) => Self {
				name: name.trim().to_string(),
				email: None,
				url: None,
			},
			serde_json::Value::Object(mut map) => Self {
				name: map
					.remove("name")
					.and_then(|value| value.as_str().map(str::to_string))
					.unwrap_or_default(),
				email: map
					.remove("email")
					.and_then(|value| value.as_str().map(str::to_string)),
				url: map
					.remove("url")
					.and_then(|value| value.as_str().map(str::to_string)),
			},
			serde_json::Value::Array(items) => {
				let mut names = Vec::new();
				let mut email = None;
				let mut url = None;

				for item in items {
					let author = Self::from_value(item);
					if !author.name.trim().is_empty() {
						names.push(author.name);
					}
					if email.is_none() {
						email = author.email;
					}
					if url.is_none() {
						url = author.url;
					}
				}

				Self {
					name: names.join(", "),
					email,
					url,
				}
			}
			_ => Self::default(),
		}
	}
}

impl<'de> Deserialize<'de> for PluginAuthor {
	fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
	where
		D: Deserializer<'de>,
	{
		let value = serde_json::Value::deserialize(deserializer)?;
		Ok(Self::from_value(value))
	}
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(transparent)]
pub struct PluginPathList(pub Vec<String>);

impl PluginPathList {
	pub fn iter(&self) -> impl Iterator<Item = &String> {
		self.0.iter()
	}

	pub fn into_vec(self) -> Vec<String> {
		self.0
	}

	fn normalize(paths: Vec<String>) -> Self {
		Self(
			paths
				.into_iter()
				.map(|path| path.trim().to_string())
				.filter(|path| !path.is_empty())
				.collect(),
		)
	}
}

impl<'de> Deserialize<'de> for PluginPathList {
	fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
	where
		D: Deserializer<'de>,
	{
		let value = serde_json::Value::deserialize(deserializer)?;
		let paths = match value {
			serde_json::Value::String(path) => vec![path],
			serde_json::Value::Array(items) => items
				.into_iter()
				.filter_map(|item| item.as_str().map(str::to_string))
				.collect(),
			serde_json::Value::Null => Vec::new(),
			other => {
				return Err(serde::de::Error::custom(format!(
					"invalid plugin path value: {other}"
				)));
			}
		};

		Ok(Self::normalize(paths))
	}
}

#[cfg(test)]
mod tests {
	use super::PluginManifest;

	#[test]
	fn plugin_manifest_accepts_string_author_and_array_paths() {
		let manifest: PluginManifest = serde_json::from_str(
			r#"{
				"name":"demo",
				"description":"test",
				"author":"GLINCKER Team",
				"skills":["./SKILL.md"],
				"commands":["./commands/setup.md"]
			}"#,
		)
		.unwrap();

		assert_eq!(manifest.author.name, "GLINCKER Team");
		assert_eq!(
			manifest.skills.unwrap().into_vec(),
			vec!["./SKILL.md".to_string()]
		);
		assert_eq!(
			manifest.commands.unwrap().into_vec(),
			vec!["./commands/setup.md".to_string()]
		);
	}

	#[test]
	fn plugin_manifest_accepts_missing_author() {
		let manifest: PluginManifest = serde_json::from_str(
			r#"{
				"name":"telegram",
				"description":"Telegram bridge",
				"version":"0.0.4"
			}"#,
		)
		.unwrap();

		assert!(manifest.author.is_empty());
	}
}
