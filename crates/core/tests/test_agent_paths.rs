//! Tests for agent skills path configuration.
//!
//! Ported from xdg-config-paths.test.ts and openclaw-paths.test.ts.

use aghub_agents::agents::{amp, cursor, kimi, openclaw, opencode, pi};
use std::path::{Path, PathBuf};

fn write_import_skill(dir: &Path, name: &str, body: &str) {
	std::fs::create_dir_all(dir).unwrap();
	std::fs::write(
		dir.join("SKILL.md"),
		format!(
			"---\nname: {name}\ndescription: imported skill\n---\n\n{body}\n"
		),
	)
	.unwrap();
}

fn write_import_resources(dir: &Path) {
	std::fs::create_dir_all(dir.join("scripts")).unwrap();
	std::fs::create_dir_all(dir.join("references")).unwrap();
	std::fs::create_dir_all(dir.join("assets")).unwrap();
	std::fs::write(dir.join("scripts/setup.sh"), "echo setup").unwrap();
	std::fs::write(dir.join("references/guide.md"), "# Guide").unwrap();
	std::fs::write(dir.join("assets/logo.txt"), "logo").unwrap();
}

fn contains_entry_named_with_prefix(root: &Path, prefix: &str) -> bool {
	let Ok(entries) = std::fs::read_dir(root) else {
		return false;
	};
	for entry in entries.flatten() {
		if entry.file_name().to_string_lossy().starts_with(prefix) {
			return true;
		}
		let path = entry.path();
		if entry.file_type().map(|t| t.is_dir()).unwrap_or(false)
			&& contains_entry_named_with_prefix(&path, prefix)
		{
			return true;
		}
	}
	false
}

// ─── XDG config path tests (xdg-config-paths.test.ts) ───────────────────────

#[test]
fn test_opencode_global_config_path_not_platform_specific() {
	let path = opencode::DESCRIPTOR
		.mcp_global_path
		.and_then(|path| path())
		.expect("OpenCode should have a global MCP path");
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
	let paths = amp::DESCRIPTOR.global_skill_read_paths();
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
	let paths = amp::DESCRIPTOR.global_skill_read_paths();
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
	let paths = cursor::DESCRIPTOR.global_skill_read_paths();
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
	let path = kimi::DESCRIPTOR
		.mcp_global_path
		.and_then(|path| path())
		.expect("Kimi should have a global MCP path");
	assert!(
		path.to_string_lossy().contains(".kimi/mcp.json"),
		"Kimi global MCP path should be ~/.kimi/mcp.json, got: {}",
		path.display()
	);
}

