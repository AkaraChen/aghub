//! Agent descriptor regression tests.
//!
//! These tests lock the registered product set and documented path and
//! capability contracts while descriptor files change.

use aghub_agents::{AgentDescriptor, AgentSurfaceKind, AgentType};
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
		(AgentType::Grok, &agents::grok::DESCRIPTOR),
		(
			AgentType::DeepSeekHarness,
			&agents::deepseek_harness::DESCRIPTOR,
		),
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
		(AgentType::Factory, &agents::factory::DESCRIPTOR),
		(AgentType::Adal, &agents::adal::DESCRIPTOR),
		(AgentType::Aider, &agents::aider::DESCRIPTOR),
		(AgentType::CodeBuddy, &agents::codebuddy::DESCRIPTOR),
		(AgentType::CodeWhale, &agents::codewhale::DESCRIPTOR),
		(AgentType::CommandCode, &agents::command_code::DESCRIPTOR),
		(AgentType::Continue, &agents::continue_agent::DESCRIPTOR),
		(AgentType::QwenPaw, &agents::qwenpaw::DESCRIPTOR),
		(AgentType::Crush, &agents::crush::DESCRIPTOR),
		(AgentType::DuMate, &agents::dumate::DESCRIPTOR),
		(AgentType::Goose, &agents::goose::DESCRIPTOR),
		(AgentType::Hermes, &agents::hermes::DESCRIPTOR),
		(AgentType::IFlow, &agents::iflow::DESCRIPTOR),
		(AgentType::Junie, &agents::junie::DESCRIPTOR),
		(AgentType::Kode, &agents::kode::DESCRIPTOR),
		(AgentType::McpJam, &agents::mcpjam::DESCRIPTOR),
		(AgentType::Xum, &agents::xum::DESCRIPTOR),
		(AgentType::Neovate, &agents::neovate::DESCRIPTOR),
		(AgentType::OpenHands, &agents::openhands::DESCRIPTOR),
		(AgentType::Pochi, &agents::pochi::DESCRIPTOR),
		(AgentType::Qoder, &agents::qoder::DESCRIPTOR),
		(AgentType::QoderWork, &agents::qoderwork::DESCRIPTOR),
		(AgentType::QwenCode, &agents::qwen_code::DESCRIPTOR),
		(AgentType::WorkBuddy, &agents::workbuddy::DESCRIPTOR),
		(AgentType::Zencoder, &agents::zencoder::DESCRIPTOR),
	]
}

#[test]
fn agent_catalog_keeps_the_issue_446_product_set() {
	let actual = AgentType::ALL
		.iter()
		.map(AgentType::as_str)
		.collect::<Vec<_>>();
	let expected = [
		"cursor",
		"grok",
		"deepseek-harness",
		"windsurf",
		"copilot",
		"claude",
		"roocode",
		"cline",
		"gemini",
		"codex",
		"antigravity",
		"openclaw",
		"opencode",
		"augmentcode",
		"kilocode",
		"amp",
		"zed",
		"kiro",
		"warp",
		"trae",
		"factory",
		"kimi",
		"mistral",
		"pi",
		"jetbrains-ai",
		"adal",
		"aider",
		"codebuddy",
		"codewhale",
		"command-code",
		"continue",
		"qwenpaw",
		"crush",
		"dumate",
		"goose",
		"hermes",
		"iflow",
		"junie",
		"kode",
		"mcpjam",
		"xum",
		"neovate",
		"openhands",
		"pochi",
		"qoder",
		"qoderwork",
		"qwen-code",
		"workbuddy",
		"zencoder",
	];

	assert_eq!(actual, expected);
}

#[test]
fn qoder_uses_resource_specific_precedence() {
	use aghub_agents::agents;
	use aghub_agents::ScopePrecedence;

	let precedence = agents::qoder::DESCRIPTOR.precedence;
	assert_eq!(precedence.skills, ScopePrecedence::GlobalThenProject);
	assert_eq!(precedence.mcp, ScopePrecedence::ProjectThenGlobal);
	assert_eq!(precedence.sub_agents, ScopePrecedence::ProjectThenGlobal);
}

