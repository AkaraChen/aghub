//! Agent descriptor regression tests.
//!
//! These tests hard-code the expected behavior from main branch to prevent
//! regression when refactoring agent descriptor files.
//!
//! Expected values are extracted from main branch actual descriptor definitions.

use aghub_agents::{AgentDescriptor, AgentType};
use std::path::PathBuf;

/// Helper to get home directory for path assertions
fn home() -> PathBuf {
	dirs::home_dir().expect("home dir should exist")
}

/// Get all descriptors from the registry
fn all_descriptors() -> Vec<(AgentType, &'static AgentDescriptor)> {
	use aghub_agents::agents;
	vec![
		(AgentType::Claude, &agents::claude::DESCRIPTOR),
		(AgentType::Codex, &agents::codex::DESCRIPTOR),
		(AgentType::Openclaw, &agents::openclaw::DESCRIPTOR),
		(AgentType::OpenCode, &agents::opencode::DESCRIPTOR),
		(AgentType::Gemini, &agents::gemini::DESCRIPTOR),
		(AgentType::Cline, &agents::cline::DESCRIPTOR),
		(AgentType::Copilot, &agents::copilot::DESCRIPTOR),
		(AgentType::Cursor, &agents::cursor::DESCRIPTOR),
		(AgentType::Antigravity, &agents::antigravity::DESCRIPTOR),
		(AgentType::Kiro, &agents::kiro::DESCRIPTOR),
		(AgentType::Windsurf, &agents::windsurf::DESCRIPTOR),
		(AgentType::Trae, &agents::trae::DESCRIPTOR),
		(AgentType::Zed, &agents::zed::DESCRIPTOR),
		(AgentType::JetBrainsAi, &agents::jetbrains_ai::DESCRIPTOR),
		(AgentType::RooCode, &agents::roocode::DESCRIPTOR),
		(AgentType::Kimi, &agents::kimi::DESCRIPTOR),
		(AgentType::Mistral, &agents::mistral::DESCRIPTOR),
		(AgentType::Pi, &agents::pi::DESCRIPTOR),
		(AgentType::AugmentCode, &agents::augmentcode::DESCRIPTOR),
		(AgentType::KiloCode, &agents::kilocode::DESCRIPTOR),
		(AgentType::Amp, &agents::amp::DESCRIPTOR),
		(AgentType::Warp, &agents::warp::DESCRIPTOR),
	]
}

// =============================================================================
// CLI Name Tests (from main branch actual values)
// =============================================================================

#[test]
fn test_cli_names() {
	// Expected values from main branch descriptor files
	let expected: [(AgentType, &str); 22] = [
		(AgentType::Claude, "claude"),
		(AgentType::Codex, "codex"),
		(AgentType::Openclaw, "openclaw"),
		(AgentType::OpenCode, "opencode"),
		(AgentType::Gemini, "gemini"),
		(AgentType::Cline, "cline"),
		(AgentType::Copilot, "code"),
		(AgentType::Cursor, "cursor"),
		(AgentType::Antigravity, "antigravity"),
		(AgentType::Kiro, "kiro"),
		(AgentType::Windsurf, "windsurf"),
		(AgentType::Trae, "trae"),
		(AgentType::Zed, "zed"),
		(AgentType::JetBrainsAi, "jetbrains"),
		(AgentType::RooCode, "roocode"),
		(AgentType::Kimi, "kimi"),
		(AgentType::Mistral, "mistral"),
		(AgentType::Pi, "pi"),
		(AgentType::AugmentCode, "augmentcode"),
		(AgentType::KiloCode, "kilocode"), // main branch: "kilocode"
		(AgentType::Amp, "amp"),
		(AgentType::Warp, "warp"),
	];

	for (agent_type, desc) in all_descriptors() {
		if let Some((_, name)) = expected.iter().find(|(t, _)| *t == agent_type)
		{
			assert_eq!(
				desc.cli_name, *name,
				"cli_name mismatch for {:?}",
				agent_type
			);
		}
	}
}

// =============================================================================
// Skills CLI Name Tests (from main branch actual values)
// =============================================================================

