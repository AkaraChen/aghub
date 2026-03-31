//! Tests for agent skills path configuration.
//!
//! Ported from xdg-config-paths.test.ts and openclaw-paths.test.ts.

use aghub_agents::agents::{amp, cursor, kimi, openclaw, opencode, pi};
use std::path::{Path, PathBuf};

// ─── XDG config path tests (xdg-config-paths.test.ts) ───────────────────────

#[test]
fn test_opencode_global_config_path_not_platform_specific() {
	let path = (opencode::DESCRIPTOR.global_path)();
	let path_str = path.to_string_lossy();
	assert!(
		!path_str.contains("Library"),
		"OpenCode global path should not use ~/Library: {}",
		path_str
	);
	assert!(
		!path_str.contains("AppData"),
		"OpenCode global path should not use AppData: {}",
		path_str
	);
	assert!(
		!path_str.contains("Preferences"),
		"OpenCode global path should not use Preferences: {}",
		path_str
	);
}

#[test]
fn test_amp_global_skills_uses_xdg() {
	let paths_fn = amp::DESCRIPTOR
		.global_skills_paths
		.expect("Amp should have a global_skills_paths");
	let paths = paths_fn();
	let path = paths.first().expect("Should have at least one path");
	let path_str = path.to_string_lossy();
	assert!(
		path_str.contains(".config"),
		"Amp global skills path should use XDG .config dir, got: {}",
		path_str
	);
}

#[test]
fn test_amp_global_skills_not_platform_specific() {
	let paths_fn = amp::DESCRIPTOR
		.global_skills_paths
		.expect("Amp should have a global_skills_paths");
	let paths = paths_fn();
	let path = paths.first().expect("Should have at least one path");
	let path_str = path.to_string_lossy();
	assert!(
		!path_str.contains("Library"),
		"Amp skills path should not use ~/Library: {}",
		path_str
	);
	assert!(
		!path_str.contains("AppData"),
		"Amp skills path should not use AppData: {}",
		path_str
	);
	assert!(
		!path_str.contains("Preferences"),
		"Amp skills path should not use Preferences: {}",
		path_str
	);
}

#[test]
fn test_cursor_global_skills_path() {
	let paths_fn = cursor::DESCRIPTOR
		.global_skills_paths
		.expect("Cursor should have a global_skills_paths");
	let paths = paths_fn();
	let path = paths.first().expect("Should have at least one path");
	assert!(
		path.to_string_lossy().contains(".cursor"),
		"Cursor global skills should be under ~/.cursor, got: {}",
		path.display()
	);
	assert!(
		path.ends_with("skills"),
		"Cursor global skills path should end with 'skills', got: {}",
		path.display()
	);
}

#[test]
fn test_kimi_global_mcp_path() {
	let path = (kimi::DESCRIPTOR.global_path)();
	assert!(
		path.to_string_lossy().contains(".kimi/mcp.json"),
		"Kimi global MCP path should be ~/.kimi/mcp.json, got: {}",
		path.display()
	);
}

#[test]
fn test_pi_global_skills_path_uses_agent_dir() {
	let paths_fn = pi::DESCRIPTOR
		.global_skills_paths
		.expect("Pi should have a global_skills_paths");
	let paths = paths_fn();
	let path = paths.first().expect("Should have at least one path");
	assert!(
		path.to_string_lossy().contains(".pi/agent/skills"),
		"Pi global skills should be under ~/.pi/agent/skills, got: {}",
		path.display()
	);
}

#[test]
fn test_pi_has_no_mcp_capabilities() {
	let descriptor = aghub_core::registry::iter_all()
		.find(|d| d.id == "pi")
		.unwrap();
	assert!(!descriptor.capabilities.mcp_stdio);
	assert!(!descriptor.capabilities.mcp_remote);
}

// ─── OpenClaw fallback path tests (openclaw-paths.test.ts) ──────────────────

#[test]
fn test_openclaw_prefers_openclaw_dir() {
	let home = PathBuf::from("/tmp/home");
	// All three dirs "exist"
	let exists = |p: &Path| -> bool {
		let s = p.to_string_lossy();
		s.ends_with(".openclaw")
			|| s.ends_with(".clawdbot")
			|| s.ends_with(".moltbot")
	};
	let result = openclaw::get_openclaw_skills_dirs(&home, exists);
	assert_eq!(result, vec![home.join(".openclaw/skills")]);
}

#[test]
fn test_openclaw_falls_back_to_clawdbot() {
	let home = PathBuf::from("/tmp/home");
	// Only .clawdbot and .moltbot exist
	let exists = |p: &Path| -> bool {
		let s = p.to_string_lossy();
		s.ends_with(".clawdbot") || s.ends_with(".moltbot")
	};
	let result = openclaw::get_openclaw_skills_dirs(&home, exists);
	assert_eq!(result, vec![home.join(".clawdbot/skills")]);
}