#[test]
fn copilot_cli_sources_match_the_current_contract() {
	use aghub_agents::agents;

	let descriptor = &agents::copilot::DESCRIPTOR;
	assert!(descriptor.surfaces.iter().any(|surface| {
		surface.kind == AgentSurfaceKind::Cli
			&& surface.cli_names == ["copilot"]
	}));
	assert_eq!(
		descriptor.mcp_global_path.unwrap()(),
		Some(home().join(".copilot/mcp-config.json"))
	);
	assert_eq!(
		descriptor.project_skill_read_paths(&PathBuf::from("/project")),
		vec![
			PathBuf::from("/project/.github/skills"),
			PathBuf::from("/project/.claude/skills"),
			PathBuf::from("/project/.agents/skills"),
		]
	);
}

#[test]
fn copilot_reads_both_documented_project_mcp_sources() {
	use aghub_agents::agents;
	use aghub_agents::{
		ResourceScope, ResourceSourceKind, ResourceWritePolicy,
	};

	let project = tempfile::tempdir().unwrap();
	std::fs::create_dir_all(project.path().join(".github")).unwrap();
	std::fs::write(
		project.path().join(".mcp.json"),
		r#"{"workspace":{"type":"local","command":"workspace"}}"#,
	)
	.unwrap();
	std::fs::write(
		project.path().join(".github/mcp.json"),
		r#"{"mcpServers":{"repository":{"type":"local","command":"repository"}}}"#,
	)
	.unwrap();

	let mcps = (agents::copilot::DESCRIPTOR.load_mcps)(
		Some(project.path()),
		ResourceScope::ProjectOnly,
	)
	.unwrap();

	assert_eq!(
		mcps.iter().map(|mcp| mcp.name.as_str()).collect::<Vec<_>>(),
		["workspace", "repository"]
	);
	let workspace = mcps[0].origin.as_ref().unwrap();
	assert_eq!(workspace.source_kind, ResourceSourceKind::Standard);
	assert_eq!(workspace.write_policy, ResourceWritePolicy::ReadWrite);
	let repository = mcps[1].origin.as_ref().unwrap();
	assert_eq!(repository.source_kind, ResourceSourceKind::Native);
	assert_eq!(repository.write_policy, ResourceWritePolicy::ReadOnly);
}

