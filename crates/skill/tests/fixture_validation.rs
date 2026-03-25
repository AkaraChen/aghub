use skill::{
	write_local_lock, LocalSkillLockEntry, LocalSkillLockFile,
};
use std::path::Path;

/// Test local lock JSON matches TypeScript output
#[test]
fn test_local_lock_json_matches_typescript_simple() {
	let fixture_dir = Path::new("tests/fixtures/local-lock-simple");
	let expected_json =
		std::fs::read_to_string(fixture_dir.join("expected.json")).unwrap();

	let temp_dir = tempfile::TempDir::new().unwrap();

	// Create lock with Rust
	let mut lock = LocalSkillLockFile::new();
	lock.skills.insert(
		"my-skill".to_string(),
		LocalSkillLockEntry {
			source: "npm-package".to_string(),
			source_type: "node_modules".to_string(),
			computed_hash: "abc123".to_string(),
		},
	);
	write_local_lock(&lock, Some(temp_dir.path())).unwrap();

	// Read Rust output
	let rust_json =
		std::fs::read_to_string(temp_dir.path().join("skills-lock.json")).unwrap();

	// Compare JSON structures (ignore whitespace differences)
	let rust_value: serde_json::Value = serde_json::from_str(&rust_json).unwrap();
	let ts_value: serde_json::Value = serde_json::from_str(&expected_json).unwrap();

	assert_eq!(rust_value, ts_value, "JSON mismatch for local-lock-simple");
}

/// Test local lock alphabetical sorting matches TypeScript
#[test]
fn test_local_lock_json_matches_typescript_sorted() {
	let fixture_dir = Path::new("tests/fixtures/local-lock-sorted");
	let expected_json =
		std::fs::read_to_string(fixture_dir.join("expected.json")).unwrap();

	let temp_dir = tempfile::TempDir::new().unwrap();

	// Create lock with Rust (insert in non-sorted order)
	let mut lock = LocalSkillLockFile::new();
	lock.skills.insert(
		"zebra-skill".to_string(),
		LocalSkillLockEntry {
			source: "z".to_string(),
			source_type: "github".to_string(),
			computed_hash: "z".to_string(),
		},
	);
	lock.skills.insert(
		"alpha-skill".to_string(),
		LocalSkillLockEntry {
			source: "a".to_string(),
			source_type: "github".to_string(),
			computed_hash: "a".to_string(),
		},
	);
	write_local_lock(&lock, Some(temp_dir.path())).unwrap();

	let rust_json =
		std::fs::read_to_string(temp_dir.path().join("skills-lock.json")).unwrap();

	let rust_value: serde_json::Value = serde_json::from_str(&rust_json).unwrap();
	let ts_value: serde_json::Value = serde_json::from_str(&expected_json).unwrap();

	assert_eq!(rust_value, ts_value, "JSON mismatch for local-lock-sorted");
}

/// Test that Rust can parse TypeScript-generated local lock JSON
#[test]
fn test_rust_can_parse_typescript_local_lock() {
	let fixture_dir = Path::new("tests/fixtures/local-lock-simple");
	let ts_json =
		std::fs::read_to_string(fixture_dir.join("expected.json")).unwrap();

	// Parse TypeScript JSON with Rust
	let parsed: LocalSkillLockFile = serde_json::from_str(&ts_json).unwrap();

	assert_eq!(parsed.version, 1);
	assert!(parsed.skills.contains_key("my-skill"));
	let entry = parsed.skills.get("my-skill").unwrap();
	assert_eq!(entry.source, "npm-package");
	assert_eq!(entry.source_type, "node_modules");
	assert_eq!(entry.computed_hash, "abc123");
}

/// Test that Rust can parse TypeScript-generated global lock JSON
#[test]
fn test_rust_can_parse_typescript_global_lock() {
	use skill::SkillLockFile;

	let fixture_dir = Path::new("tests/fixtures/global-lock-with-timestamps");
	let ts_json =
		std::fs::read_to_string(fixture_dir.join("expected.json")).unwrap();

	// Parse TypeScript JSON with Rust
	let parsed: SkillLockFile = serde_json::from_str(&ts_json).unwrap();

	assert_eq!(parsed.version, 3);
	assert!(parsed.skills.contains_key("github-skill"));
	let entry = parsed.skills.get("github-skill").unwrap();
	assert_eq!(entry.source, "owner/repo");
	assert_eq!(entry.source_type, "github");
	assert_eq!(entry.source_url, "https://github.com/owner/repo");
	assert_eq!(entry.skill_path, Some("skills/my-skill".to_string()));
	assert_eq!(entry.skill_folder_hash, "def456");
	assert_eq!(entry.installed_at, "2024-01-01T00:00:00.000Z");
	assert_eq!(entry.updated_at, "2024-01-02T00:00:00.000Z");
}