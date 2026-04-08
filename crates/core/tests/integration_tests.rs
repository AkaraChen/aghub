//! Integration tests for aghub-core
//!
//! These tests verify the full CRUD workflow and agent validation
//! using temporary configurations to avoid polluting the global environment.

use aghub_core::{
	models::{AgentType, McpServer, McpTransport, Skill},
	testing::{TestConfig, TestConfigBuilder},
};
use std::collections::HashMap;

// ==================== Helper Functions ====================

fn create_test_mcp_stdio(name: &str) -> McpServer {
	McpServer::new(
		name,
		McpTransport::stdio(
			"echo",
			vec!["test".to_string(), "args".to_string()],
		),
	)
}

fn create_test_mcp_sse(name: &str) -> McpServer {
	let mut headers = HashMap::new();
	headers
		.insert("Authorization".to_string(), "Bearer test-token".to_string());

	McpServer::new(
		name,
		McpTransport::sse_with_headers("http://localhost:3000", headers),
	)
}

fn create_test_mcp_streamable_http(name: &str) -> McpServer {
	let mut headers = HashMap::new();
	headers
		.insert("Authorization".to_string(), "Bearer test-token".to_string());
	headers.insert("X-API-Version".to_string(), "v1".to_string());

	McpServer::new(
		name,
		McpTransport::streamable_http_with_headers(
			"http://localhost:3000/mcp",
			headers,
		),
	)
}

fn create_test_skill(name: &str) -> Skill {
	Skill {
		name: name.to_string(),
		enabled: true,
		description: Some(format!("Test skill: {}", name)),
		author: Some("test-author".to_string()),
		version: Some("1.0.0".to_string()),
		content: None,
		tools: vec!["tool1".to_string(), "tool2".to_string()],
		source_path: None,
		canonical_path: None,
		config_source: None,
	}
}

/// Macro to generate standard MCP workflow tests for multiple agents.
macro_rules! test_mcp_workflow {
    ($($name:ident => $agent:expr, $mcp_name:literal),* $(,)?) => {
        $(
            #[test]
            fn $name() {
                let test = TestConfig::new($agent).unwrap();
                let mut manager = test.create_manager();
                manager.load().unwrap();

                let mcp = create_test_mcp_stdio($mcp_name);
                manager.add_mcp(mcp).unwrap();

                manager.load().unwrap();
                let config = manager.config().unwrap();
                assert_eq!(config.mcps.len(), 1);
                assert_eq!(config.mcps[0].name, $mcp_name);

                manager.remove_mcp($mcp_name).unwrap();
                manager.load().unwrap();
                assert!(manager.config().unwrap().mcps.is_empty());
            }
        )*
    };
}

// ==================== Claude Code Integration Tests ====================

#[test]
fn test_claude_full_mcp_workflow() {
	let test = TestConfig::new(AgentType::Claude).unwrap();
	let mut manager = test.create_manager();

	// Load initial empty config
	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert!(config.mcps.is_empty());

	// Add MCP server
	let mcp1 = create_test_mcp_stdio("mcp1");
	manager.add_mcp(mcp1.clone()).unwrap();

	// Verify it was added
	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert_eq!(config.mcps[0].name, "mcp1");
	assert!(config.mcps[0].enabled);

	// Add second MCP
	let mcp2 = create_test_mcp_stdio("mcp2");
	manager.add_mcp(mcp2.clone()).unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 2);

	// Update MCP
	let mut updated_mcp = mcp1.clone();
	updated_mcp.transport =
		McpTransport::stdio("updated", vec!["new".to_string()]);
	manager.update_mcp("mcp1", updated_mcp).unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	let mcp1_ref = config.mcps.iter().find(|m| m.name == "mcp1").unwrap();
	match &mcp1_ref.transport {
		McpTransport::Stdio { command, .. } => assert_eq!(command, "updated"),
		_ => panic!("Expected stdio transport"),
	}

	// Note: Claude doesn't preserve disabled state - disabled MCPs are removed from config
	// This is expected behavior for Claude adapter

	// Delete MCP
	manager.remove_mcp("mcp1").unwrap();
	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert!(!config.mcps.iter().any(|m| m.name == "mcp1"));
}