#[test]
fn test_skills_cli_names() {
	let expected: [(AgentType, Option<&str>); 22] = [
		(AgentType::Claude, Some("claude-code")), // main branch: "claude-code"
		(AgentType::Codex, Some("codex")),
		(AgentType::Openclaw, Some("openclaw")),
		(AgentType::OpenCode, Some("opencode")),
		(AgentType::Gemini, Some("gemini-cli")),
		(AgentType::Cline, Some("cline")),
		(AgentType::Copilot, Some("github-copilot")),
		(AgentType::Cursor, Some("cursor")),
		(AgentType::Antigravity, Some("antigravity")),
		(AgentType::Kiro, Some("kiro-cli")),
		(AgentType::Windsurf, Some("windsurf")),
		(AgentType::Trae, Some("trae")),
		(AgentType::Zed, None),
		(AgentType::JetBrainsAi, None),
		(AgentType::RooCode, Some("roo")),
		(AgentType::Kimi, Some("kimi-cli")),
		(AgentType::Mistral, Some("mistral-vibe")),
		(AgentType::Pi, Some("pi")),
		(AgentType::AugmentCode, Some("augment")),
		(AgentType::KiloCode, Some("kilo")), // main branch: "kilo"
		(AgentType::Amp, Some("amp")),
		(AgentType::Warp, Some("warp")),
	];

	for (agent_type, desc) in all_descriptors() {
		if let Some((_, name)) = expected.iter().find(|(t, _)| *t == agent_type)
		{
			assert_eq!(
				desc.skills_cli_name, *name,
				"skills_cli_name mismatch for {:?}",
				agent_type
			);
		}
	}
}

// =============================================================================
// Display Name Tests (from main branch actual values)
// =============================================================================

#[test]
fn test_display_names() {
	let expected: [(AgentType, &str); 22] = [
		(AgentType::Claude, "Claude Code"), // main branch: "Claude Code"
		(AgentType::Codex, "OpenAI Codex"),
		(AgentType::Openclaw, "OpenClaw"),
		(AgentType::OpenCode, "OpenCode"),
		(AgentType::Gemini, "Gemini CLI"),
		(AgentType::Cline, "Cline"),
		(AgentType::Copilot, "GitHub Copilot"),
		(AgentType::Cursor, "Cursor"),
		(AgentType::Antigravity, "Antigravity"),
		(AgentType::Kiro, "Kiro"),
		(AgentType::Windsurf, "Windsurf"),
		(AgentType::Trae, "Trae"),
		(AgentType::Zed, "Zed"),
		(AgentType::JetBrainsAi, "JetBrains AI"),
		(AgentType::RooCode, "RooCode"),
		(AgentType::Kimi, "Kimi Code CLI"),
		(AgentType::Mistral, "Mistral Le Chat"),
		(AgentType::Pi, "Pi Coding Agent"),
		(AgentType::AugmentCode, "AugmentCode"),
		(AgentType::KiloCode, "KiloCode"),
		(AgentType::Amp, "Amp"),
		(AgentType::Warp, "Warp"),
	];

	for (agent_type, desc) in all_descriptors() {
		if let Some((_, name)) = expected.iter().find(|(t, _)| *t == agent_type)
		{
			assert_eq!(
				desc.display_name, *name,
				"display_name mismatch for {:?}",
				agent_type
			);
		}
	}
}

// =============================================================================
// Project Markers Tests (from main branch actual values)
// =============================================================================

#[test]
fn test_project_markers() {
	let expected: [(AgentType, &[&str]); 22] = [
		(AgentType::Claude, &[".claude", ".mcp.json"]), // main branch has both
		(AgentType::Codex, &[".codex"]),
		(AgentType::Openclaw, &[".openclaw"]),
		(AgentType::OpenCode, &[".opencode"]),
		(AgentType::Gemini, &[".gemini"]),
		(AgentType::Cline, &[".cline"]),
		(AgentType::Copilot, &[".vscode"]),
		(AgentType::Cursor, &[".cursor"]),
		(AgentType::Antigravity, &[".gemini/antigravity"]),
		(AgentType::Kiro, &[".kiro"]),
		(AgentType::Windsurf, &[".windsurf"]),
		(AgentType::Trae, &[".trae"]),
		(AgentType::Zed, &[".zed"]),
		(AgentType::JetBrainsAi, &[".jetbrains-ai"]),
		(AgentType::RooCode, &[".roo"]),
		(AgentType::Kimi, &[".kimi"]),
		(AgentType::Mistral, &[".vibe"]),
		(AgentType::Pi, &[".pi"]),
		(AgentType::AugmentCode, &[".augmentcode"]),
		(AgentType::KiloCode, &[".kilocode"]),
		(AgentType::Amp, &[".amp"]),
		(AgentType::Warp, &[".warp"]),
	];

	for (agent_type, desc) in all_descriptors() {
		if let Some((_, markers)) =
			expected.iter().find(|(t, _)| *t == agent_type)
		{
			assert_eq!(
				desc.project_markers, *markers,
				"project_markers mismatch for {:?}",
				agent_type
			);
		}
	}
}

