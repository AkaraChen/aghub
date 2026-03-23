//! Tests for agent skills path configuration.
//!
//! Ported from xdg-config-paths.test.ts and openclaw-paths.test.ts.

use aghub_core::agents::{amp, cursor, openclaw, opencode};
use std::path::{Path, PathBuf};

// ─── XDG config path tests (xdg-config-paths.test.ts) ───────────────────────

#[test]
fn test_opencode_uses_universal_skills() {
	assert_eq!(
		opencode::DESCRIPTOR.capabilities.universal_skills,
		true,
		"OpenCode should use universal skills path (~/.config/agents/skills)"
	);
}

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
	let path_fn = amp::DESCRIPTOR
		.global_skills_path
		.expect("Amp should have a global_skills_path");
	let path = path_fn();
	let path_str = path.to_string_lossy();
	assert!(
		path_str.contains(".config"),
		"Amp global skills path should use XDG .config dir, got: {}",
		path_str
	);
}

#[test]
fn test_amp_global_skills_not_platform_specific() {
	let path_fn = amp::DESCRIPTOR
		.global_skills_path
		.expect("Amp should have a global_skills_path");
	let path = path_fn();
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
	let path_fn = cursor::DESCRIPTOR
		.global_skills_path
		.expect("Cursor should have a global_skills_path");
	let path = path_fn();
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
	let result = openclaw::get_openclaw_skills_dir(&home, exists);
	assert_eq!(result, home.join(".openclaw/skills"));
}

#[test]
fn test_openclaw_falls_back_to_clawdbot() {
	let home = PathBuf::from("/tmp/home");
	// Only .clawdbot and .moltbot exist
	let exists = |p: &Path| -> bool {
		let s = p.to_string_lossy();
		s.ends_with(".clawdbot") || s.ends_with(".moltbot")
	};
	let result = openclaw::get_openclaw_skills_dir(&home, exists);
	assert_eq!(result, home.join(".clawdbot/skills"));
}

#[test]
fn test_openclaw_falls_back_to_moltbot() {
	let home = PathBuf::from("/tmp/home");
	// Only .moltbot exists
	let exists =
		|p: &Path| -> bool { p.to_string_lossy().ends_with(".moltbot") };
	let result = openclaw::get_openclaw_skills_dir(&home, exists);
	assert_eq!(result, home.join(".moltbot/skills"));
}

#[test]
fn test_openclaw_defaults_to_openclaw_when_none_exist() {
	let home = PathBuf::from("/tmp/home");
	let result = openclaw::get_openclaw_skills_dir(&home, |_| false);
	assert_eq!(result, home.join(".openclaw/skills"));
}

#[test]
fn test_openclaw_skills_enabled() {
	assert_eq!(
		openclaw::DESCRIPTOR.capabilities.skills,
		true,
		"OpenClaw should have skills capability enabled"
	);
}