#[test]
fn test_claude_skill_workflow() {
	let test = TestConfig::new(AgentType::Claude).unwrap();

	// Create test skill in the isolated skills directory
	test.create_test_skill("rust-dev", Some("A Rust development skill"))
		.unwrap();

	let mut manager = test.create_manager();
	manager.load().unwrap();

	// Verify skill was loaded from directory
	let config = manager.config().unwrap();
	assert_eq!(config.skills.len(), 1);

	let saved_skill = &config.skills[0];
	assert_eq!(saved_skill.name, "rust-dev");
	assert_eq!(
		saved_skill.description,
		Some("A Rust development skill".to_string())
	);

	// Note: Skills are loaded from filesystem, not settings.json
	// The manager CRUD operations work on the in-memory representation
	// but skills are persisted in the directory structure
}

#[test]
fn test_claude_sse_mcp_supported() {
	let test = TestConfig::new(AgentType::Claude).unwrap();
	let mut manager = test.create_manager();

	manager.load().unwrap();

	// Add SSE-based MCP (now supported by Claude)
	let mut headers = HashMap::new();
	headers.insert("Authorization".to_string(), "Bearer token".to_string());
	let url_mcp = McpServer::new(
		"sse-mcp",
		McpTransport::Sse {
			url: "http://localhost:3000/sse".to_string(),
			headers: Some(headers),
			timeout: None,
		},
	);
	manager.add_mcp(url_mcp).unwrap();

	// Serialize and check - SSE MCP should now be included
	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();
	let mcp_servers = json.get("mcpServers").unwrap().as_object().unwrap();

	// SSE MCPs are now serialized for Claude with type "sse"
	assert!(mcp_servers.contains_key("sse-mcp"));
	assert_eq!(
		mcp_servers.get("sse-mcp").unwrap().get("type").unwrap(),
		"sse"
	);
}

// ==================== OpenCode Integration Tests ====================

#[test]
fn test_opencode_full_mcp_workflow() {
	let test = TestConfig::new(AgentType::OpenCode).unwrap();
	let mut manager = test.create_manager();

	manager.load().unwrap();

	// Add both command and URL MCPs
	let cmd_mcp = create_test_mcp_stdio("cmd-mcp");
	let url_mcp = create_test_mcp_sse("url-mcp");

	manager.add_mcp(cmd_mcp).unwrap();
	manager.add_mcp(url_mcp).unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 2);

	// Verify types are preserved
	let cmd_ref = config.mcps.iter().find(|m| m.name == "cmd-mcp").unwrap();
	let url_ref = config.mcps.iter().find(|m| m.name == "url-mcp").unwrap();

	assert!(matches!(cmd_ref.transport, McpTransport::Stdio { .. }));
	assert!(matches!(
		url_ref.transport,
		McpTransport::StreamableHttp { .. }
	));

	// Verify URL headers preserved
	match &url_ref.transport {
		McpTransport::StreamableHttp { headers, .. } => {
			assert!(headers.is_some());
			let headers = headers.as_ref().unwrap();
			assert_eq!(
				headers.get("Authorization"),
				Some(&"Bearer test-token".to_string())
			);
		}
		_ => panic!("Expected StreamableHttp transport"),
	}
}

// ==================== Cross-Agent Compatibility Tests ====================

#[test]
fn test_config_round_trip_preserves_enabled_state() {
	let test = TestConfig::new(AgentType::OpenCode).unwrap();
	let mut manager = test.create_manager();

	manager.load().unwrap();

	// Add resources with mixed enabled states
	let enabled_mcp = McpServer {
		name: "enabled-mcp".to_string(),
		enabled: true,
		transport: McpTransport::stdio("echo", vec!["test".to_string()]),
		timeout: None,
		config_source: None,
	};
	let disabled_mcp = McpServer {
		name: "disabled-mcp".to_string(),
		enabled: false,
		transport: McpTransport::stdio("echo", vec!["test".to_string()]),
		timeout: None,
		config_source: None,
	};

	manager.add_mcp(enabled_mcp).unwrap();
	manager.add_mcp(disabled_mcp).unwrap();

	// Round trip
	manager.save_current().unwrap();
	manager.load().unwrap();

	let config = manager.config().unwrap();
	let enabled_ref = config
		.mcps
		.iter()
		.find(|m| m.name == "enabled-mcp")
		.unwrap();
	let disabled_ref = config
		.mcps
		.iter()
		.find(|m| m.name == "disabled-mcp")
		.unwrap();

	assert!(enabled_ref.enabled);
	assert!(!disabled_ref.enabled);
}