#[test]
fn test_openclaw_falls_back_to_moltbot() {
	let home = PathBuf::from("/tmp/home");
	// Only .moltbot exists
	let exists =
		|p: &Path| -> bool { p.to_string_lossy().ends_with(".moltbot") };
	let result = openclaw::get_openclaw_skills_dirs(&home, exists);
	assert_eq!(result, vec![home.join(".moltbot/skills")]);
}

#[test]
fn test_openclaw_defaults_to_openclaw_when_none_exist() {
	let home = PathBuf::from("/tmp/home");
	let result = openclaw::get_openclaw_skills_dirs(&home, |_| false);
	assert_eq!(result, vec![home.join(".openclaw/skills")]);
}

#[test]
fn test_openclaw_skills_enabled() {
	let descriptor = aghub_core::registry::iter_all()
		.find(|d| d.id == "openclaw")
		.unwrap();
	assert!(
		descriptor.capabilities.skills,
		"OpenClaw should have skills capability enabled"
	);
}

// ─── Regression Tests for Mutation Targeting ────────────────────────────────

#[test]
fn test_opencode_global_creation_persists() {
	// TestConfig Builder sets an override by default, we must CLEAR it
	// to allow real path logic to execute.
	let test =
		aghub_core::testing::TestConfig::new(aghub_core::AgentType::OpenCode)
			.unwrap();
	aghub_core::adapter::set_skills_path_override("opencode", None);

	let mut manager = test.create_manager();
	manager.load().unwrap();

	// Use unique skill name with timestamp to avoid conflicts
	let skill_name = format!(
		"test-skill-opencode-{}",
		std::time::SystemTime::now()
			.duration_since(std::time::UNIX_EPOCH)
			.unwrap()
			.as_millis()
	);
	let mut skill = aghub_core::models::Skill::new(&skill_name);
	skill.description = Some("desc".to_string());

	manager.add_skill(skill).unwrap();

	// Reload and check it persists
	let mut manager2 = test.create_manager();
	manager2.load().unwrap();
	assert!(
		manager2.get_skill(&skill_name).is_some(),
		"Skill should survive reload"
	);
}

#[test]
fn test_source_path_update_targets_original_directory() {
	let test =
		aghub_core::testing::TestConfig::new(aghub_core::AgentType::Codex)
			.unwrap();

	// Create a skill at the overridden skills dir
	test.create_test_skill("codex-skill", Some("original"))
		.unwrap();

	let mut manager = test.create_manager();
	manager.load().unwrap();

	let skill = manager
		.get_skill("codex-skill")
		.expect("Should load skill from test dir");

	// source_path should point to the test skills dir
	let sp = skill.source_path.as_ref().unwrap();
	assert!(
		sp.contains("codex-skill"),
		"source_path should reference the skill directory"
	);

	// Update it
	let mut updated = skill.clone();
	updated.description = Some("updated".to_string());
	manager.update_skill("codex-skill", updated).unwrap();

	// Verify the file was updated in place at the original source_path
	let skill_file = test.skills_dir().join("codex-skill/SKILL.md");
	let content = std::fs::read_to_string(skill_file).unwrap();
	assert!(
		content.contains("description: updated"),
		"Skill should be updated at original source path"
	);
}

#[test]
fn test_rename_skill_migrates_sanitized_directory() {
	let test =
		aghub_core::testing::TestConfig::new(aghub_core::AgentType::Claude)
			.unwrap();

	test.create_test_skill("alpha-skill", Some("original"))
		.unwrap();

	let mut manager = test.create_manager();
	manager.load().unwrap();

	let skill = manager.get_skill("alpha-skill").unwrap().clone();
	let mut renamed = skill;
	renamed.name = "beta-skill".to_string();
	renamed.description = Some("renamed".to_string());
	manager.update_skill("alpha-skill", renamed).unwrap();

	assert!(
		!test.skills_dir().join("alpha-skill").exists(),
		"Old directory should be removed after rename"
	);

	let content =
		std::fs::read_to_string(test.skills_dir().join("beta-skill/SKILL.md"))
			.unwrap();
	assert!(content.contains("beta-skill"));
	assert!(content.contains("renamed"));
}

#[test]
fn test_delete_skill_with_slash_removes_sanitized_directory() {
	let test =
		aghub_core::testing::TestConfig::new(aghub_core::AgentType::Claude)
			.unwrap();

	let skill_dir = test.skills_dir().join("owner-repo");
	std::fs::create_dir_all(&skill_dir).unwrap();
	std::fs::write(
		skill_dir.join("SKILL.md"),
		"---\nname: owner/repo\ndescription: test\n---\n\n# Skill\n",
	)
	.unwrap();

	let mut manager = test.create_manager();
	manager.load().unwrap();

	assert!(
		manager.get_skill("owner/repo").is_some(),
		"Should discover skill with slash in name"
	);

	manager.remove_skill("owner/repo").unwrap();

	assert!(
		!skill_dir.exists(),
		"Sanitized directory should be removed on delete"
	);
}