#[test]
fn qoder_reads_project_mcp_layers_in_runtime_order() {
	use aghub_agents::agents;
	use aghub_agents::{ResourceScope, ResourceWritePolicy};

	let project = tempfile::tempdir().unwrap();
	std::fs::create_dir_all(project.path().join(".qoder")).unwrap();
	for (relative, name) in [
		(".qoder/settings.local.json", "local"),
		(".mcp.json", "workspace"),
		(".qoder/settings.json", "project"),
	] {
		std::fs::write(
			project.path().join(relative),
			format!(r#"{{"mcpServers":{{"{name}":{{"command":"{name}"}}}}}}"#),
		)
		.unwrap();
	}

	let mcps = (agents::qoder::DESCRIPTOR.load_mcps)(
		Some(project.path()),
		ResourceScope::ProjectOnly,
	)
	.unwrap();

	assert_eq!(
		mcps.iter().map(|mcp| mcp.name.as_str()).collect::<Vec<_>>(),
		["local", "workspace", "project"]
	);
	assert_eq!(
		mcps[0].origin.as_ref().unwrap().write_policy,
		ResourceWritePolicy::ReadOnly
	);
	assert_eq!(
		mcps[2].origin.as_ref().unwrap().write_policy,
		ResourceWritePolicy::ReadWrite
	);
}

#[test]
fn new_agent_project_write_targets_match_their_native_contracts() {
	use aghub_agents::agents;
	use aghub_agents::ResourceScope;

	let root = PathBuf::from("/project");
	let cases = [
		(&agents::adal::DESCRIPTOR, Some(".adal/skills")),
		(&agents::aider::DESCRIPTOR, None),
		(&agents::codebuddy::DESCRIPTOR, Some(".codebuddy/skills")),
		(&agents::codewhale::DESCRIPTOR, Some(".codewhale/skills")),
		(
			&agents::command_code::DESCRIPTOR,
			Some(".commandcode/skills"),
		),
		(&agents::continue_agent::DESCRIPTOR, None),
		(&agents::qwenpaw::DESCRIPTOR, None),
		(&agents::crush::DESCRIPTOR, Some(".crush/skills")),
		(&agents::dumate::DESCRIPTOR, None),
		(&agents::goose::DESCRIPTOR, Some(".agents/skills")),
		(&agents::hermes::DESCRIPTOR, None),
		(&agents::iflow::DESCRIPTOR, Some(".iflow/skills")),
		(&agents::junie::DESCRIPTOR, Some(".junie/skills")),
		(&agents::kode::DESCRIPTOR, Some(".kode/skills")),
		(&agents::mcpjam::DESCRIPTOR, Some(".mcpjam/skills")),
		(&agents::xum::DESCRIPTOR, Some(".xum/skills")),
		(&agents::neovate::DESCRIPTOR, Some(".neovate/skills")),
		(&agents::openhands::DESCRIPTOR, Some(".agents/skills")),
		(&agents::pochi::DESCRIPTOR, Some(".pochi/skills")),
		(&agents::qoder::DESCRIPTOR, Some(".qoder/skills")),
		(&agents::qoderwork::DESCRIPTOR, None),
		(&agents::qwen_code::DESCRIPTOR, Some(".qwen/skills")),
		(&agents::workbuddy::DESCRIPTOR, None),
		(&agents::zencoder::DESCRIPTOR, Some(".agents/skills")),
	];

	for (descriptor, relative) in cases {
		assert_eq!(
			descriptor
				.skill_write_path(Some(&root), ResourceScope::ProjectOnly,),
			relative.map(|path| root.join(path)),
			"{}",
			descriptor.id
		);
	}
}

#[test]
fn mixed_resource_agents_expose_only_implemented_families() {
	use aghub_agents::agents;

	let codebuddy = &agents::codebuddy::DESCRIPTOR.capabilities;
	assert!(codebuddy.skills.scopes.global);
	assert!(codebuddy.mcp.scopes.project);
	assert!(codebuddy.sub_agents.scopes.project);
	assert!(agents::codebuddy::DESCRIPTOR.rule_paths.is_some());

	let command_code = &agents::command_code::DESCRIPTOR.capabilities;
	assert!(command_code.skills.scopes.project);
	assert!(command_code.mcp.scopes.global);
	assert!(!command_code.mcp.scopes.project);
	assert!(command_code.sub_agents.scopes.project);

	let qoder = &agents::qoder::DESCRIPTOR.capabilities;
	assert!(qoder.skills.scopes.project);
	assert!(qoder.mcp.scopes.project);
	assert!(qoder.sub_agents.scopes.project);
	assert!(agents::qoder::DESCRIPTOR.rule_paths.is_some());

	let pochi = &agents::pochi::DESCRIPTOR.capabilities;
	assert!(pochi.skills.scopes.project);
	assert!(pochi.sub_agents.scopes.project);
	assert!(!pochi.mcp.scopes.project);

	let workbuddy = &agents::workbuddy::DESCRIPTOR.capabilities;
	assert!(!workbuddy.skills.scopes.project);
	assert!(workbuddy.mcp.scopes.project);
	assert!(!workbuddy.sub_agents.scopes.project);
}

#[test]
fn read_only_and_audit_sources_are_not_install_targets() {
	use aghub_agents::agents;
	use aghub_agents::{ResourceScope, ResourceWritePolicy, RuntimeVisibility};

	let qwenpaw = agents::qwenpaw::DESCRIPTOR
		.skill_read_sources(None, ResourceScope::GlobalOnly);
	assert!(!qwenpaw.is_empty());
	assert!(qwenpaw
		.iter()
		.all(|source| source.write_policy == ResourceWritePolicy::ReadOnly));
	assert!(qwenpaw
		.iter()
		.all(|source| source.runtime_visibility
			== RuntimeVisibility::Conditional));

	let codewhale = agents::codewhale::DESCRIPTOR.skill_read_sources(
		Some(&PathBuf::from("/project")),
		ResourceScope::ProjectOnly,
	);
	let codex = codewhale
		.iter()
		.find(|source| source.root.ends_with(".codex/skills"))
		.unwrap();
	assert_eq!(codex.write_policy, ResourceWritePolicy::ReadOnly);
	assert_eq!(codex.runtime_visibility, RuntimeVisibility::AuditOnly);
}

fn configuration_paths(descriptor: &AgentDescriptor) -> Vec<PathBuf> {
	let mut paths = descriptor
		.surfaces
		.iter()
		.flat_map(|surface| surface.configuration_paths)
		.filter_map(|resolve| resolve())
		.collect::<Vec<_>>();
	paths.sort();
	paths.dedup();
	paths
}

#[test]
fn every_descriptor_has_unique_surface_ids() {
	for (_, descriptor) in all_descriptors() {
		assert!(!descriptor.surfaces.is_empty(), "{}", descriptor.id);
		for (index, surface) in descriptor.surfaces.iter().enumerate() {
			assert!(
				descriptor.surfaces[..index]
					.iter()
					.all(|other| other.id != surface.id),
				"duplicate surface '{}' for {}",
				surface.id,
				descriptor.id
			);
		}
	}
}

#[test]
fn ide_only_products_do_not_borrow_unrelated_cli_commands() {
	use aghub_agents::agents;

	for descriptor in [
		&agents::jetbrains_ai::DESCRIPTOR,
		&agents::roocode::DESCRIPTOR,
	] {
		assert!(descriptor
			.surfaces
			.iter()
			.all(|surface| surface.kind == AgentSurfaceKind::Ide));
		assert!(descriptor
			.surfaces
			.iter()
			.all(|surface| surface.cli_names.is_empty()));
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
		(AgentType::Copilot, &[".github", ".mcp.json"]),
		(AgentType::Cursor, &[".cursor"]),
		(AgentType::Antigravity, &[".gemini/antigravity"]),
		(AgentType::Kiro, &[".kiro"]),
		(AgentType::Windsurf, &[".windsurf"]),
		(AgentType::Trae, &[".trae", ".traecli"]),
		(AgentType::Zed, &[".zed"]),
		(AgentType::JetBrainsAi, &[]),
		(AgentType::RooCode, &[".roo"]),
		(AgentType::Kimi, &[".kimi"]),
		(AgentType::Mistral, &[".vibe"]),
		(AgentType::Pi, &[".pi"]),
		(AgentType::AugmentCode, &[]),
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
		(AgentType::Copilot, Some(".copilot/mcp-config.json")),
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
		(AgentType::Trae, None), // global MCP is GUI-managed (no file)
		(AgentType::Zed, Some(".config/zed/settings.json")),
		(AgentType::JetBrainsAi, None), // MCP is GUI-only (no file)
		(AgentType::RooCode, Some(".roo/mcp.json")),
		(AgentType::Kimi, Some(".kimi/mcp.json")),
		(AgentType::Mistral, Some(".vibe/mcp.toml")),
		(AgentType::Pi, None), // Pi has no MCP
		(AgentType::AugmentCode, Some(".augment/settings.json")),
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
		(AgentType::Copilot, Some(".mcp.json")),
		(AgentType::Cursor, Some(".cursor/mcp.json")),
		(
			AgentType::Antigravity,
			Some(".gemini/antigravity/mcp_config.json"),
		),
		(AgentType::Kiro, Some(".kiro/settings/mcp.json")),
		(AgentType::Windsurf, Some(".windsurf/mcp_config.json")),
		(AgentType::Trae, Some(".trae/mcp.json")),
		(AgentType::Zed, Some(".zed/settings.json")),
		(AgentType::JetBrainsAi, None), // MCP is GUI-only (no file)
		(AgentType::RooCode, Some(".roo/mcp.json")),
		(AgentType::Kimi, Some(".kimi/mcp.json")),
		(AgentType::Mistral, Some(".vibe/mcp.toml")),
		(AgentType::Pi, None),          // Pi has no MCP
		(AgentType::AugmentCode, None), // CLI has no project MCP file
		(AgentType::KiloCode, Some(".kilocode/mcp.json")),
		(AgentType::Amp, Some(".amp/settings.json")),
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
// Configuration root tests (from main branch actual values)
// =============================================================================

#[test]
fn test_configuration_roots() {
	let expected: [(AgentType, Option<&str>); 20] = [
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
		// Trae and JetBrainsAi use the OS config dir, not a home dotfolder —
		// asserted explicitly after the loop.
		(AgentType::Zed, Some(".config/zed")),
		(AgentType::RooCode, Some(".roo")),
		(AgentType::Kimi, Some(".kimi")),
		(AgentType::Mistral, Some(".vibe")),
		(AgentType::Pi, Some(".pi/agent")),
		(AgentType::AugmentCode, Some(".augment")),
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
				let actual = configuration_paths(desc);
				assert!(
					actual.contains(&home().join(path)),
					"configuration root mismatch for {:?}",
					agent_type
				);
			}
			Some(None) => {
				assert!(
					configuration_paths(desc).is_empty(),
					"configuration root should be absent for {:?}",
					agent_type
				);
			}
			None => {}
		}
	}

	// Trae and JetBrains AI store data in the OS config dir (Application
	// Support on macOS, .config on Linux), not a home dotfolder.
	use aghub_agents::agents;
	let trae = configuration_paths(&agents::trae::DESCRIPTOR);
	assert!(dirs::config_dir()
		.map(|dir| trae.contains(&dir.join("Trae")))
		.unwrap_or(false));
	let jetbrains = configuration_paths(&agents::jetbrains_ai::DESCRIPTOR);
	assert!(dirs::config_dir()
		.map(|dir| jetbrains.contains(&dir.join("JetBrains")))
		.unwrap_or(false));
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
		(AgentType::JetBrainsAi, false), // GUI-only, no file-based MCP
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
		(AgentType::Codex, true),
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
		(AgentType::JetBrainsAi, false), // GUI-only, no file-based MCP
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
				desc.capabilities.mcp.sse
					|| desc.capabilities.mcp.streamable_http,
				*val,
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
		(AgentType::Trae, false), // global MCP is GUI-managed
		(AgentType::Zed, true),
		(AgentType::JetBrainsAi, false), // GUI-only, no file-based MCP
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
		(AgentType::JetBrainsAi, false), // GUI-only, no file-based MCP
		(AgentType::RooCode, true),
		(AgentType::Kimi, true),
		(AgentType::Mistral, true),
		(AgentType::Pi, false),          // Pi has no MCP
		(AgentType::AugmentCode, false), // CLI has no project MCP file
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
		(AgentType::Codex, true),
		(AgentType::Openclaw, false),
		(AgentType::OpenCode, true),
		(AgentType::Gemini, true),
		(AgentType::Cline, true),
		(AgentType::Copilot, true),
		(AgentType::Cursor, true),
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
		(AgentType::Warp, true),
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
		(AgentType::Copilot, true),
		(AgentType::Cursor, true),
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
		(AgentType::Copilot, true),
		(AgentType::Cursor, true),
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
			Some(&[".codex/skills", "/etc/codex/skills", ".agents/skills"]),
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
		(
			AgentType::Gemini,
			Some(&[".gemini/skills", ".agents/skills"]),
		),
		(AgentType::Cline, Some(&[".agents/skills"])),
		(
			AgentType::Copilot,
			Some(&[".copilot/skills", ".agents/skills"]),
		),
		(
			AgentType::Cursor,
			Some(&[
				".cursor/skills",
				".claude/skills",
				".codex/skills",
				".agents/skills",
			]),
		),
		(
			AgentType::Antigravity,
			Some(&[".gemini/antigravity/skills"]),
		),
		(AgentType::Kiro, Some(&[".kiro/skills"])),
		(AgentType::Windsurf, Some(&[".codeium/windsurf/skills"])),
		(
			AgentType::Trae,
			Some(&[".traecli/skills", ".trae-cn/skills"]),
		),
		(AgentType::Zed, None), // Zed has no skills
		(AgentType::JetBrainsAi, None),
		(AgentType::RooCode, Some(&[".roo/skills"])),
		(
			AgentType::Kimi,
			Some(&[".config/agents/skills", ".agents/skills"]),
		),
		(AgentType::Mistral, Some(&[".vibe/skills"])),
		(AgentType::Pi, Some(&[".pi/agent/skills"])),
		(AgentType::AugmentCode, None),
		(AgentType::KiloCode, Some(&[".kilocode/skills"])),
		(
			AgentType::Amp,
			Some(&[".config/agents/skills", ".agents/skills"]),
		),
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
					} else if agent_type == AgentType::Codex {
						// /etc/codex/skills is a Unix-only system path
						let mut expected_paths =
							vec![home().join(".codex/skills")];
						#[cfg(not(target_os = "windows"))]
						expected_paths.push(PathBuf::from("/etc/codex/skills"));
						expected_paths.push(home().join(".agents/skills"));
						assert_eq!(
							actual, expected_paths,
							"global_skill_read_paths mismatch for {:?}",
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
		(
			AgentType::Copilot,
			Some(&[".github/skills", ".claude/skills", ".agents/skills"]),
		),
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
		(
			AgentType::Trae,
			Some(&[".traecli/skills", ".trae/skills", ".agents/skills"]),
		),
		(AgentType::Zed, None), // Zed has no skills
		(AgentType::JetBrainsAi, None),
		(AgentType::RooCode, Some(&[".roo/skills"])),
		(AgentType::Kimi, Some(&[".agents/skills"])),
		(AgentType::Mistral, Some(&[".vibe/skills"])),
		(AgentType::Pi, Some(&[".pi/skills"])),
		(AgentType::AugmentCode, None),
		(AgentType::KiloCode, Some(&[".kilocode/skills"])),
		(AgentType::Amp, Some(&[".agents/skills"])),
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

#[test]
fn test_fixed_rule_paths() {
	use aghub_agents::agents;

	let root = PathBuf::from("/project");
	let cases = [
		(
			&agents::claude::DESCRIPTOR,
			vec![home().join(".claude/CLAUDE.md")],
			vec![root.join("CLAUDE.md")],
		),
		(
			&agents::codex::DESCRIPTOR,
			vec![
				home().join(".codex/AGENTS.override.md"),
				home().join(".codex/AGENTS.md"),
			],
			vec![root.join("AGENTS.override.md"), root.join("AGENTS.md")],
		),
		(
			&agents::opencode::DESCRIPTOR,
			vec![home().join(".config/opencode/AGENTS.md")],
			vec![root.join("AGENTS.md")],
		),
		(
			&agents::gemini::DESCRIPTOR,
			vec![home().join(".gemini/GEMINI.md")],
			vec![root.join("GEMINI.md")],
		),
		(
			&agents::copilot::DESCRIPTOR,
			vec![home().join(".copilot/copilot-instructions.md")],
			vec![
				root.join(".github/copilot-instructions.md"),
				root.join("AGENTS.md"),
			],
		),
		(
			&agents::amp::DESCRIPTOR,
			vec![
				home().join(".config/amp/AGENTS.md"),
				home().join(".config/AGENTS.md"),
			],
			vec![root.join("AGENTS.md")],
		),
	];

	for (descriptor, global, project) in cases {
		assert_eq!(descriptor.global_rule_paths(), global, "{}", descriptor.id);
		assert_eq!(
			descriptor.project_rule_paths(&root),
			project,
			"{}",
			descriptor.id
		);
	}
}

#[test]
fn grok_descriptor_matches_standard_client_contract() {
	use aghub_agents::agents;

	let descriptor = &agents::grok::DESCRIPTOR;
	let root = PathBuf::from("/project");
	assert_eq!(descriptor.id, "grok");
	assert_eq!(descriptor.display_name, "Grok Build");
	assert_eq!(descriptor.surfaces[0].cli_names, &["grok"]);
	assert_eq!(descriptor.surfaces[0].validate_args, &["version"]);
	assert_eq!(descriptor.skills_cli_name, Some("grok"));
	assert_eq!(descriptor.project_markers, &[".grok"]);
	assert_eq!(
		descriptor.mcp_project_path.unwrap()(&root),
		Some(root.join(".grok/config.toml"))
	);
	assert_eq!(
		(descriptor.project_skill_paths.unwrap().write)(&root),
		Some(root.join(".grok/skills"))
	);
	assert!(descriptor.capabilities.skills.scopes.global);
	assert!(descriptor.capabilities.skills.scopes.project);
	assert!(descriptor.capabilities.skills.universal);
	assert!(descriptor.capabilities.mcp.scopes.global);
	assert!(descriptor.capabilities.mcp.scopes.project);
	assert!(descriptor.capabilities.mcp.stdio);
	assert!(descriptor.capabilities.mcp.sse);
	assert!(descriptor.capabilities.mcp.streamable_http);
	assert!(descriptor.capabilities.mcp.enable_disable);
}

#[test]
fn deepseek_harness_descriptor_matches_skill_contract() {
	use aghub_agents::agents;

	let descriptor = &agents::deepseek_harness::DESCRIPTOR;
	let root = PathBuf::from("/project");
	assert_eq!(descriptor.id, "deepseek-harness");
	assert_eq!(descriptor.display_name, "DeepSeek Harness");
	assert_eq!(descriptor.surfaces[0].cli_names, &["dsh"]);
	assert_eq!(descriptor.surfaces[0].validate_args, &["--help"]);
	assert_eq!(descriptor.skills_cli_name, None);
	assert_eq!(descriptor.project_markers, &[".dsh"]);
	assert_eq!(
		(descriptor.project_skill_paths.unwrap().read)(&root),
		vec![root.join(".dsh/skills")]
	);
	assert_eq!(
		(descriptor.project_skill_paths.unwrap().write)(&root),
		Some(root.join(".dsh/skills"))
	);
	assert!(descriptor.capabilities.skills.scopes.global);
	assert!(descriptor.capabilities.skills.scopes.project);
	assert!(descriptor.capabilities.skills.universal);
	assert!(!descriptor.capabilities.mcp.scopes.global);
	assert!(!descriptor.capabilities.mcp.scopes.project);
	assert!(!descriptor.capabilities.skills.discovery.include_nested);
	assert!(
		descriptor
			.capabilities
			.skills
			.discovery
			.include_flat_markdown
	);
}