#[test]
fn test_duplicate_resource_detection() {
	let test = TestConfig::new(AgentType::Claude).unwrap();
	let mut manager = test.create_manager();

	manager.load().unwrap();

	let mcp = create_test_mcp_stdio("duplicate");
	manager.add_mcp(mcp.clone()).unwrap();

	// Adding duplicate should fail
	let result = manager.add_mcp(mcp);
	assert!(result.is_err());
	assert!(result.unwrap_err().to_string().contains("already exists"));
}

#[test]
fn test_missing_resource_detection() {
	let test = TestConfig::new(AgentType::Claude).unwrap();
	let mut manager = test.create_manager();

	manager.load().unwrap();

	// Operations on non-existent resources should fail
	let result = manager.remove_mcp("nonexistent");
	assert!(result.is_err());
	assert!(result.unwrap_err().to_string().contains("not found"));

	let result = manager.update_skill("nonexistent", create_test_skill("test"));
	assert!(result.is_err());
}

// ==================== Agent Validation Tests ====================

// These tests require actual CLI binaries in PATH
// Run with: cargo test --features agent-validation

#[cfg(feature = "agent-validation")]
#[test]
fn test_claude_config_validation() {
	let test = TestConfig::new(AgentType::Claude).unwrap();
	let mut manager = test.create_manager();

	manager.load().unwrap();

	// Add a valid MCP
	let mcp = create_test_mcp_stdio("test");
	manager.add_mcp(mcp).unwrap();

	// Validate with Claude CLI
	manager
		.validate()
		.expect("Claude should accept the configuration");
}

#[cfg(feature = "agent-validation")]
#[test]
fn test_opencode_config_validation() {
	let test = TestConfig::new(AgentType::OpenCode).unwrap();
	let mut manager = test.create_manager();

	manager.load().unwrap();

	// Add valid resources
	let mcp = create_test_mcp_stdio("test");
	let skill = create_test_skill("test-skill");

	manager.add_mcp(mcp).unwrap();
	manager.add_skill(skill).unwrap();

	// Validate with OpenCode CLI
	manager
		.validate()
		.expect("OpenCode should accept the configuration");
}

#[test]
fn test_invalid_config_fails_validation() {
	// Write invalid JSON directly
	let test = TestConfigBuilder::new(AgentType::Claude)
		.with_content("{ invalid json }")
		.build()
		.unwrap();

	let mut manager = test.create_manager();

	// Load should fail
	let result = manager.load();
	assert!(result.is_err());
}

// ==================== Edge Case Tests ====================

#[test]
fn test_empty_config_handling() {
	let test = TestConfig::new(AgentType::Claude).unwrap();
	let mut manager = test.create_manager();

	// Load empty config
	manager.load().unwrap();
	let config = manager.config().unwrap();

	assert!(config.mcps.is_empty());
	// Skills are loaded from isolated test directory, which is empty
	assert!(config.skills.is_empty());
}

#[test]
fn test_mcp_with_env_vars() {
	let test = TestConfig::new(AgentType::OpenCode).unwrap();
	let mut manager = test.create_manager();

	manager.load().unwrap();

	let mut env = HashMap::new();
	env.insert("API_KEY".to_string(), "secret123".to_string());
	env.insert("DEBUG".to_string(), "true".to_string());

	let mcp = McpServer {
		name: "env-mcp".to_string(),
		enabled: true,
		transport: McpTransport::Stdio {
			command: "my-server".to_string(),
			args: vec!["--port".to_string(), "8080".to_string()],
			env: Some(env),
			timeout: None,
		},
		timeout: None,
		config_source: None,
	};

	manager.add_mcp(mcp).unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	let saved_mcp = config.mcps.iter().find(|m| m.name == "env-mcp").unwrap();

	match &saved_mcp.transport {
		McpTransport::Stdio { env, .. } => {
			assert!(env.is_some());
			let env = env.as_ref().unwrap();
			assert_eq!(env.get("API_KEY"), Some(&"secret123".to_string()));
			assert_eq!(env.get("DEBUG"), Some(&"true".to_string()));
		}
		_ => panic!("Expected stdio transport with env"),
	}
}

