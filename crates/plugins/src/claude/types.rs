//! Claude Code plugin types
//!
//! Data structures for parsing installed_plugins.json

use anyhow::{Context, Result};
use serde::de::Deserializer;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Root structure of installed_plugins.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPluginsManifest {
	pub version: i32,
	/// Plugin ID -> list of installations (different scopes)
	pub plugins: HashMap<String, Vec<InstalledPluginInfo>>,
}

static INSTALLED_MANIFEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

impl InstalledPluginsManifest {
	pub fn load(path: &Path) -> Result<Self> {
		if !path.exists() {
			return Ok(Self::default());
		}

		let content = fs::read_to_string(path).with_context(|| {
			format!(
				"Failed to read installed plugins manifest from {}",
				path.display()
			)
		})?;

		let mut stream =
			serde_json::Deserializer::from_str(&content).into_iter::<Self>();
		let manifest = stream.next().transpose()?.with_context(|| {
			format!(
				"Failed to parse installed plugins manifest from {}",
				path.display()
			)
		})?;

		let trailing = &content[stream.byte_offset()..];
		if !trailing.trim().is_empty() {
			log::warn!(
				"Ignoring trailing data in installed plugins manifest at {}",
				path.display()
			);
		}

		Ok(manifest)
	}

	pub fn update<F>(path: &Path, mutate: F) -> Result<()>
	where
		F: FnOnce(&mut Self),
	{
		let _guard = Self::manifest_lock().lock().map_err(|_| {
			anyhow::anyhow!("Failed to lock installed_plugins.json")
		})?;
		let mut manifest = Self::load(path)?;
		mutate(&mut manifest);
		manifest.save(path)
	}

	pub fn save(&self, path: &Path) -> Result<()> {
		if let Some(parent) = path.parent() {
			fs::create_dir_all(parent)?;
		}

		let temp_path = Self::temp_path_for(path);
		fs::write(&temp_path, serde_json::to_string_pretty(self)?)
			.with_context(|| {
				format!(
					"Failed to write temporary installed plugins manifest to {}",
					temp_path.display()
				)
			})?;
		fs::rename(&temp_path, path).with_context(|| {
			format!(
				"Failed to replace installed plugins manifest at {}",
				path.display()
			)
		})?;

		Ok(())
	}

	fn manifest_lock() -> &'static Mutex<()> {
		INSTALLED_MANIFEST_LOCK.get_or_init(|| Mutex::new(()))
	}

	fn temp_path_for(path: &Path) -> PathBuf {
		let timestamp = SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.map(|duration| duration.as_nanos())
			.unwrap_or(0);
		let file_name = path
			.file_name()
			.and_then(|value| value.to_str())
			.unwrap_or("installed_plugins.json");
		path.with_file_name(format!(
			".{}.{}.{}.tmp",
			file_name,
			std::process::id(),
			timestamp
		))
	}
}

impl Default for InstalledPluginsManifest {
	fn default() -> Self {
		Self {
			version: 1,
			plugins: HashMap::new(),
		}
	}
}

/// Information about an installed plugin
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct InstalledPluginInfo {
	pub scope: String,
	#[serde(rename = "installPath")]
	pub install_path: String,
	pub version: String,
	#[serde(rename = "installedAt")]
	pub installed_at: String,
	#[serde(rename = "lastUpdated")]
	pub last_updated: String,
	#[serde(rename = "gitCommitSha")]
	pub git_commit_sha: Option<String>,
}

impl Default for InstalledPluginInfo {
	fn default() -> Self {
		Self {
			scope: "user".to_string(),
			install_path: String::new(),
			version: "unknown".to_string(),
			installed_at: String::new(),
			last_updated: String::new(),
			git_commit_sha: None,
		}
	}
}

/// Plugin source types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginScope {
	User,
	Project,
}

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

/// Hooks manifest (hooks/hooks.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HooksManifest {
	pub hooks: HashMap<String, Vec<HookDefinition>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookDefinition {
	/// Pattern to match (regex or exact string)
	#[serde(skip_serializing_if = "Option::is_none")]
	pub matcher: Option<String>,
	/// Hooks to execute
	pub hooks: Vec<HookAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookAction {
	/// Hook type: "command", "prompt", "agent", "http"
	#[serde(rename = "type")]
	pub action_type: String,
	/// Command to execute, prompt text, agent name, or URL
	#[serde(skip_serializing_if = "Option::is_none")]
	pub command: Option<String>,
	/// Timeout in seconds
	#[serde(skip_serializing_if = "Option::is_none")]
	pub timeout: Option<u32>,
}

#[cfg(test)]
mod tests {
	use super::{InstalledPluginsManifest, PluginManifest};
	use std::fs;
	use std::path::PathBuf;
	use std::time::{SystemTime, UNIX_EPOCH};

	fn make_temp_path(prefix: &str) -> PathBuf {
		let unique = SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.unwrap()
			.as_nanos();
		std::env::temp_dir().join(format!("{prefix}-{unique}.json"))
	}

	#[test]
	fn load_ignores_trailing_manifest_data() {
		let manifest_path = make_temp_path("aghub-installed-manifest");
		fs::write(
			&manifest_path,
			r#"{"version":1,"plugins":{"demo@example":[]}}garbage"#,
		)
		.unwrap();

		let manifest = InstalledPluginsManifest::load(&manifest_path).unwrap();
		assert_eq!(manifest.version, 1);
		assert!(manifest.plugins.contains_key("demo@example"));

		fs::remove_file(&manifest_path).unwrap();
	}

	#[test]
	fn update_rewrites_corrupted_manifest_cleanly() {
		let manifest_path = make_temp_path("aghub-installed-manifest-update");
		fs::write(
			&manifest_path,
			r#"{"version":1,"plugins":{"demo@example":[]}}junk"#,
		)
		.unwrap();

		InstalledPluginsManifest::update(&manifest_path, |manifest| {
			manifest
				.plugins
				.insert("fresh@example".to_string(), Vec::new());
		})
		.unwrap();

		let rewritten = fs::read_to_string(&manifest_path).unwrap();
		assert!(!rewritten.contains("junk"));
		assert!(rewritten.contains("fresh@example"));

		fs::remove_file(&manifest_path).unwrap();
	}

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

/// MCP Server configuration (.mcp.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpConfig {
	#[serde(rename = "mcpServers")]
	pub mcp_servers: HashMap<String, McpServerConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
	/// Transport type: "stdio", "http", "sse", etc.
	/// Defaults to "stdio" when omitted (common in legacy .mcp.json)
	#[serde(
		rename = "type",
		default = "McpServerConfig::default_transport_type"
	)]
	pub transport_type: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub command: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub args: Option<Vec<String>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub url: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub env: Option<HashMap<String, String>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub headers: Option<HashMap<String, String>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub note: Option<String>,
}

impl McpServerConfig {
	fn default_transport_type() -> String {
		"stdio".to_string()
	}
}