// =============================================================================
// MCP Global Path Tests (from main branch actual values)
// =============================================================================

#[test]
fn test_mcp_global_paths() {
	let expected: [(AgentType, Option<&str>); 22] = [
		(AgentType::Claude, Some(".claude.json")), // main branch: .claude.json
		(AgentType::Codex, Some(".codex/config.toml")),
		(
			AgentType::Openclaw,
			Some(".openclaw/workspace/config/mcporter.json"),
		),
		(AgentType::OpenCode, Some(".config/opencode/opencode.json")),
		(AgentType::Gemini, Some(".gemini/settings.json")),
		(
			AgentType::Cline,
			Some(".cline/data/settings/cline_mcp_settings.json"),
		),
		(AgentType::Copilot, Some(".vscode/mcp.json")),
		(AgentType::Cursor, Some(".cursor/mcp.json")),
		(
			AgentType::Antigravity,
			Some(".gemini/antigravity/mcp_config.json"),
		),
		(AgentType::Kiro, Some(".kiro/settings/mcp.json")),
		(
			AgentType::Windsurf,
			Some(".codeium/windsurf/mcp_config.json"),
		),
		(AgentType::Trae, Some(".trae/mcp.json")),
		(AgentType::Zed, Some(".config/zed/settings.json")),
		(AgentType::JetBrainsAi, Some(".jetbrains-ai/mcp.json")),
		(AgentType::RooCode, Some(".roo/mcp.json")),
		(AgentType::Kimi, Some(".kimi/mcp.json")),
		(AgentType::Mistral, Some(".vibe/mcp.toml")),
		(AgentType::Pi, None), // Pi has no MCP
		(AgentType::AugmentCode, Some(".augmentcode/mcp.json")),
		(AgentType::KiloCode, Some(".kilocode/mcp.json")),
		(AgentType::Amp, Some(".config/amp/settings.json")),
		(AgentType::Warp, Some(".warp/mcp.json")),
	];

	for (agent_type, desc) in all_descriptors() {
		let expected_path = expected
			.iter()
			.find(|(t, _)| *t == agent_type)
			.map(|(_, p)| *p);

		match expected_path {
			Some(Some(path)) => {
				assert!(
					desc.mcp_global_path.is_some(),
					"mcp_global_path should be Some for {:?}",
					agent_type
				);
				let actual = desc.mcp_global_path.unwrap()();
				assert_eq!(
					actual,
					Some(home().join(path)),
					"mcp_global_path mismatch for {:?}",
					agent_type
				);
			}
			Some(None) => {
				assert!(
					desc.mcp_global_path.is_none(),
					"mcp_global_path should be None for {:?}",
					agent_type
				);
			}
			None => {}
		}
	}
}

// =============================================================================
// MCP Project Path Tests (from main branch actual values)
// =============================================================================