#[test]
fn test_special_characters_in_names() {
	let test = TestConfig::new(AgentType::OpenCode).unwrap();
	let mut manager = test.create_manager();

	manager.load().unwrap();

	// Test names with special characters
	let names = vec!["my-mcp-server", "my_mcp_server", "mcp.server", "mcp123"];

	for name in &names {
		let mcp = create_test_mcp_stdio(name);
		manager.add_mcp(mcp).unwrap();
		manager.load().unwrap();
	}

	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), names.len());
}

#[test]
fn test_concurrent_modifications_preserve_state() {
	// Use OpenCode for this test since it preserves disabled state
	let test = TestConfig::new(AgentType::OpenCode).unwrap();
	let mut manager = test.create_manager();

	manager.load().unwrap();

	// Add multiple resources
	for i in 0..5 {
		let mcp = create_test_mcp_stdio(&format!("mcp{}", i));
		manager.add_mcp(mcp).unwrap();
	}

	// Disable some
	manager.disable_mcp("mcp1").unwrap();
	manager.disable_mcp("mcp3").unwrap();

	// Add more after disabling
	for i in 5..10 {
		let mcp = create_test_mcp_stdio(&format!("mcp{}", i));
		manager.add_mcp(mcp).unwrap();
	}

	// Verify final state
	manager.load().unwrap();
	let config = manager.config().unwrap();

	assert_eq!(config.mcps.len(), 10);

	// Check disabled status preserved
	let mcp1 = config.mcps.iter().find(|m| m.name == "mcp1").unwrap();
	let mcp2 = config.mcps.iter().find(|m| m.name == "mcp2").unwrap();
	let mcp3 = config.mcps.iter().find(|m| m.name == "mcp3").unwrap();

	assert!(!mcp1.enabled);
	assert!(mcp2.enabled);
	assert!(!mcp3.enabled);
}

// ==================== Streamable HTTP Transport Tests ====================

#[test]
fn test_claude_streamable_http_mcp_workflow() {
	let test = TestConfig::new(AgentType::Claude).unwrap();
	let mut manager = test.create_manager();

	manager.load().unwrap();

	// Add Streamable HTTP MCP
	let http_mcp = create_test_mcp_streamable_http("http-mcp");
	manager.add_mcp(http_mcp.clone()).unwrap();

	// Serialize and check - Streamable HTTP MCP should be included with type "http"
	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();
	let mcp_servers = json.get("mcpServers").unwrap().as_object().unwrap();

	assert!(mcp_servers.contains_key("http-mcp"));
	assert_eq!(
		mcp_servers.get("http-mcp").unwrap().get("type").unwrap(),
		"http"
	);

	// Load and verify type is preserved
	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);

	let saved_mcp = &config.mcps[0];
	assert!(matches!(
		saved_mcp.transport,
		McpTransport::StreamableHttp { .. }
	));

	match &saved_mcp.transport {
		McpTransport::StreamableHttp { url, headers, .. } => {
			assert_eq!(url, "http://localhost:3000/mcp");
			assert!(headers.is_some());
			let headers = headers.as_ref().unwrap();
			assert_eq!(
				headers.get("Authorization"),
				Some(&"Bearer test-token".to_string())
			);
			assert_eq!(headers.get("X-API-Version"), Some(&"v1".to_string()));
		}
		_ => panic!("Expected StreamableHttp transport"),
	}

	// Update the MCP
	let mut updated_mcp = http_mcp.clone();
	let mut new_headers = HashMap::new();
	new_headers
		.insert("Authorization".to_string(), "Bearer new-token".to_string());
	updated_mcp.transport = McpTransport::streamable_http_with_headers(
		"http://localhost:4000/mcp",
		new_headers,
	);

	manager.update_mcp("http-mcp", updated_mcp).unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	let mcp_ref = config.mcps.iter().find(|m| m.name == "http-mcp").unwrap();

	match &mcp_ref.transport {
		McpTransport::StreamableHttp { url, headers, .. } => {
			assert_eq!(url, "http://localhost:4000/mcp");
			assert_eq!(
				headers.as_ref().unwrap().get("Authorization"),
				Some(&"Bearer new-token".to_string())
			);
		}
		_ => panic!("Expected StreamableHttp transport"),
	}

	// Delete MCP
	manager.remove_mcp("http-mcp").unwrap();
	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert!(config.mcps.is_empty());
}

