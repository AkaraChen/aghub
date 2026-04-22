mod model;
mod operations;

pub use self::model::{LockedPlugin, PluginLockfile, RestoreResult};

#[cfg(test)]
mod tests {
	use super::*;
	use tempfile::tempdir;

	#[test]
	fn test_lockfile_operations() {
		let mut lockfile = PluginLockfile::default();

		let plugin = LockedPlugin {
			id: "test@claude-plugins-official".to_string(),
			name: "Test Plugin".to_string(),
			version: "1.0.0".to_string(),
			commit_sha: Some("abc123".to_string()),
			source: "claude-plugins-official".to_string(),
			resolved: "https://github.com/...".to_string(),
			integrity: Some("sha256-...".to_string()),
			scope: "user".to_string(),
			installed_at: "2024-01-01T00:00:00Z".to_string(),
			dependencies: vec![],
		};
		let plugin_key = PluginLockfile::entry_key(&plugin.id, &plugin.scope);

		lockfile.insert(plugin.clone());
		assert_eq!(lockfile.plugins.len(), 1);
		assert_eq!(lockfile.plugins.get(&plugin_key).unwrap().version, "1.0.0");
	}

	#[test]
	fn test_lockfile_roundtrip_preserves_schema() {
		let temp = tempdir().expect("tempdir");
		let path = temp.path().join("plugin-lock.json");
		let lockfile = PluginLockfile {
			generated_at: "2024-01-01T00:00:00Z".to_string(),
			..PluginLockfile::default()
		};

		lockfile.save_to_path(&path).expect("save lockfile");
		let loaded =
			PluginLockfile::load_from_path(&path).expect("load lockfile");

		assert_eq!(loaded.generated_at, "2024-01-01T00:00:00Z");
		assert!(loaded.plugins.is_empty());
	}

	#[test]
	fn test_lockfile_ignores_unknown_fields() {
		let temp = tempdir().expect("tempdir");
		let path = temp.path().join("plugin-lock.json");

		std::fs::write(
			&path,
			r#"{
  "lockfile_version": 999,
  "generated_at": "2024-01-01T00:00:00Z",
  "plugins": {}
}
"#,
		)
		.expect("write lockfile");

		let loaded =
			PluginLockfile::load_from_path(&path).expect("load lockfile");
		assert_eq!(loaded.generated_at, "2024-01-01T00:00:00Z");
		assert!(loaded.plugins.is_empty());
	}
}