#[test]
fn test_mcp_project_paths() {
	let expected: [(AgentType, Option<&str>); 22] = [
		(AgentType::Claude, Some(".mcp.json")), // main branch: .mcp.json
		(AgentType::Codex, Some(".codex/config.toml")),
		(AgentType::Openclaw, None), // Openclaw has no project MCP path
		(AgentType::OpenCode, Some(".opencode/settings.json")),
		(AgentType::Gemini, Some(".gemini/settings.json")),
		(AgentType::Cline, Some(".cline/mcp.json")),
		(AgentType::Copilot, Some(".vscode/mcp.json")),
		(AgentType::Cursor, Some(".cursor/mcp.json")),
		(
			AgentType::Antigravity,
			Some(".gemini/antigravity/mcp_config.json"),
		),
		(AgentType::Kiro, Some(".kiro/settings/mcp.json")),
		(AgentType::Windsurf, Some(".windsurf/mcp_config.json")),
		(AgentType::Trae, Some(".trae/mcp.json")),
		(AgentType::Zed, Some(".zed/settings.json")),
		(AgentType::JetBrainsAi, Some(".jetbrains-ai/mcp.json")),
		(AgentType::RooCode, Some(".roo/mcp.json")),
		(AgentType::Kimi, Some(".kimi/mcp.json")),
		(AgentType::Mistral, Some(".vibe/mcp.toml")),
		(AgentType::Pi, None), // Pi has no MCP
		(AgentType::AugmentCode, Some(".augmentcode/mcp.json")),
		(AgentType::KiloCode, Some(".kilocode/mcp.json")),
		(AgentType::Amp, Some(".amp/mcp.json")),
		(AgentType::Warp, Some(".warp/mcp.json")),
	];

	let root = PathBuf::from("/project");

	for (agent_type, desc) in all_descriptors() {
		let expected_path = expected
			.iter()
			.find(|(t, _)| *t == agent_type)
			.map(|(_, p)| *p);

		match expected_path {
			Some(Some(path)) => {
				assert!(
					desc.mcp_project_path.is_some(),
					"mcp_project_path should be Some for {:?}",
					agent_type
				);
				let actual = desc.mcp_project_path.unwrap()(&root);
				assert_eq!(
					actual,
					Some(root.join(path)),
					"mcp_project_path mismatch for {:?}",
					agent_type
				);
			}
			Some(None) => {
				assert!(
					desc.mcp_project_path.is_none(),
					"mcp_project_path should be None for {:?}",
					agent_type
				);
			}
			None => {}
		}
	}
}

// =============================================================================
// Global Data Dir Tests (from main branch actual values)
// =============================================================================

#[test]
fn test_global_data_dirs() {
	let expected: [(AgentType, Option<&str>); 22] = [
		(AgentType::Claude, Some(".claude")),
		(AgentType::Codex, Some(".codex")),
		(AgentType::Openclaw, Some(".openclaw")),
		(AgentType::OpenCode, Some(".config/opencode")),
		(AgentType::Gemini, Some(".gemini")),
		(AgentType::Cline, Some(".cline")),
		(AgentType::Copilot, Some(".copilot")),
		(AgentType::Cursor, Some(".cursor")),
		(AgentType::Antigravity, Some(".gemini/antigravity")),
		(AgentType::Kiro, Some(".kiro")),
		(AgentType::Windsurf, Some(".codeium/windsurf")),
		(AgentType::Trae, Some(".trae")),
		(AgentType::Zed, Some(".config/zed")),
		(AgentType::JetBrainsAi, Some(".jetbrains-ai")),
		(AgentType::RooCode, Some(".roo")),
		(AgentType::Kimi, Some(".kimi")),
		(AgentType::Mistral, Some(".vibe")),
		(AgentType::Pi, Some(".pi/agent")),
		(AgentType::AugmentCode, Some(".augmentcode")),
		(AgentType::KiloCode, Some(".kilocode")),
		(AgentType::Amp, Some(".config/amp")),
		(AgentType::Warp, Some(".warp")),
	];

	for (agent_type, desc) in all_descriptors() {
		let expected_dir = expected
			.iter()
			.find(|(t, _)| *t == agent_type)
			.map(|(_, p)| *p);

		match expected_dir {
			Some(Some(path)) => {
				let actual = (desc.global_data_dir)();
				assert_eq!(
					actual,
					Some(home().join(path)),
					"global_data_dir mismatch for {:?}",
					agent_type
				);
			}
			Some(None) => {
				assert_eq!(
					(desc.global_data_dir)(),
					None,
					"global_data_dir should be None for {:?}",
					agent_type
				);
			}
			None => {}
		}
	}
}

// =============================================================================
// MCP Capabilities Tests (from main branch actual values)
// =============================================================================

#[test]
fn test_mcp_capabilities_stdio() {
	let expected: [(AgentType, bool); 22] = [
		(AgentType::Claude, true),
		(AgentType::Codex, true),
		(AgentType::Openclaw, true),
		(AgentType::OpenCode, true),
		(AgentType::Gemini, true),
		(AgentType::Cline, true),
		(AgentType::Copilot, true),
		(AgentType::Cursor, true),
		(AgentType::Antigravity, true),
		(AgentType::Kiro, true),
		(AgentType::Windsurf, true),
		(AgentType::Trae, true),
		(AgentType::Zed, true),
		(AgentType::JetBrainsAi, true),
		(AgentType::RooCode, true),
		(AgentType::Kimi, true),
		(AgentType::Mistral, true),
		(AgentType::Pi, false), // Pi has no MCP
		(AgentType::AugmentCode, true),
		(AgentType::KiloCode, true),
		(AgentType::Amp, true),
		(AgentType::Warp, true),
	];

	for (agent_type, desc) in all_descriptors() {
		if let Some((_, val)) = expected.iter().find(|(t, _)| *t == agent_type)
		{
			assert_eq!(
				desc.capabilities.mcp.stdio, *val,
				"mcp.stdio mismatch for {:?}",
				agent_type
			);
		}
	}
}

