use super::InstalledPluginInfo;
use anyhow::{Context, Result};
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

		let mut normalized = manifest;
		normalized.normalize();
		Ok(normalized)
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
		manifest.normalize();
		manifest.save(path)
	}

	pub fn save(&self, path: &Path) -> Result<()> {
		if let Some(parent) = path.parent() {
			fs::create_dir_all(parent)?;
		}

		let temp_path = Self::temp_path_for(path);
		let mut normalized = self.clone();
		normalized.normalize();
		fs::write(&temp_path, serde_json::to_string_pretty(&normalized)?)
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

	pub fn installations(
		&self,
		plugin_id: &str,
	) -> Option<&[InstalledPluginInfo]> {
		self.plugins.get(plugin_id).map(Vec::as_slice)
	}

	pub fn upsert_installation(
		&mut self,
		plugin_id: String,
		info: InstalledPluginInfo,
	) -> Option<InstalledPluginInfo> {
		let installations = self.plugins.entry(plugin_id).or_default();
		let replaced = if let Some(index) = installations
			.iter()
			.position(|existing| existing.scope == info.scope)
		{
			Some(std::mem::replace(&mut installations[index], info))
		} else {
			installations.push(info);
			None
		};
		Self::normalize_installations(installations);
		replaced
	}

	pub fn remove_installation(
		&mut self,
		plugin_id: &str,
		scope: &str,
	) -> Option<InstalledPluginInfo> {
		let installations = self.plugins.get_mut(plugin_id)?;
		let removed = installations
			.iter()
			.position(|info| info.scope == scope)
			.map(|index| installations.remove(index));

		if installations.is_empty() {
			self.plugins.remove(plugin_id);
		}

		removed
	}

	pub fn has_install_path_reference(&self, install_path: &str) -> bool {
		self.plugins.values().any(|installations| {
			installations
				.iter()
				.any(|info| info.install_path == install_path)
		})
	}

	fn normalize(&mut self) {
		self.plugins.retain(|_, installations| {
			Self::normalize_installations(installations);
			!installations.is_empty()
		});
	}

	fn normalize_installations(installations: &mut Vec<InstalledPluginInfo>) {
		let mut deduped = HashMap::new();
		for info in installations.drain(..) {
			deduped.insert(info.scope.clone(), info);
		}

		let mut normalized: Vec<_> = deduped.into_values().collect();
		normalized.sort_by(|left, right| {
			Self::scope_rank(&left.scope)
				.cmp(&Self::scope_rank(&right.scope))
				.then_with(|| left.installed_at.cmp(&right.installed_at))
		});
		*installations = normalized;
	}

	fn scope_rank(scope: &str) -> u8 {
		match scope {
			"user" => 0,
			"project" => 1,
			"local" => 2,
			_ => 3,
		}
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

#[cfg(test)]
mod tests {
	use super::{InstalledPluginInfo, InstalledPluginsManifest};
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
			r#"{
				"version":1,
				"plugins":{
					"demo@example":[
						{
							"scope":"user",
							"installPath":"/tmp/demo",
							"version":"1.0.0",
							"installedAt":"2024-01-01T00:00:00Z",
							"lastUpdated":"2024-01-01T00:00:00Z"
						}
					]
				}
			}garbage"#,
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
		fs::write(&manifest_path, r#"{"version":1,"plugins":{}}junk"#).unwrap();

		InstalledPluginsManifest::update(&manifest_path, |manifest| {
			manifest.upsert_installation(
				"fresh@example".to_string(),
				InstalledPluginInfo {
					scope: "user".to_string(),
					install_path: "/tmp/fresh".to_string(),
					version: "1.0.0".to_string(),
					installed_at: "2024-01-01T00:00:00Z".to_string(),
					last_updated: "2024-01-01T00:00:00Z".to_string(),
					git_commit_sha: None,
				},
			);
		})
		.unwrap();

		let rewritten = fs::read_to_string(&manifest_path).unwrap();
		assert!(!rewritten.contains("junk"));
		assert!(rewritten.contains("fresh@example"));

		fs::remove_file(&manifest_path).unwrap();
	}

	#[test]
	fn update_upserts_scope_installations() {
		let manifest_path = make_temp_path("aghub-installed-manifest-upsert");
		fs::write(
			&manifest_path,
			r#"{
				"version": 1,
				"plugins": {
					"demo@example": [
						{
							"scope": "user",
							"installPath": "/tmp/old",
							"version": "1.0.0",
							"installedAt": "2024-01-01T00:00:00Z",
							"lastUpdated": "2024-01-01T00:00:00Z"
						}
					]
				}
			}"#,
		)
		.unwrap();

		InstalledPluginsManifest::update(&manifest_path, |manifest| {
			manifest.upsert_installation(
				"demo@example".to_string(),
				InstalledPluginInfo {
					scope: "user".to_string(),
					install_path: "/tmp/new".to_string(),
					version: "2.0.0".to_string(),
					installed_at: "2024-02-01T00:00:00Z".to_string(),
					last_updated: "2024-02-01T00:00:00Z".to_string(),
					git_commit_sha: Some("abc123".to_string()),
				},
			);
		})
		.unwrap();

		let manifest = InstalledPluginsManifest::load(&manifest_path).unwrap();
		let installations = manifest.installations("demo@example").unwrap();
		assert_eq!(installations.len(), 1);
		assert_eq!(installations[0].install_path, "/tmp/new");
		assert_eq!(installations[0].version, "2.0.0");

		fs::remove_file(&manifest_path).unwrap();
	}

	#[test]
	fn load_deduplicates_scope_entries() {
		let manifest_path = make_temp_path("aghub-installed-manifest-dedup");
		fs::write(
			&manifest_path,
			r#"{
				"version": 1,
				"plugins": {
					"demo@example": [
						{
							"scope": "project",
							"installPath": "/tmp/project",
							"version": "1.0.0",
							"installedAt": "2024-01-01T00:00:00Z",
							"lastUpdated": "2024-01-01T00:00:00Z"
						},
						{
							"scope": "project",
							"installPath": "/tmp/project-new",
							"version": "1.1.0",
							"installedAt": "2024-02-01T00:00:00Z",
							"lastUpdated": "2024-02-01T00:00:00Z"
						},
						{
							"scope": "user",
							"installPath": "/tmp/user",
							"version": "2.0.0",
							"installedAt": "2024-03-01T00:00:00Z",
							"lastUpdated": "2024-03-01T00:00:00Z"
						}
					]
				}
			}"#,
		)
		.unwrap();

		let manifest = InstalledPluginsManifest::load(&manifest_path).unwrap();
		let installations = manifest.installations("demo@example").unwrap();
		assert_eq!(installations.len(), 2);
		assert_eq!(installations[0].scope, "user");
		assert_eq!(installations[1].install_path, "/tmp/project-new");

		fs::remove_file(&manifest_path).unwrap();
	}
}