#[test]
fn test_pi_global_skills_path_uses_agent_dir() {
	let paths = pi::DESCRIPTOR.global_skill_read_paths();
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
	assert!(!descriptor.capabilities.mcp.stdio);
	assert!(!descriptor.capabilities.mcp.sse);
	assert!(!descriptor.capabilities.mcp.streamable_http);
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
		descriptor.capabilities.skills.scopes.global,
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
fn skill_update_retains_extension_frontmatter() {
	let test =
		aghub_core::testing::TestConfig::new(aghub_core::AgentType::Claude)
			.unwrap();
	let skill_dir = test.skills_dir().join("extension-skill");
	std::fs::create_dir_all(&skill_dir).unwrap();
	std::fs::write(
		skill_dir.join("SKILL.md"),
		"---\nname: extension-skill\ndescription: Before\nlicense: MIT\ncompatibility: macOS\ncustom:\n  owner: akara\n---\nBefore body\n",
	)
	.unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();
	let mut updated = manager.get_skill("extension-skill").unwrap().clone();
	updated.description = Some("After".to_string());

	manager.update_skill("extension-skill", updated).unwrap();

	let content = std::fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
	assert!(content.contains("description: After"));
	assert!(content.contains("license: MIT"));
	assert!(content.contains("compatibility: macOS"));
	assert!(content.contains("owner: akara"));
	assert!(content.contains("Before body"));
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
fn add_skill_rejects_an_existing_sanitized_target() {
	let test =
		aghub_core::testing::TestConfig::new(aghub_core::AgentType::Claude)
			.unwrap();
	let occupied = test.skills_dir().join("skill-name");
	write_import_skill(&occupied, "occupied", "original body");
	let mut manager = test.create_manager();
	manager.load().unwrap();

	let error = manager
		.add_skill(aghub_core::Skill::new("skill@name"))
		.unwrap_err();
	assert!(matches!(
		error,
		aghub_core::ConfigError::ResourceExists { .. }
	));
	let content = std::fs::read_to_string(occupied.join("SKILL.md")).unwrap();
	assert!(content.contains("original body"));
	assert!(content.contains("name: occupied"));
}

#[test]
fn skill_rename_rejects_an_existing_sanitized_target() {
	let test =
		aghub_core::testing::TestConfig::new(aghub_core::AgentType::Claude)
			.unwrap();
	test.create_test_skill("source-skill", Some("source"))
		.unwrap();
	let occupied = test.skills_dir().join("target-name");
	write_import_skill(&occupied, "occupied", "occupied body");
	let mut manager = test.create_manager();
	manager.load().unwrap();
	let mut renamed = manager.get_skill("source-skill").unwrap().clone();
	renamed.name = "target@name".to_string();

	let error = manager.update_skill("source-skill", renamed).unwrap_err();
	assert!(matches!(
		error,
		aghub_core::ConfigError::ResourceExists { .. }
	));
	let source = std::fs::read_to_string(
		test.skills_dir().join("source-skill/SKILL.md"),
	)
	.unwrap();
	assert!(source.contains("name: source-skill"));
	let target = std::fs::read_to_string(occupied.join("SKILL.md")).unwrap();
	assert!(target.contains("occupied body"));
}

#[test]
fn skill_update_waits_for_the_target_transaction() {
	let test =
		aghub_core::testing::TestConfig::new(aghub_core::AgentType::Claude)
			.unwrap();
	test.create_test_skill("locked-skill", Some("original"))
		.unwrap();

	let mut manager = test.create_manager();
	manager.load().unwrap();
	let mut updated = manager.get_skill("locked-skill").unwrap().clone();
	updated.description = Some("updated".to_string());
	let target = test.skills_dir().join("locked-skill");
	let transaction =
		skill::lock::lock_skill_paths([target.as_path()]).unwrap();
	let (started_tx, started_rx) = std::sync::mpsc::channel();
	let (finished_tx, finished_rx) = std::sync::mpsc::channel();
	let skills_dir = test.skills_dir().to_path_buf();
	let config_path = test.config_path().to_path_buf();
	let update = std::thread::spawn(move || {
		aghub_core::adapter::set_skills_path_override(
			"claude",
			Some(skills_dir),
		);
		aghub_core::adapter::set_mcp_path_override("claude", Some(config_path));
		started_tx.send(()).unwrap();
		let result = manager.update_skill("locked-skill", updated);
		finished_tx.send(()).unwrap();
		result
	});

	started_rx.recv().unwrap();
	assert!(
		finished_rx
			.recv_timeout(std::time::Duration::from_millis(100))
			.is_err(),
		"skill update completed while its target transaction was held"
	);
	drop(transaction);
	finished_rx
		.recv_timeout(std::time::Duration::from_secs(5))
		.unwrap();
	update.join().unwrap().unwrap();

	let content = std::fs::read_to_string(target.join("SKILL.md")).unwrap();
	assert!(content.contains("description: updated"));
}

#[test]
fn skill_update_rejects_a_stale_loaded_document() {
	let test =
		aghub_core::testing::TestConfig::new(aghub_core::AgentType::Claude)
			.unwrap();
	test.create_test_skill("stale-skill", Some("original"))
		.unwrap();
	let mut stale_manager = test.create_manager();
	stale_manager.load().unwrap();
	let mut fresh_manager = test.create_manager();
	fresh_manager.load().unwrap();

	let mut fresh = fresh_manager.get_skill("stale-skill").unwrap().clone();
	fresh.content = Some("\nbody written by fresh manager\n".to_string());
	fresh_manager.update_skill("stale-skill", fresh).unwrap();

	let mut stale = stale_manager.get_skill("stale-skill").unwrap().clone();
	stale.description = Some("stale description".to_string());
	let error = stale_manager
		.update_skill("stale-skill", stale)
		.unwrap_err();

	assert!(matches!(
		error,
		aghub_core::ConfigError::ResourceChanged { .. }
	));
	let content =
		std::fs::read_to_string(test.skills_dir().join("stale-skill/SKILL.md"))
			.unwrap();
	assert!(content.contains("body written by fresh manager"));
	assert!(!content.contains("stale description"));
}

#[test]
fn skill_delete_rejects_a_replacement_at_the_loaded_path() {
	let test =
		aghub_core::testing::TestConfig::new(aghub_core::AgentType::Claude)
			.unwrap();
	test.create_test_skill("replaceable", Some("original"))
		.unwrap();
	let mut stale_manager = test.create_manager();
	stale_manager.load().unwrap();
	let mut fresh_manager = test.create_manager();
	fresh_manager.load().unwrap();
	fresh_manager.remove_skill("replaceable").unwrap();
	let replacement = test.skills_dir().join("replaceable");
	write_import_skill(&replacement, "different-skill", "replacement body");

	let error = stale_manager.remove_skill("replaceable").unwrap_err();

	assert!(matches!(
		error,
		aghub_core::ConfigError::ResourceChanged { .. }
	));
	let content =
		std::fs::read_to_string(replacement.join("SKILL.md")).unwrap();
	assert!(content.contains("replacement body"));
}

#[test]
fn skill_mutation_does_not_overwrite_a_newer_mcp_config() {
	let test =
		aghub_core::testing::TestConfig::new(aghub_core::AgentType::Claude)
			.unwrap();
	test.create_test_skill("mcp-race", Some("original"))
		.unwrap();
	let mut stale_manager = test.create_manager();
	stale_manager.load().unwrap();
	let mut fresh_manager = test.create_manager();
	fresh_manager.load().unwrap();
	fresh_manager
		.add_mcp(aghub_core::McpServer::new(
			"late-mcp",
			aghub_core::McpTransport::stdio("node", Vec::new()),
		))
		.unwrap();

	let mut skill = stale_manager.get_skill("mcp-race").unwrap().clone();
	skill.description = Some("updated".to_string());
	stale_manager.update_skill("mcp-race", skill).unwrap();

	let mut reloaded = test.create_manager();
	reloaded.load().unwrap();
	assert!(reloaded.get_mcp("late-mcp").is_some());
}

#[test]
fn skill_create_and_rename_reject_unloadable_names() {
	let test =
		aghub_core::testing::TestConfig::new(aghub_core::AgentType::Claude)
			.unwrap();
	test.create_test_skill("valid-skill", Some("original"))
		.unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();
	let invalid_name = "a".repeat(65);

	let add_error = manager
		.add_skill(aghub_core::Skill::new(&invalid_name))
		.unwrap_err();
	assert!(matches!(
		add_error,
		aghub_core::ConfigError::InvalidConfig(_)
	));
	assert!(!test.skills_dir().join(&invalid_name).exists());

	let mut renamed = manager.get_skill("valid-skill").unwrap().clone();
	renamed.name = invalid_name.clone();
	let rename_error =
		manager.update_skill("valid-skill", renamed).unwrap_err();
	assert!(matches!(
		rename_error,
		aghub_core::ConfigError::InvalidConfig(_)
	));
	assert!(test.skills_dir().join("valid-skill").exists());
	assert!(!test.skills_dir().join(invalid_name).exists());
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

#[test]
fn skill_import_directory_preserves_body_and_resources() {
	let test =
		aghub_core::testing::TestConfig::new(aghub_core::AgentType::Claude)
			.unwrap();
	let source_dir = test.temp_dir().join("source/imported-skill");
	write_import_skill(
		&source_dir,
		"imported-skill",
		"# Real imported instructions",
	);
	write_import_resources(&source_dir);

	let mut manager = test.create_manager();
	manager.load().unwrap();
	let imported = manager.add_skill_from_path(&source_dir).unwrap();

	assert_eq!(imported.name, "imported-skill");
	assert!(imported
		.content
		.as_deref()
		.unwrap()
		.contains("# Real imported instructions"));
	let target_dir = test.skills_dir().join("imported-skill");
	let target_content =
		std::fs::read_to_string(target_dir.join("SKILL.md")).unwrap();
	assert!(target_content.contains("# Real imported instructions"));
	assert!(target_dir.join("scripts/setup.sh").exists());
	assert!(target_dir.join("references/guide.md").exists());
	assert!(target_dir.join("assets/logo.txt").exists());

	let mut reloaded = test.create_manager();
	reloaded.load().unwrap();
	let loaded = reloaded.get_skill("imported-skill").unwrap();
	assert!(loaded.source_path.as_deref().unwrap().contains("SKILL.md"));
	assert_eq!(
		reloaded
			.config()
			.unwrap()
			.skills
			.iter()
			.filter(|skill| skill.name == "imported-skill")
			.count(),
		1
	);
}

#[test]
fn skill_import_snapshot_does_not_reread_changed_source() {
	let test =
		aghub_core::testing::TestConfig::new(aghub_core::AgentType::Claude)
			.unwrap();
	let source_dir = test.temp_dir().join("source/snapshot-skill");
	write_import_skill(&source_dir, "snapshot-skill", "captured body");
	let snapshot =
		aghub_core::SkillImportSnapshot::capture(&source_dir).unwrap();

	write_import_skill(&source_dir, "snapshot-skill", "changed body");
	std::fs::write(source_dir.join("late.txt"), "changed after review")
		.unwrap();

	let mut manager = test.create_manager();
	manager.load().unwrap();
	manager.add_skill_from_snapshot(&snapshot).unwrap();

	let target_dir = test.skills_dir().join("snapshot-skill");
	let target_content =
		std::fs::read_to_string(target_dir.join("SKILL.md")).unwrap();
	assert!(target_content.contains("captured body"));
	assert!(!target_content.contains("changed body"));
	assert!(!target_dir.join("late.txt").exists());
}

#[test]
fn skill_import_commit_failure_rolls_back_the_installed_skill() {
	let test =
		aghub_core::testing::TestConfig::new(aghub_core::AgentType::Claude)
			.unwrap();
	let source_dir = test.temp_dir().join("source/commit-failure");
	write_import_skill(&source_dir, "commit-failure", "reviewed body");
	let snapshot =
		aghub_core::SkillImportSnapshot::capture(&source_dir).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	let error = manager
		.add_skill_from_snapshot_with_commit(&snapshot, |skill, installed| {
			assert_eq!(skill.name, "commit-failure");
			let content =
				std::fs::read_to_string(installed.join("SKILL.md")).unwrap();
			assert!(content.contains("reviewed body"));
			Err("injected commit failure")
		})
		.unwrap_err();
	assert!(matches!(
		error,
		aghub_core::manager::skill::SkillImportCommitError::Commit(
			"injected commit failure"
		)
	));
	assert!(!test.skills_dir().join("commit-failure").exists());

	let mut reloaded = test.create_manager();
	reloaded.load().unwrap();
	assert!(reloaded.get_skill("commit-failure").is_none());
}

#[test]
fn standalone_snapshot_keeps_reviewed_document_and_resources() {
	let test =
		aghub_core::testing::TestConfig::new(aghub_core::AgentType::Claude)
			.unwrap();
	let source_dir = test.temp_dir().join("source/standalone-snapshot");
	std::fs::create_dir_all(source_dir.join("scripts")).unwrap();
	let skill_path = source_dir.join("instructions.md");
	std::fs::write(
		&skill_path,
		"---\nname: standalone-snapshot\ndescription: test\n---\nreviewed body",
	)
	.unwrap();
	std::fs::write(source_dir.join("scripts/setup.sh"), "reviewed script")
		.unwrap();
	std::fs::write(source_dir.join("unrelated.txt"), "not installed").unwrap();
	let snapshot =
		aghub_core::SkillImportSnapshot::capture(&skill_path).unwrap();

	std::fs::write(
		&skill_path,
		"---\nname: standalone-snapshot\ndescription: test\n---\nchanged body",
	)
	.unwrap();
	std::fs::write(source_dir.join("scripts/setup.sh"), "changed script")
		.unwrap();

	let mut manager = test.create_manager();
	manager.load().unwrap();
	manager.add_skill_from_snapshot(&snapshot).unwrap();

	let target_dir = test.skills_dir().join("standalone-snapshot");
	let skill_content =
		std::fs::read_to_string(target_dir.join("SKILL.md")).unwrap();
	let script_content =
		std::fs::read_to_string(target_dir.join("scripts/setup.sh")).unwrap();
	assert!(skill_content.contains("reviewed body"));
	assert!(!skill_content.contains("changed body"));
	assert_eq!(script_content, "reviewed script");
	assert!(!target_dir.join("unrelated.txt").exists());
}

#[test]
fn skill_import_lowercase_skill_md_normalizes_target_source_path() {
	let test =
		aghub_core::testing::TestConfig::new(aghub_core::AgentType::Claude)
			.unwrap();
	let source_dir = test.temp_dir().join("source/lower-skill");
	std::fs::create_dir_all(&source_dir).unwrap();
	std::fs::write(
		source_dir.join("skill.md"),
		"---\nname: lower-skill\ndescription: lower file\n---\n\nbody\n",
	)
	.unwrap();

	let mut manager = test.create_manager();
	manager.load().unwrap();
	manager
		.add_skill_from_path(&source_dir.join("skill.md"))
		.unwrap();

	let target_dir = test.skills_dir().join("lower-skill");
	let target_names = std::fs::read_dir(&target_dir)
		.unwrap()
		.map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
		.collect::<Vec<_>>();
	assert!(target_names.iter().any(|name| name == "SKILL.md"));
	assert!(!target_names.iter().any(|name| name == "skill.md"));

	let mut reloaded = test.create_manager();
	reloaded.load().unwrap();
	let loaded = reloaded.get_skill("lower-skill").unwrap();
	let source_path = PathBuf::from(loaded.source_path.as_ref().unwrap());
	assert_eq!(source_path.file_name().unwrap(), "SKILL.md");
}

#[test]
fn skill_import_ancestor_source_skips_destination_skills_dir() {
	let temp = tempfile::TempDir::new().unwrap();
	let project = temp.path().join("project");
	write_import_skill(
		&project,
		"project-root-skill",
		"# Project root instructions",
	);

	let mut manager = aghub_core::ConfigManager::new(
		aghub_core::create_adapter(aghub_core::AgentType::Claude),
		false,
		Some(&project),
	);
	manager.init_empty_config();
	let imported = manager.add_skill_from_path(&project).unwrap();

	assert_eq!(imported.name, "project-root-skill");
	let target_dir = project.join(".claude/skills/project-root-skill");
	let target_content =
		std::fs::read_to_string(target_dir.join("SKILL.md")).unwrap();
	assert!(target_content.contains("# Project root instructions"));
	assert!(
		!target_dir.join(".claude/skills").exists(),
		"Destination skills dir should not be copied into imported skill"
	);
	assert!(
		!contains_entry_named_with_prefix(&target_dir, ".aghub-import-"),
		"Staging directory should not be copied into imported skill"
	);
}

#[cfg(unix)]
#[test]
fn skill_import_directory_rejects_symlinked_file() {
	let test =
		aghub_core::testing::TestConfig::new(aghub_core::AgentType::Claude)
			.unwrap();
	let source_dir = test.temp_dir().join("source/link-skill");
	write_import_skill(&source_dir, "link-skill", "body");
	std::fs::create_dir_all(source_dir.join("scripts")).unwrap();
	let secret_path = test.temp_dir().join("secret.txt");
	std::fs::write(&secret_path, "secret").unwrap();
	std::os::unix::fs::symlink(
		&secret_path,
		source_dir.join("scripts/leak.txt"),
	)
	.unwrap();

	let mut manager = test.create_manager();
	manager.load().unwrap();
	let error = manager.add_skill_from_path(&source_dir).unwrap_err();

	assert!(matches!(
		error,
		aghub_core::ConfigError::InvalidConfig(message)
			if message.contains("symbolic link")
	));
	assert!(!test.skills_dir().join("link-skill").exists());
}

#[cfg(unix)]
#[test]
fn skill_import_skill_md_rejects_symlinked_resource_dir() {
	let test =
		aghub_core::testing::TestConfig::new(aghub_core::AgentType::Claude)
			.unwrap();
	let source_dir = test.temp_dir().join("source/resource-link-skill");
	write_import_skill(&source_dir, "resource-link-skill", "body");
	let outside_assets = test.temp_dir().join("outside-assets");
	std::fs::create_dir_all(&outside_assets).unwrap();
	std::fs::write(outside_assets.join("secret.txt"), "secret").unwrap();
	std::os::unix::fs::symlink(&outside_assets, source_dir.join("assets"))
		.unwrap();

	let mut manager = test.create_manager();
	manager.load().unwrap();
	let error = manager
		.add_skill_from_path(&source_dir.join("SKILL.md"))
		.unwrap_err();

	assert!(matches!(
		error,
		aghub_core::ConfigError::InvalidConfig(message)
			if message.contains("symlink")
	));
	assert!(!test.skills_dir().join("resource-link-skill").exists());
}

#[test]
fn skill_import_package_preserves_body_and_resources() {
	let test =
		aghub_core::testing::TestConfig::new(aghub_core::AgentType::Claude)
			.unwrap();
	let source_dir = test.temp_dir().join("source/package-skill");
	write_import_skill(
		&source_dir,
		"package-skill",
		"# Packaged imported instructions",
	);
	write_import_resources(&source_dir);
	let package_path = test.temp_dir().join("package-skill.skill");
	skill::package::pack(&source_dir, &package_path).unwrap();

	let mut manager = test.create_manager();
	manager.load().unwrap();
	manager.add_skill_from_path(&package_path).unwrap();

	let target_dir = test.skills_dir().join("package-skill");
	let target_content =
		std::fs::read_to_string(target_dir.join("SKILL.md")).unwrap();
	assert!(target_content.contains("# Packaged imported instructions"));
	assert!(target_dir.join("scripts/setup.sh").exists());
	assert!(target_dir.join("references/guide.md").exists());
	assert!(target_dir.join("assets/logo.txt").exists());
}

#[test]
fn package_snapshot_keeps_reviewed_archive_bytes() {
	let test =
		aghub_core::testing::TestConfig::new(aghub_core::AgentType::Claude)
			.unwrap();
	let source_dir = test.temp_dir().join("source/package-snapshot");
	write_import_skill(&source_dir, "package-snapshot", "reviewed body");
	let package_path = test.temp_dir().join("package-snapshot.skill");
	skill::package::pack(&source_dir, &package_path).unwrap();
	let snapshot =
		aghub_core::SkillImportSnapshot::capture(&package_path).unwrap();

	write_import_skill(&source_dir, "package-snapshot", "changed body");
	skill::package::pack(&source_dir, &package_path).unwrap();

	let mut manager = test.create_manager();
	manager.load().unwrap();
	manager.add_skill_from_snapshot(&snapshot).unwrap();

	let content = std::fs::read_to_string(
		test.skills_dir().join("package-snapshot/SKILL.md"),
	)
	.unwrap();
	assert!(content.contains("reviewed body"));
	assert!(!content.contains("changed body"));
}

#[test]
fn skill_import_package_rejects_duplicate_same_name_roots() {
	let test =
		aghub_core::testing::TestConfig::new(aghub_core::AgentType::Claude)
			.unwrap();
	let source_dir = test.temp_dir().join("source/duplicate-package");
	write_import_skill(&source_dir, "duplicate-package", "# Root");
	write_import_skill(
		&source_dir.join("nested"),
		"duplicate-package",
		"# Nested",
	);
	let package_path = test.temp_dir().join("duplicate-package.skill");
	skill::package::pack(&source_dir, &package_path).unwrap();

	let mut manager = test.create_manager();
	manager.load().unwrap();
	let error = manager.add_skill_from_path(&package_path).unwrap_err();

	assert!(matches!(
		error,
		aghub_core::ConfigError::InvalidConfig(message)
			if message.contains("multiple roots")
	));
	assert!(!test.skills_dir().join("duplicate-package").exists());
}

#[test]
fn skill_import_rejects_sanitized_target_collision() {
	let test =
		aghub_core::testing::TestConfig::new(aghub_core::AgentType::Claude)
			.unwrap();
	let existing_dir = test.skills_dir().join("owner-repo");
	write_import_skill(&existing_dir, "existing", "existing body");
	let source_dir = test.temp_dir().join("source/owner-repo");
	write_import_skill(&source_dir, "owner/repo", "new body");

	let mut manager = test.create_manager();
	manager.load().unwrap();
	let error = manager.add_skill_from_path(&source_dir).unwrap_err();

	assert!(matches!(
		error,
		aghub_core::ConfigError::ResourceExists { .. }
	));
	let target_content =
		std::fs::read_to_string(existing_dir.join("SKILL.md")).unwrap();
	assert!(target_content.contains("existing body"));
	assert!(!target_content.contains("new body"));
}