#[test]
fn test_mcp_capabilities_remote() {
	let expected: [(AgentType, bool); 22] = [
		(AgentType::Claude, true),
		(AgentType::Codex, false), // Codex doesn't support remote MCP
		(AgentType::Openclaw, true),
		(AgentType::OpenCode, true),
		(AgentType::Gemini, true),
		(AgentType::Cline, true),
		(AgentType::Copilot, true),
		(AgentType::Cursor, true),
		(AgentType::Antigravity, false),
		(AgentType::Kiro, true),
		(AgentType::Windsurf, true),
		(AgentType::Trae, true),
		(AgentType::Zed, true),
		(AgentType::JetBrainsAi, true),
		(AgentType::RooCode, true),
		(AgentType::Kimi, true),
		(AgentType::Mistral, true),
		(AgentType::Pi, false), // Pi has no MCP
		(AgentType::AugmentCode, true),
		(AgentType::KiloCode, true),
		(AgentType::Amp, true),
		(AgentType::Warp, true),
	];

	for (agent_type, desc) in all_descriptors() {
		if let Some((_, val)) = expected.iter().find(|(t, _)| *t == agent_type)
		{
			assert_eq!(
				desc.capabilities.mcp.remote, *val,
				"mcp.remote mismatch for {:?}",
				agent_type
			);
		}
	}
}

#[test]
fn test_mcp_capabilities_scopes_global() {
	let expected: [(AgentType, bool); 22] = [
		(AgentType::Claude, true),
		(AgentType::Codex, true),
		(AgentType::Openclaw, true),
		(AgentType::OpenCode, true),
		(AgentType::Gemini, true),
		(AgentType::Cline, true),
		(AgentType::Copilot, true),
		(AgentType::Cursor, true),
		(AgentType::Antigravity, true),
		(AgentType::Kiro, true),
		(AgentType::Windsurf, true),
		(AgentType::Trae, true),
		(AgentType::Zed, true),
		(AgentType::JetBrainsAi, true),
		(AgentType::RooCode, true),
		(AgentType::Kimi, true),
		(AgentType::Mistral, true),
		(AgentType::Pi, false), // Pi has no MCP
		(AgentType::AugmentCode, true),
		(AgentType::KiloCode, true),
		(AgentType::Amp, true),
		(AgentType::Warp, true),
	];

	for (agent_type, desc) in all_descriptors() {
		if let Some((_, val)) = expected.iter().find(|(t, _)| *t == agent_type)
		{
			assert_eq!(
				desc.capabilities.mcp.scopes.global, *val,
				"mcp.scopes.global mismatch for {:?}",
				agent_type
			);
		}
	}
}

#[test]
fn test_mcp_capabilities_scopes_project() {
	let expected: [(AgentType, bool); 22] = [
		(AgentType::Claude, true),
		(AgentType::Codex, true),
		(AgentType::Openclaw, false), // Openclaw has no project MCP
		(AgentType::OpenCode, true),
		(AgentType::Gemini, true),
		(AgentType::Cline, true),
		(AgentType::Copilot, true),
		(AgentType::Cursor, true),
		(AgentType::Antigravity, true),
		(AgentType::Kiro, true),
		(AgentType::Windsurf, true),
		(AgentType::Trae, true),
		(AgentType::Zed, true),
		(AgentType::JetBrainsAi, true),
		(AgentType::RooCode, true),
		(AgentType::Kimi, true),
		(AgentType::Mistral, true),
		(AgentType::Pi, false), // Pi has no MCP
		(AgentType::AugmentCode, true),
		(AgentType::KiloCode, true),
		(AgentType::Amp, true),
		(AgentType::Warp, true),
	];

	for (agent_type, desc) in all_descriptors() {
		if let Some((_, val)) = expected.iter().find(|(t, _)| *t == agent_type)
		{
			assert_eq!(
				desc.capabilities.mcp.scopes.project, *val,
				"mcp.scopes.project mismatch for {:?}",
				agent_type
			);
		}
	}
}