#[test]
fn test_opencode_streamable_http_roundtrip() {
	let test = TestConfig::new(AgentType::OpenCode).unwrap();
	let mut manager = test.create_manager();

	manager.load().unwrap();

	// Add Streamable HTTP MCP
	let http_mcp = create_test_mcp_streamable_http("streamable-mcp");
	manager.add_mcp(http_mcp.clone()).unwrap();

	// Load and verify
	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);

	let saved_mcp = &config.mcps[0];
	assert!(matches!(
		saved_mcp.transport,
		McpTransport::StreamableHttp { .. }
	));

	// Serialize and verify JSON structure (OpenCode native format uses "mcp" object)
	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();
	let mcp_obj = json.get("mcp").unwrap().as_object().unwrap();

	assert_eq!(mcp_obj.len(), 1);
	let mcp = mcp_obj.get("streamable-mcp").unwrap();
	assert_eq!(mcp.get("type").unwrap(), "remote");
}

#[test]
fn test_legacy_sse_backward_compatibility() {
	// Test that legacy SSE configs still work
	let test = TestConfig::new(AgentType::Claude).unwrap();

	// Write a legacy SSE config directly
	let legacy_config = r#"{
        "mcpServers": {
            "legacy-sse": {
                "type": "sse",
                "url": "http://localhost:3000/sse",
                "headers": {
                    "Authorization": "Bearer legacy-token"
                }
            }
        }
    }"#;

	test.write_config(legacy_config).unwrap();

	let mut manager = test.create_manager();
	manager.load().unwrap();

	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);

	let mcp = &config.mcps[0];
	assert_eq!(mcp.name, "legacy-sse");
	assert!(matches!(mcp.transport, McpTransport::Sse { .. }));

	match &mcp.transport {
		McpTransport::Sse { url, headers, .. } => {
			assert_eq!(url, "http://localhost:3000/sse");
			assert_eq!(
				headers.as_ref().unwrap().get("Authorization"),
				Some(&"Bearer legacy-token".to_string())
			);
		}
		_ => panic!("Expected SSE transport"),
	}
}

// ==================== Standard MCP Workflow Tests ====================
// Generated via macro to eliminate ~20 duplicate test functions (~350 lines)

test_mcp_workflow! {
	test_antigravity_mcp_workflow => AgentType::Antigravity, "ag-mcp",
	test_codex_mcp_workflow => AgentType::Codex, "codex-mcp",
	test_kiro_mcp_workflow => AgentType::Kiro, "kiro-mcp",
	test_cursor_mcp_workflow => AgentType::Cursor, "cursor-mcp",
	test_windsurf_mcp_workflow => AgentType::Windsurf, "windsurf-mcp",
	test_roocode_mcp_workflow => AgentType::RooCode, "roocode-mcp",
	test_cline_mcp_workflow => AgentType::Cline, "cline-mcp",
	test_gemini_mcp_workflow => AgentType::Gemini, "gemini-mcp",
	test_kilocode_mcp_workflow => AgentType::KiloCode, "kilocode-mcp",
	test_factory_mcp_workflow => AgentType::Factory, "factory-mcp",
	test_kimi_mcp_workflow => AgentType::Kimi, "kimi-mcp",
	test_mistral_mcp_workflow => AgentType::Mistral, "mistral-mcp",
	test_amp_mcp_workflow => AgentType::Amp, "amp-mcp",
	test_augmentcode_mcp_workflow => AgentType::AugmentCode, "augmentcode-mcp",
	test_warp_mcp_workflow => AgentType::Warp, "warp-mcp",
	test_trae_mcp_workflow => AgentType::Trae, "trae-mcp",
	test_jetbrains_ai_mcp_workflow => AgentType::JetBrainsAi, "jetbrains-ai-mcp",
}

#[test]
fn test_pi_rejects_mcp_workflow() {
	let test = TestConfig::new(AgentType::Pi).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	let err = manager
		.add_mcp(create_test_mcp_stdio("pi-mcp"))
		.unwrap_err();
	assert!(matches!(
		err,
		aghub_core::errors::ConfigError::UnsupportedOperation(_)
	));
}

// ==================== Special Case: Agent-Specific Key Tests ====================

