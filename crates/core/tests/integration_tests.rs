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

fn create_test_skill(name: &str) -> Skill {
	Skill {
		name: name.to_string(),
		enabled: true,
		description: Some(format!("Test skill: {}", name)),
		author: Some("test-author".to_string()),
		version: Some("1.0.0".to_string()),
		tools: vec!["tool1".to_string(), "tool2".to_string()],
		metadata: None,
	}
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
	assert!(matches!(url_ref.transport, McpTransport::Sse { .. }));

	// Verify URL headers preserved
	match &url_ref.transport {
		McpTransport::Sse { headers, .. } => {
			assert!(headers.is_some());
			let headers = headers.as_ref().unwrap();
			assert_eq!(
				headers.get("Authorization"),
				Some(&"Bearer test-token".to_string())
			);
		}
		_ => panic!("Expected SSE transport"),
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
	};
	let disabled_mcp = McpServer {
		name: "disabled-mcp".to_string(),
		enabled: false,
		transport: McpTransport::stdio("echo", vec!["test".to_string()]),
		timeout: None,
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

	// Serialize and verify JSON structure
	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();
	let mcp_servers = json.get("mcp_servers").unwrap().as_array().unwrap();

	assert_eq!(mcp_servers.len(), 1);
	let mcp = &mcp_servers[0];
	assert_eq!(mcp.get("name").unwrap(), "streamable-mcp");
	assert_eq!(mcp.get("type").unwrap(), "streamable_http");
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

// ==================== Antigravity Integration Tests ====================

#[test]
fn test_antigravity_mcp_workflow() {
	let test = TestConfig::new(AgentType::Antigravity).unwrap();
	let mut manager = test.create_manager();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert!(config.mcps.is_empty());

	// Add MCP server
	let mcp = create_test_mcp_stdio("ag-mcp");
	manager.add_mcp(mcp).unwrap();

	// Reload and verify
	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert_eq!(config.mcps[0].name, "ag-mcp");

	// Delete and verify
	manager.remove_mcp("ag-mcp").unwrap();
	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert!(config.mcps.is_empty());
}

// ==================== Codex Integration Tests ====================

#[test]
fn test_codex_mcp_workflow() {
	let test = TestConfig::new(AgentType::Codex).unwrap();
	let mut manager = test.create_manager();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert!(config.mcps.is_empty());

	let mcp = create_test_mcp_stdio("codex-mcp");
	manager.add_mcp(mcp).unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert_eq!(config.mcps[0].name, "codex-mcp");

	manager.remove_mcp("codex-mcp").unwrap();
	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert!(config.mcps.is_empty());
}

// ==================== Openclaw Integration Tests ====================

#[test]
fn test_openclaw_mcp_workflow() {
	let test = TestConfig::new(AgentType::Openclaw).unwrap();
	let mut manager = test.create_manager();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert!(config.mcps.is_empty());

	let mcp = create_test_mcp_stdio("openclaw-mcp");
	manager.add_mcp(mcp).unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert_eq!(config.mcps[0].name, "openclaw-mcp");

	// Add SSE MCP too
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

// ==================== New Agent Integration Tests ====================

#[test]
fn test_kiro_mcp_workflow() {
	let test = TestConfig::new(AgentType::Kiro).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());

	let mcp = create_test_mcp_stdio("kiro-mcp");
	manager.add_mcp(mcp).unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert_eq!(config.mcps[0].name, "kiro-mcp");

	manager.remove_mcp("kiro-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}


#[test]
fn test_zed_mcp_workflow() {
	let test = TestConfig::new(AgentType::Zed).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	// Zed uses "context_servers" key
	let mcp = create_test_mcp_stdio("zed-mcp");
	manager.add_mcp(mcp).unwrap();

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();
	// Zed serializes under "context_servers"
	assert!(json.get("context_servers").is_some());
	let servers = json.get("context_servers").unwrap().as_object().unwrap();
	assert!(servers.contains_key("zed-mcp"));
}

// ==================== Cursor Integration Tests ====================

#[test]
fn test_cursor_mcp_workflow() {
	let test = TestConfig::new(AgentType::Cursor).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	// Add MCP server
	let mcp = create_test_mcp_stdio("cursor-mcp");
	manager.add_mcp(mcp).unwrap();

	// Reload and verify
	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert_eq!(config.mcps[0].name, "cursor-mcp");

	// Delete and verify
	manager.remove_mcp("cursor-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

// ==================== Windsurf Integration Tests ====================

#[test]
fn test_windsurf_mcp_workflow() {
	let test = TestConfig::new(AgentType::Windsurf).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	// Add MCP server
	let mcp = create_test_mcp_stdio("windsurf-mcp");
	manager.add_mcp(mcp).unwrap();

	// Reload and verify
	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert_eq!(config.mcps[0].name, "windsurf-mcp");

	// Delete and verify
	manager.remove_mcp("windsurf-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

// ==================== Copilot Integration Tests ====================

#[test]
fn test_copilot_mcp_workflow() {
	let test = TestConfig::new(AgentType::Copilot).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	// Add MCP server
	let mcp = create_test_mcp_stdio("copilot-mcp");
	manager.add_mcp(mcp).unwrap();

	// Verify it uses "servers" key
	let content = test.read_config().unwrap();
	assert!(content.contains("\"servers\""), "Copilot must use 'servers' key");

	// Reload and verify
	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert_eq!(config.mcps[0].name, "copilot-mcp");

	// Delete and verify
	manager.remove_mcp("copilot-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

// ==================== RooCode Integration Tests ====================

#[test]
fn test_roocode_mcp_workflow() {
	let test = TestConfig::new(AgentType::RooCode).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	// Add MCP server
	let mcp = create_test_mcp_stdio("roocode-mcp");
	manager.add_mcp(mcp).unwrap();

	// Reload and verify
	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert_eq!(config.mcps[0].name, "roocode-mcp");

	// Delete and verify
	manager.remove_mcp("roocode-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

// ==================== Cline Integration Tests ====================

#[test]
fn test_cline_mcp_workflow() {
	let test = TestConfig::new(AgentType::Cline).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	// Add MCP server
	let mcp = create_test_mcp_stdio("cline-mcp");
	manager.add_mcp(mcp).unwrap();

	// Reload and verify
	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert_eq!(config.mcps[0].name, "cline-mcp");

	// Delete and verify
	manager.remove_mcp("cline-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

// ==================== Gemini Integration Tests ====================

#[test]
fn test_gemini_mcp_workflow() {
	let test = TestConfig::new(AgentType::Gemini).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	// Add MCP server
	let mcp = create_test_mcp_stdio("gemini-mcp");
	manager.add_mcp(mcp).unwrap();

	// Reload and verify
	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert_eq!(config.mcps[0].name, "gemini-mcp");

	// Delete and verify
	manager.remove_mcp("gemini-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

// ==================== KiloCode Integration Tests ====================

#[test]
fn test_kilocode_mcp_workflow() {
	let test = TestConfig::new(AgentType::KiloCode).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	// Add MCP server
	let mcp = create_test_mcp_stdio("kilocode-mcp");
	manager.add_mcp(mcp).unwrap();

	// Reload and verify
	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert_eq!(config.mcps[0].name, "kilocode-mcp");

	// Delete and verify
	manager.remove_mcp("kilocode-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

// ==================== Factory Integration Tests ====================

#[test]
fn test_factory_mcp_workflow() {
	let test = TestConfig::new(AgentType::Factory).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	// Add MCP server
	let mcp = create_test_mcp_stdio("factory-mcp");
	manager.add_mcp(mcp).unwrap();

	// Reload and verify
	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert_eq!(config.mcps[0].name, "factory-mcp");

	// Delete and verify
	manager.remove_mcp("factory-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

// ==================== Mistral Integration Tests ====================

#[test]
fn test_mistral_mcp_workflow() {
	let test = TestConfig::new(AgentType::Mistral).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	// Add MCP server (Mistral uses TOML format)
	let mcp = create_test_mcp_stdio("mistral-mcp");
	manager.add_mcp(mcp).unwrap();

	// Reload and verify
	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert_eq!(config.mcps[0].name, "mistral-mcp");

	// Delete and verify
	manager.remove_mcp("mistral-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

// ==================== Amp Integration Tests ====================

#[test]
fn test_amp_mcp_workflow() {
	let test = TestConfig::new(AgentType::Amp).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	let mcp = create_test_mcp_stdio("amp-mcp");
	manager.add_mcp(mcp).unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert_eq!(config.mcps[0].name, "amp-mcp");

	manager.remove_mcp("amp-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

// ==================== Pi Integration Tests ====================

#[test]
fn test_pi_mcp_workflow() {
	let test = TestConfig::new(AgentType::Pi).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	let mcp = create_test_mcp_stdio("pi-mcp");
	manager.add_mcp(mcp).unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert_eq!(config.mcps[0].name, "pi-mcp");

	manager.remove_mcp("pi-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

// ==================== AugmentCode Integration Tests ====================

#[test]
fn test_augmentcode_mcp_workflow() {
	let test = TestConfig::new(AgentType::AugmentCode).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	let mcp = create_test_mcp_stdio("augmentcode-mcp");
	manager.add_mcp(mcp).unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert_eq!(config.mcps[0].name, "augmentcode-mcp");

	manager.remove_mcp("augmentcode-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

// ==================== Warp Integration Tests ====================

#[test]
fn test_warp_mcp_workflow() {
	let test = TestConfig::new(AgentType::Warp).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	let mcp = create_test_mcp_stdio("warp-mcp");
	manager.add_mcp(mcp).unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert_eq!(config.mcps[0].name, "warp-mcp");

	manager.remove_mcp("warp-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

// ==================== Trae Integration Tests ====================

#[test]
fn test_trae_mcp_workflow() {
	let test = TestConfig::new(AgentType::Trae).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	let mcp = create_test_mcp_stdio("trae-mcp");
	manager.add_mcp(mcp).unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert_eq!(config.mcps[0].name, "trae-mcp");

	manager.remove_mcp("trae-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

// ==================== JetBrainsAi Integration Tests ====================

#[test]
fn test_jetbrains_ai_mcp_workflow() {
	let test = TestConfig::new(AgentType::JetBrainsAi).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	let mcp = create_test_mcp_stdio("jetbrains-ai-mcp");
	manager.add_mcp(mcp).unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert_eq!(config.mcps[0].name, "jetbrains-ai-mcp");

	manager.remove_mcp("jetbrains-ai-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