// =============================================================================
// Skills Capabilities Tests (from main branch actual values)
// =============================================================================

#[test]
fn test_skills_capabilities_scopes_global() {
	let expected: [(AgentType, bool); 22] = [
		(AgentType::Claude, true),
		(AgentType::Codex, true),
		(AgentType::Openclaw, true),
		(AgentType::OpenCode, true),
		(AgentType::Gemini, true),
		(AgentType::Cline, true),
		(AgentType::Copilot, true),
		(AgentType::Cursor, true),
		(AgentType::Antigravity, true),
		(AgentType::Kiro, true),
		(AgentType::Windsurf, true),
		(AgentType::Trae, true),
		(AgentType::Zed, false), // Zed has no global skills
		(AgentType::JetBrainsAi, false),
		(AgentType::RooCode, true),
		(AgentType::Kimi, true),
		(AgentType::Mistral, true),
		(AgentType::Pi, true),
		(AgentType::AugmentCode, false),
		(AgentType::KiloCode, true),
		(AgentType::Amp, true),
		(AgentType::Warp, true),
	];

	for (agent_type, desc) in all_descriptors() {
		if let Some((_, val)) = expected.iter().find(|(t, _)| *t == agent_type)
		{
			assert_eq!(
				desc.capabilities.skills.scopes.global, *val,
				"skills.scopes.global mismatch for {:?}",
				agent_type
			);
		}
	}
}

#[test]
fn test_skills_capabilities_scopes_project() {
	let expected: [(AgentType, bool); 22] = [
		(AgentType::Claude, true),
		(AgentType::Codex, true),
		(AgentType::Openclaw, false), // Openclaw has no project skills
		(AgentType::OpenCode, true),
		(AgentType::Gemini, true),
		(AgentType::Cline, true),
		(AgentType::Copilot, true),
		(AgentType::Cursor, true),
		(AgentType::Antigravity, true),
		(AgentType::Kiro, true),
		(AgentType::Windsurf, true),
		(AgentType::Trae, true),
		(AgentType::Zed, false), // Zed has no project skills
		(AgentType::JetBrainsAi, false),
		(AgentType::RooCode, true),
		(AgentType::Kimi, true),
		(AgentType::Mistral, true),
		(AgentType::Pi, true),
		(AgentType::AugmentCode, false),
		(AgentType::KiloCode, true),
		(AgentType::Amp, true),
		(AgentType::Warp, true),
	];

	for (agent_type, desc) in all_descriptors() {
		if let Some((_, val)) = expected.iter().find(|(t, _)| *t == agent_type)
		{
			assert_eq!(
				desc.capabilities.skills.scopes.project, *val,
				"skills.scopes.project mismatch for {:?}",
				agent_type
			);
		}
	}
}

#[test]
fn test_skills_capabilities_universal() {
	let expected: [(AgentType, bool); 22] = [
		(AgentType::Claude, false),
		(AgentType::Codex, false),
		(AgentType::Openclaw, false),
		(AgentType::OpenCode, false),
		(AgentType::Gemini, false),
		(AgentType::Cline, false),
		(AgentType::Copilot, false),
		(AgentType::Cursor, false),
		(AgentType::Antigravity, false),
		(AgentType::Kiro, false),
		(AgentType::Windsurf, false),
		(AgentType::Trae, false),
		(AgentType::Zed, false),
		(AgentType::JetBrainsAi, false),
		(AgentType::RooCode, false),
		(AgentType::Kimi, true), // Kimi has universal skills
		(AgentType::Mistral, false),
		(AgentType::Pi, false),
		(AgentType::AugmentCode, false),
		(AgentType::KiloCode, false),
		(AgentType::Amp, true), // Amp has universal skills
		(AgentType::Warp, false),
	];

	for (agent_type, desc) in all_descriptors() {
		if let Some((_, val)) = expected.iter().find(|(t, _)| *t == agent_type)
		{
			assert_eq!(
				desc.capabilities.skills.universal, *val,
				"skills.universal mismatch for {:?}",
				agent_type
			);
		}
	}
}

// =============================================================================
// Sub-Agent Capabilities Tests (from main branch actual values)
// =============================================================================