#[test]
fn test_zed_mcp_uses_context_servers_key() {
	let test = TestConfig::new(AgentType::Zed).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	let mcp = create_test_mcp_stdio("zed-mcp");
	manager.add_mcp(mcp).unwrap();

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();
	assert!(json.get("context_servers").is_some());
	let servers = json.get("context_servers").unwrap().as_object().unwrap();
	assert!(servers.contains_key("zed-mcp"));
}

#[test]
fn test_copilot_mcp_uses_servers_key() {
	let test = TestConfig::new(AgentType::Copilot).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	let mcp = create_test_mcp_stdio("copilot-mcp");
	manager.add_mcp(mcp).unwrap();

	let content = test.read_config().unwrap();
	assert!(content.contains("\"servers\""));

	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert_eq!(config.mcps[0].name, "copilot-mcp");

	manager.remove_mcp("copilot-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

// ==================== Special Case: Multiple Transport Types ====================

#[test]
fn test_openclaw_mcp_with_stdio_and_sse() {
	let test = TestConfig::new(AgentType::Openclaw).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	let mcp = create_test_mcp_stdio("openclaw-mcp");
	manager.add_mcp(mcp).unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);

	let sse_mcp = create_test_mcp_sse("openclaw-sse");
	manager.add_mcp(sse_mcp).unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 2);

	manager.remove_mcp("openclaw-mcp").unwrap();
	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert_eq!(config.mcps[0].name, "openclaw-sse");
}

// ==================== Skill Discovery Tests ====================
// Ported from list-installed.test.ts and full-depth-discovery.test.ts

#[test]
fn test_multiple_skills_loaded() {
	let test = TestConfig::new(AgentType::Claude).unwrap();

	test.create_test_skill("skill-1", Some("First skill"))
		.unwrap();
	test.create_test_skill("skill-2", Some("Second skill"))
		.unwrap();

	let mut manager = test.create_manager();
	manager.load().unwrap();

	let config = manager.config().unwrap();
	assert_eq!(config.skills.len(), 2);

	let names: Vec<&str> =
		config.skills.iter().map(|s| s.name.as_str()).collect();
	assert!(names.contains(&"skill-1"));
	assert!(names.contains(&"skill-2"));
}

#[test]
fn test_dir_without_skill_md_ignored() {
	let test = TestConfig::new(AgentType::Claude).unwrap();

	// Create a valid skill
	test.create_test_skill("valid-skill", Some("Valid skill"))
		.unwrap();

	// Create a directory without SKILL.md (should be ignored)
	let empty_dir = test.skills_dir().join("not-a-skill");
	std::fs::create_dir(&empty_dir).unwrap();
	std::fs::write(empty_dir.join("other-file.txt"), "content").unwrap();

	let mut manager = test.create_manager();
	manager.load().unwrap();

	let config = manager.config().unwrap();
	assert_eq!(
		config.skills.len(),
		1,
		"Only the valid skill should be loaded"
	);
	assert_eq!(config.skills[0].name, "valid-skill");
}

#[test]
fn test_invalid_skill_md_graceful() {
	let test = TestConfig::new(AgentType::Claude).unwrap();

	// Create a valid skill
	test.create_test_skill("valid-skill", Some("Valid skill"))
		.unwrap();

	// Create a skill dir with a SKILL.md that has no frontmatter
	let invalid_dir = test.skills_dir().join("invalid-skill");
	std::fs::create_dir(&invalid_dir).unwrap();
	std::fs::write(
		invalid_dir.join("SKILL.md"),
		"# No Frontmatter\nJust markdown content.",
	)
	.unwrap();

	let mut manager = test.create_manager();
	manager.load().unwrap();

	// Invalid skill should be silently skipped; valid skill still loads
	let config = manager.config().unwrap();
	assert_eq!(
		config.skills.len(),
		1,
		"Invalid SKILL.md should be skipped, valid skill should load"
	);
	assert_eq!(config.skills[0].name, "valid-skill");
}

#[test]
fn test_empty_skills_dir_loads_zero_skills() {
	let test = TestConfig::new(AgentType::Claude).unwrap();

	let mut manager = test.create_manager();
	manager.load().unwrap();

	let config = manager.config().unwrap();
	assert!(
		config.skills.is_empty(),
		"Empty skills dir should yield no skills"
	);
}