#[test]
fn test_sub_agent_capabilities_scopes_global() {
	let expected: [(AgentType, bool); 22] = [
		(AgentType::Claude, true), // Claude has global sub-agents
		(AgentType::Codex, true),
		(AgentType::Openclaw, false),
		(AgentType::OpenCode, true),
		(AgentType::Gemini, false),
		(AgentType::Cline, false),
		(AgentType::Copilot, false),
		(AgentType::Cursor, false),
		(AgentType::Antigravity, false),
		(AgentType::Kiro, false),
		(AgentType::Windsurf, false),
		(AgentType::Trae, false),
		(AgentType::Zed, false),
		(AgentType::JetBrainsAi, false),
		(AgentType::RooCode, false),
		(AgentType::Kimi, false),
		(AgentType::Mistral, false),
		(AgentType::Pi, false),
		(AgentType::AugmentCode, false),
		(AgentType::KiloCode, false),
		(AgentType::Amp, false),
		(AgentType::Warp, false),
	];

	for (agent_type, desc) in all_descriptors() {
		if let Some((_, val)) = expected.iter().find(|(t, _)| *t == agent_type)
		{
			assert_eq!(
				desc.capabilities.sub_agents.scopes.global, *val,
				"sub_agents.scopes.global mismatch for {:?}",
				agent_type
			);
		}
	}
}

#[test]
fn test_sub_agent_capabilities_scopes_project() {
	let expected: [(AgentType, bool); 22] = [
		(AgentType::Claude, true), // Claude has project sub-agents
		(AgentType::Codex, true),
		(AgentType::Openclaw, false),
		(AgentType::OpenCode, true),
		(AgentType::Gemini, false),
		(AgentType::Cline, false),
		(AgentType::Copilot, false),
		(AgentType::Cursor, false),
		(AgentType::Antigravity, false),
		(AgentType::Kiro, false),
		(AgentType::Windsurf, false),
		(AgentType::Trae, false),
		(AgentType::Zed, false),
		(AgentType::JetBrainsAi, false),
		(AgentType::RooCode, false),
		(AgentType::Kimi, false),
		(AgentType::Mistral, false),
		(AgentType::Pi, false),
		(AgentType::AugmentCode, false),
		(AgentType::KiloCode, false),
		(AgentType::Amp, false),
		(AgentType::Warp, false),
	];

	for (agent_type, desc) in all_descriptors() {
		if let Some((_, val)) = expected.iter().find(|(t, _)| *t == agent_type)
		{
			assert_eq!(
				desc.capabilities.sub_agents.scopes.project, *val,
				"sub_agents.scopes.project mismatch for {:?}",
				agent_type
			);
		}
	}
}

// =============================================================================
// Global Skill Paths Tests (from main branch actual values)
// =============================================================================

#[test]
fn test_global_skill_paths() {
	// Most agents have single skill path, Claude has dynamic plugin discovery
	let expected: [(AgentType, Option<&[&str]>); 22] = [
		// Claude: dynamic plugin discovery, base path is .claude/skills
		(AgentType::Claude, Some(&[".claude/skills"])),
		(
			AgentType::Codex,
			Some(&[".codex/skills", ".agents/skills", "/etc/codex/skills"]),
		),
		(AgentType::Openclaw, Some(&[".openclaw/skills"])),
		(
			AgentType::OpenCode,
			Some(&[
				".config/opencode/skills",
				".claude/skills",
				".agents/skills",
			]),
		),
		(AgentType::Gemini, Some(&[".gemini/skills"])),
		(AgentType::Cline, Some(&[".agents/skills"])),
		(AgentType::Copilot, Some(&[".copilot/skills"])),
		(
			AgentType::Cursor,
			Some(&[".cursor/skills", ".claude/skills", ".codex/skills"]),
		),
		(
			AgentType::Antigravity,
			Some(&[".gemini/antigravity/skills"]),
		),
		(AgentType::Kiro, Some(&[".kiro/skills"])),
		(AgentType::Windsurf, Some(&[".codeium/windsurf/skills"])),
		(AgentType::Trae, Some(&[".trae/skills"])),
		(AgentType::Zed, None), // Zed has no skills
		(AgentType::JetBrainsAi, None),
		(AgentType::RooCode, Some(&[".roo/skills"])),
		(
			AgentType::Kimi,
			Some(&[".config/agents/skills", ".config/agents/skills"]),
		), // universal=true adds extra path
		(AgentType::Mistral, Some(&[".vibe/skills"])),
		(AgentType::Pi, Some(&[".pi/agent/skills"])),
		(AgentType::AugmentCode, None),
		(AgentType::KiloCode, Some(&[".kilocode/skills"])),
		(
			AgentType::Amp,
			Some(&[".config/agents/skills", ".config/agents/skills"]),
		), // universal=true adds extra path
		(AgentType::Warp, Some(&[".agents/skills"])),
	];

	for (agent_type, desc) in all_descriptors() {
		if let Some((_, paths)) =
			expected.iter().find(|(t, _)| *t == agent_type)
		{
			match paths {
				Some(path_strs) => {
					assert!(
						desc.global_skill_paths.is_some(),
						"global_skill_paths should be Some for {:?}",
						agent_type
					);
					let actual = desc.global_skill_read_paths();
					// For Claude, only check the first path since plugins are dynamic
					// For Openclaw, dynamic npm discovery, just check first path
					if agent_type == AgentType::Claude {
						assert!(
							actual.first() == Some(&home().join(".claude/skills")),
							"global_skill_read_paths first path mismatch for {:?}",
							agent_type
						);
					} else if agent_type == AgentType::Openclaw {
						assert!(
							actual.first() == Some(&home().join(".openclaw/skills")),
							"global_skill_read_paths first path mismatch for {:?}",
							agent_type
						);
					} else {
						let expected_paths: Vec<PathBuf> =
							path_strs.iter().map(|p| home().join(*p)).collect();
						assert_eq!(
							actual, expected_paths,
							"global_skill_read_paths mismatch for {:?}",
							agent_type
						);
					}
				}
				None => {
					assert!(
						desc.global_skill_paths.is_none(),
						"global_skill_paths should be None for {:?}",
						agent_type
					);
				}
			}
		}
	}
}

// =============================================================================
// Project Skill Paths Tests (from main branch actual values)
// =============================================================================

#[test]
fn test_project_skill_paths() {
	let root = PathBuf::from("/project");

	let expected: [(AgentType, Option<&[&str]>); 22] = [
		(AgentType::Claude, Some(&[".claude/skills"])),
		(AgentType::Codex, Some(&[".agents/skills"])),
		(AgentType::Openclaw, None), // Openclaw has no project skills
		(
			AgentType::OpenCode,
			Some(&[".opencode/skills", ".claude/skills", ".agents/skills"]),
		),
		(AgentType::Gemini, Some(&[".agents/skills"])),
		(AgentType::Cline, Some(&[".agents/skills"])),
		(AgentType::Copilot, Some(&[".agents/skills"])),
		(
			AgentType::Cursor,
			Some(&[
				".cursor/skills",
				".agents/skills",
				".claude/skills",
				".codex/skills",
			]),
		),
		(AgentType::Antigravity, Some(&[".agents/skills"])),
		(AgentType::Kiro, Some(&[".kiro/skills"])),
		(AgentType::Windsurf, Some(&[".windsurf/skills"])),
		(AgentType::Trae, Some(&[".trae/skills"])),
		(AgentType::Zed, None), // Zed has no skills
		(AgentType::JetBrainsAi, None),
		(AgentType::RooCode, Some(&[".roo/skills"])),
		(AgentType::Kimi, Some(&[".agents/skills", ".agents/skills"])), // universal=true adds extra .agents/skills
		(AgentType::Mistral, Some(&[".vibe/skills"])),
		(AgentType::Pi, Some(&[".pi/skills"])),
		(AgentType::AugmentCode, None),
		(AgentType::KiloCode, Some(&[".kilocode/skills"])),
		(AgentType::Amp, Some(&[".agents/skills", ".agents/skills"])), // universal=true adds extra .agents/skills
		(AgentType::Warp, Some(&[".agents/skills"])),
	];

	for (agent_type, desc) in all_descriptors() {
		if let Some((_, paths)) =
			expected.iter().find(|(t, _)| *t == agent_type)
		{
			match paths {
				Some(path_strs) => {
					assert!(
						desc.project_skill_paths.is_some(),
						"project_skill_paths should be Some for {:?}",
						agent_type
					);
					let actual = desc.project_skill_read_paths(&root);
					let expected_paths: Vec<PathBuf> =
						path_strs.iter().map(|p| root.join(*p)).collect();
					assert_eq!(
						actual, expected_paths,
						"project_skill_read_paths mismatch for {:?}",
						agent_type
					);
				}
				None => {
					assert!(
						desc.project_skill_paths.is_none(),
						"project_skill_paths should be None for {:?}",
						agent_type
					);
				}
			}
		}
	}
}
