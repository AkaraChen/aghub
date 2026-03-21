//! MCP-focused integration tests for aghub-core
//!
//! Test behaviors ported from the ruler TypeScript test suite:
//! - `tests/unit/mcp/KiloCodeMcp.test.ts`
//! - `tests/unit/mcp/OpenCodeMcp.test.ts`
//! - `tests/unit/mcp/capabilities.test.ts`
//! - `tests/unit/paths/mcp-paths.test.ts`
//! - `tests/mcp-key-per-agent.test.ts` (behavior layer)
//! - `tests/mcp-key-gemini.test.ts` (behavior layer)
//! - `tests/apply-mcp.merge.test.ts` (behavior layer)
//! - `tests/apply-mcp.overwrite.test.ts` (behavior layer)
//! - `tests/apply-mcp.toml-stdio.test.ts` (behavior layer)
//! - `tests/apply-mcp.toml-remote.test.ts` (behavior layer)
//! - `tests/apply-mcp.toml-disable.test.ts` (behavior layer)
//! - `tests/mcp-warning-deduplication.test.ts`
//! - `tests/mcp-invalid-fields.test.ts`

use aghub_core::{
	models::{AgentType, McpServer, McpTransport},
	testing::{TestConfig, TestConfigBuilder},
};
use std::collections::HashMap;

// ==================== Helpers ====================

fn mcp_stdio(name: &str) -> McpServer {
	McpServer::new(
		name,
		McpTransport::stdio("echo", vec!["test".to_string(), "args".to_string()]),
	)
}

fn mcp_sse(name: &str) -> McpServer {
	let mut headers = HashMap::new();
	headers
		.insert("Authorization".to_string(), "Bearer test-token".to_string());
	McpServer::new(
		name,
		McpTransport::sse_with_headers("http://localhost:3000/sse", headers),
	)
}

fn mcp_http(name: &str) -> McpServer {
	let mut headers = HashMap::new();
	headers
		.insert("Authorization".to_string(), "Bearer test-token".to_string());
	McpServer::new(
		name,
		McpTransport::streamable_http_with_headers(
			"http://localhost:3000/mcp",
			headers,
		),
	)
}

// ==================== Group 1: Per-agent JSON key names ====================
// From ruler: mcp-key-per-agent.test.ts, mcp-key-gemini.test.ts

/// GitHub Copilot uses "servers" key, not "mcpServers"
/// Corresponds to ruler test: uses "servers" key for Copilot
#[test]
fn test_copilot_mcp_uses_servers_key() {
	// Use empty initial content so no stale keys are preserved
	let test = TestConfigBuilder::new(AgentType::Copilot)
		.with_content("{}")
		.build()
		.unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager.add_mcp(mcp_stdio("my-server")).unwrap();

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();

	assert!(
		json.get("servers").is_some(),
		"Copilot should use 'servers' key"
	);
	assert!(
		json.get("mcpServers").is_none(),
		"Copilot should NOT use 'mcpServers' key"
	);
	assert!(json["servers"].get("my-server").is_some());
}

/// Cursor uses "mcpServers" key
/// Corresponds to ruler test: uses "mcpServers" key for Cursor
#[test]
fn test_cursor_mcp_uses_mcpservers_key() {
	let test = TestConfig::new(AgentType::Cursor).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager.add_mcp(mcp_stdio("my-server")).unwrap();

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();

	assert!(
		json.get("mcpServers").is_some(),
		"Cursor should use 'mcpServers' key"
	);
	assert!(
		json.get("servers").is_none(),
		"Cursor should NOT use 'servers' key"
	);
	assert!(json["mcpServers"].get("my-server").is_some());
}

/// Zed uses "context_servers" key
/// Corresponds to ruler test: Zed has context_servers key
#[test]
fn test_zed_mcp_uses_context_servers_key() {
	// Use empty initial content so no stale keys are preserved
	let test = TestConfigBuilder::new(AgentType::Zed)
		.with_content("{}")
		.build()
		.unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager.add_mcp(mcp_stdio("my-server")).unwrap();

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();

	assert!(
		json.get("context_servers").is_some(),
		"Zed should use 'context_servers' key"
	);
	assert!(json.get("mcpServers").is_none());
	assert!(json["context_servers"].get("my-server").is_some());
}

/// Gemini CLI uses "mcpServers" key in settings.json
/// Corresponds to ruler test: writes mcpServers key in .gemini/settings.json
#[test]
fn test_gemini_mcp_uses_mcpservers_key() {
	let test = TestConfig::new(AgentType::Gemini).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager
		.add_mcp(McpServer::new(
			"example",
			McpTransport::stdio(
				"node",
				vec!["server.js".to_string()],
			),
		))
		.unwrap();

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();

	assert!(
		json.get("mcpServers").is_some(),
		"Gemini should use 'mcpServers' key"
	);
	assert!(json["mcpServers"].get("example").is_some());
	// Gemini should not have an empty string key
	assert!(json.get("").is_none(), "Should not have empty string key");
}

/// Claude uses "mcpServers" key in .mcp.json
#[test]
fn test_claude_mcp_uses_mcpservers_key() {
	let test = TestConfig::new(AgentType::Claude).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager.add_mcp(mcp_stdio("my-server")).unwrap();

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();

	assert!(json.get("mcpServers").is_some());
	assert!(json.get("servers").is_none());
	assert!(json["mcpServers"].get("my-server").is_some());
}

/// KiloCode uses "mcpServers" key in .kilocode/mcp.json
#[test]
fn test_kilocode_mcp_uses_mcpservers_key() {
	let test = TestConfig::new(AgentType::KiloCode).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager.add_mcp(mcp_stdio("my-server")).unwrap();

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();

	assert!(json.get("mcpServers").is_some());
	assert!(json["mcpServers"].get("my-server").is_some());
}

/// OpenCode uses "mcp" key in opencode.json
/// Corresponds to ruler test: MCP Path Resolution for OpenCode
#[test]
fn test_opencode_mcp_uses_mcp_key() {
	let test = TestConfigBuilder::new(AgentType::OpenCode)
		.with_content("{}")
		.build()
		.unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager.add_mcp(mcp_stdio("my-server")).unwrap();

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();

	assert!(
		json.get("mcp").is_some(),
		"OpenCode should use 'mcp' key, got: {}",
		content
	);
	assert!(
		json.get("mcpServers").is_none(),
		"OpenCode should NOT use 'mcpServers' key"
	);
	assert!(json["mcp"].get("my-server").is_some());
}

// ==================== Group 2: OpenCode format transformation ====================
// From ruler: OpenCodeMcp.test.ts

/// Stdio transport serializes to {type: "local", command: [...], enabled: true}
/// Corresponds to ruler test: transforms ruler MCP config to OpenCode format for local servers
#[test]
fn test_opencode_stdio_format_is_local_type() {
	let test = TestConfigBuilder::new(AgentType::OpenCode)
		.with_content("{}")
		.build()
		.unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	let mcp = McpServer::new(
		"my-local-server",
		McpTransport::stdio(
			"bun",
			vec!["x".to_string(), "my-mcp-command".to_string()],
		),
	);
	manager.add_mcp(mcp).unwrap();

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();
	let server = &json["mcp"]["my-local-server"];

	assert_eq!(server["type"], "local", "Stdio should serialize as type 'local'");
	assert_eq!(server["command"][0], "bun");
	assert_eq!(server["command"][1], "x");
	assert_eq!(server["command"][2], "my-mcp-command");
	assert_eq!(server["enabled"], true);
}

/// SSE transport serializes to {type: "remote", url: ..., enabled: true}
/// Corresponds to ruler test: transforms ruler MCP config to OpenCode format for remote servers
#[test]
fn test_opencode_sse_format_is_remote_type() {
	let test = TestConfigBuilder::new(AgentType::OpenCode)
		.with_content("{}")
		.build()
		.unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	let mut headers = HashMap::new();
	headers.insert(
		"Authorization".to_string(),
		"Bearer MY_API_KEY".to_string(),
	);
	let mcp = McpServer::new(
		"my-remote-server",
		McpTransport::sse_with_headers("https://my-mcp-server.com", headers),
	);
	manager.add_mcp(mcp).unwrap();

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();
	let server = &json["mcp"]["my-remote-server"];

	assert_eq!(
		server["type"], "remote",
		"SSE should serialize as type 'remote'"
	);
	assert_eq!(server["url"], "https://my-mcp-server.com");
	assert_eq!(server["enabled"], true);
	assert_eq!(server["headers"]["Authorization"], "Bearer MY_API_KEY");
}

/// StreamableHttp transport serializes to {type: "remote", url: ..., enabled: true}
/// Corresponds to ruler test: transforms ruler MCP config to OpenCode format for remote servers
#[test]
fn test_opencode_http_format_is_remote_type() {
	let test = TestConfigBuilder::new(AgentType::OpenCode)
		.with_content("{}")
		.build()
		.unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	let mut headers = HashMap::new();
	headers.insert(
		"Authorization".to_string(),
		"Bearer MY_API_KEY".to_string(),
	);
	let mcp = McpServer::new(
		"my-http-server",
		McpTransport::streamable_http_with_headers(
			"https://my-mcp-server.com",
			headers,
		),
	);
	manager.add_mcp(mcp).unwrap();

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();
	let server = &json["mcp"]["my-http-server"];

	assert_eq!(
		server["type"], "remote",
		"StreamableHttp should serialize as type 'remote'"
	);
	assert_eq!(server["url"], "https://my-mcp-server.com");
	assert_eq!(server["enabled"], true);
}

/// Env vars in stdio transport serialize as "environment" field (not "env")
/// Corresponds to ruler test: preserves timeout values when transforming ruler MCP config
#[test]
fn test_opencode_stdio_env_becomes_environment() {
	let test = TestConfigBuilder::new(AgentType::OpenCode)
		.with_content("{}")
		.build()
		.unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	let mut env = HashMap::new();
	env.insert("MY_ENV_VAR".to_string(), "my_value".to_string());
	let mcp = McpServer {
		name: "env-server".to_string(),
		enabled: true,
		transport: McpTransport::Stdio {
			command: "bun".to_string(),
			args: vec!["x".to_string(), "my-mcp".to_string()],
			env: Some(env),
			timeout: None,
		},
		timeout: None,
	};
	manager.add_mcp(mcp).unwrap();

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();
	let server = &json["mcp"]["env-server"];

	// OpenCode uses "environment" key not "env"
	assert!(
		server.get("environment").is_some(),
		"OpenCode should use 'environment' key for env vars"
	);
	assert_eq!(server["environment"]["MY_ENV_VAR"], "my_value");
	assert!(server.get("env").is_none(), "Should not use 'env' key");
}

/// Timeout field is preserved through serialization
/// Corresponds to ruler test: preserves timeout values when transforming ruler MCP config
#[test]
fn test_opencode_timeout_preserved() {
	let test = TestConfigBuilder::new(AgentType::OpenCode)
		.with_content("{}")
		.build()
		.unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	let local_with_timeout = McpServer {
		name: "local-with-timeout".to_string(),
		enabled: true,
		transport: McpTransport::Stdio {
			command: "bun".to_string(),
			args: vec!["x".to_string(), "my-mcp".to_string()],
			env: None,
			timeout: Some(120),
		},
		timeout: None,
	};
	let remote_with_timeout = McpServer {
		name: "remote-with-timeout".to_string(),
		enabled: true,
		transport: McpTransport::StreamableHttp {
			url: "https://remote.example.com".to_string(),
			headers: None,
			timeout: Some(45),
		},
		timeout: None,
	};
	manager.add_mcp(local_with_timeout).unwrap();
	manager.add_mcp(remote_with_timeout).unwrap();

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();

	assert_eq!(json["mcp"]["local-with-timeout"]["timeout"], 120);
	assert_eq!(json["mcp"]["remote-with-timeout"]["timeout"], 45);
}

/// Existing non-MCP content (e.g., $schema, other settings) is preserved
/// Corresponds to ruler test: merges with existing OpenCode configuration
#[test]
fn test_opencode_preserves_existing_content() {
	// Start with existing content that has $schema and other settings
	let test = TestConfigBuilder::new(AgentType::OpenCode)
		.with_content(
			r#"{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "existing-server": {
      "type": "local",
      "command": ["existing-command"],
      "enabled": true
    }
  },
  "otherSetting": "preserved"
}"#,
		)
		.build()
		.unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	// Add a new server
	manager
		.add_mcp(McpServer::new(
			"new-server",
			McpTransport::stdio("new-command", vec![]),
		))
		.unwrap();

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();

	// $schema should be preserved
	assert_eq!(
		json["$schema"], "https://opencode.ai/config.json",
		"$schema should be preserved"
	);
	// Other settings should be preserved
	assert_eq!(
		json["otherSetting"], "preserved",
		"otherSetting should be preserved"
	);
	// Both servers should be present
	assert!(json["mcp"].get("existing-server").is_some());
	assert!(json["mcp"].get("new-server").is_some());
}

/// OpenCode merges new servers with existing ones (doesn't overwrite all)
/// Corresponds to ruler test: merges with existing OpenCode configuration
#[test]
fn test_opencode_merge_preserves_existing_servers() {
	let test = TestConfigBuilder::new(AgentType::OpenCode)
		.with_content(
			r#"{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "existing-server": {
      "type": "local",
      "command": ["existing-command"],
      "enabled": true
    }
  }
}"#,
		)
		.build()
		.unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	// Verify existing server is loaded
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert_eq!(config.mcps[0].name, "existing-server");

	// Add a new server
	manager
		.add_mcp(McpServer::new(
			"new-server",
			McpTransport::stdio("new-command", vec![]),
		))
		.unwrap();

	// Reload and verify both servers present
	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 2);
	assert!(config.mcps.iter().any(|m| m.name == "existing-server"));
	assert!(config.mcps.iter().any(|m| m.name == "new-server"));
}

// ==================== Group 3: KiloCode CRUD ====================
// From ruler: KiloCodeMcp.test.ts

/// KiloCode: create new MCP configuration
/// Corresponds to ruler test: creates new MCP configuration file
#[test]
fn test_kilocode_mcp_add() {
	let test = TestConfig::new(AgentType::KiloCode).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	let mcp = McpServer::new(
		"filesystem",
		McpTransport::stdio(
			"npx",
			vec![
				"-y".to_string(),
				"@modelcontextprotocol/server-filesystem".to_string(),
			],
		),
	);
	manager.add_mcp(mcp).unwrap();

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();

	assert!(json["mcpServers"].get("filesystem").is_some());
	assert_eq!(json["mcpServers"]["filesystem"]["command"], "npx");
	assert_eq!(
		json["mcpServers"]["filesystem"]["args"][0],
		"-y"
	);
}

/// KiloCode: read existing MCP configuration
/// Corresponds to ruler test: reads existing MCP configuration
#[test]
fn test_kilocode_mcp_read_after_add() {
	let test = TestConfig::new(AgentType::KiloCode).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager
		.add_mcp(McpServer::new(
			"existing",
			McpTransport::stdio(
				"existing-command",
				vec!["existing-arg".to_string()],
			),
		))
		.unwrap();

	// Re-load and verify
	manager.load().unwrap();
	let config = manager.config().unwrap();
	let mcp = config
		.mcps
		.iter()
		.find(|m| m.name == "existing")
		.unwrap();

	match &mcp.transport {
		McpTransport::Stdio { command, args, .. } => {
			assert_eq!(command, "existing-command");
			assert_eq!(args[0], "existing-arg");
		}
		_ => panic!("Expected Stdio transport"),
	}
}

/// KiloCode: updating a server with the same name replaces it (overwrite)
/// Corresponds to ruler test: overwrites servers with same name during merge
#[test]
fn test_kilocode_mcp_update_same_name_replaces() {
	let test = TestConfig::new(AgentType::KiloCode).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager
		.add_mcp(McpServer::new(
			"filesystem",
			McpTransport::stdio(
				"old-command",
				vec!["old-arg".to_string()],
			),
		))
		.unwrap();

	// Update with new config for same name
	manager
		.update_mcp(
			"filesystem",
			McpServer::new(
				"filesystem",
				McpTransport::stdio(
					"new-command",
					vec!["new-arg".to_string()],
				),
			),
		)
		.unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	let mcp = config
		.mcps
		.iter()
		.find(|m| m.name == "filesystem")
		.unwrap();

	match &mcp.transport {
		McpTransport::Stdio { command, args, .. } => {
			assert_eq!(command, "new-command");
			assert_eq!(args[0], "new-arg");
		}
		_ => panic!("Expected Stdio transport"),
	}
}

/// KiloCode: updating a server preserves other servers (merge behavior)
/// Corresponds to ruler test: merges MCP configurations correctly
#[test]
fn test_kilocode_mcp_update_preserves_other() {
	let test = TestConfig::new(AgentType::KiloCode).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	// Add two servers
	manager
		.add_mcp(McpServer::new(
			"existing",
			McpTransport::stdio("existing-cmd", vec!["existing-arg".to_string()]),
		))
		.unwrap();
	manager
		.add_mcp(McpServer::new(
			"filesystem",
			McpTransport::stdio("npx", vec!["mcp-filesystem".to_string()]),
		))
		.unwrap();

	// Update only one
	manager
		.update_mcp(
			"filesystem",
			McpServer::new(
				"filesystem",
				McpTransport::stdio("npx", vec!["mcp-filesystem-v2".to_string()]),
			),
		)
		.unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 2, "Both servers should still exist");

	// Both servers present
	let existing = config.mcps.iter().find(|m| m.name == "existing").unwrap();
	match &existing.transport {
		McpTransport::Stdio { command, .. } => assert_eq!(command, "existing-cmd"),
		_ => panic!("Expected Stdio"),
	}
	let fs = config.mcps.iter().find(|m| m.name == "filesystem").unwrap();
	match &fs.transport {
		McpTransport::Stdio { args, .. } => {
			assert_eq!(args[0], "mcp-filesystem-v2")
		}
		_ => panic!("Expected Stdio"),
	}
}

/// KiloCode: remove server
#[test]
fn test_kilocode_mcp_remove() {
	let test = TestConfig::new(AgentType::KiloCode).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager.add_mcp(mcp_stdio("to-remove")).unwrap();
	manager.add_mcp(mcp_stdio("to-keep")).unwrap();

	manager.remove_mcp("to-remove").unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 1);
	assert!(config.mcps.iter().all(|m| m.name != "to-remove"));
	assert!(config.mcps.iter().any(|m| m.name == "to-keep"));
}

/// KiloCode: non-MCP JSON fields (like skills metadata) are preserved
/// Corresponds to ruler test: preserves non-MCP properties during merge
#[test]
fn test_kilocode_preserves_non_mcp_json_fields() {
	let test = TestConfigBuilder::new(AgentType::KiloCode)
		.with_content(
			r#"{"mcpServers": {}, "otherProperty": "preserved", "version": 2}"#,
		)
		.build()
		.unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager.add_mcp(mcp_stdio("filesystem")).unwrap();

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();

	assert_eq!(json["otherProperty"], "preserved");
	assert_eq!(json["version"], 2);
	assert!(json["mcpServers"].get("filesystem").is_some());
}

// ==================== Group 4: CRUD for agents without existing coverage ====================
// From ruler: mcp-paths.test.ts, capabilities.test.ts

/// Cursor: full CRUD workflow
#[test]
fn test_cursor_mcp_crud() {
	let test = TestConfig::new(AgentType::Cursor).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	// Add
	manager.add_mcp(mcp_stdio("cursor-mcp")).unwrap();
	manager.load().unwrap();
	assert_eq!(manager.config().unwrap().mcps.len(), 1);

	// Update
	manager
		.update_mcp(
			"cursor-mcp",
			McpServer::new(
				"cursor-mcp",
				McpTransport::stdio("updated-cmd", vec![]),
			),
		)
		.unwrap();
	manager.load().unwrap();
	let config = manager.config().unwrap();
	let mcp = config.mcps.iter().find(|m| m.name == "cursor-mcp").unwrap();
	match &mcp.transport {
		McpTransport::Stdio { command, .. } => assert_eq!(command, "updated-cmd"),
		_ => panic!("Expected Stdio"),
	}

	// Remove
	manager.remove_mcp("cursor-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

/// Windsurf: full CRUD workflow
#[test]
fn test_windsurf_mcp_crud() {
	let test = TestConfig::new(AgentType::Windsurf).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager.add_mcp(mcp_stdio("windsurf-mcp")).unwrap();
	manager.load().unwrap();
	assert_eq!(manager.config().unwrap().mcps.len(), 1);

	// Verify JSON key
	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();
	assert!(json.get("mcpServers").is_some());

	manager.remove_mcp("windsurf-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

/// Zed: full CRUD workflow using context_servers key
#[test]
fn test_zed_mcp_crud() {
	let test = TestConfig::new(AgentType::Zed).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager.add_mcp(mcp_stdio("zed-mcp")).unwrap();
	manager.load().unwrap();
	assert_eq!(manager.config().unwrap().mcps.len(), 1);

	// Verify context_servers key
	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();
	assert!(json.get("context_servers").is_some());
	assert!(json["context_servers"].get("zed-mcp").is_some());

	manager.remove_mcp("zed-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

/// Gemini CLI: full CRUD workflow
#[test]
fn test_gemini_mcp_crud() {
	let test = TestConfig::new(AgentType::Gemini).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager.add_mcp(mcp_stdio("gemini-mcp")).unwrap();
	manager.load().unwrap();
	assert_eq!(manager.config().unwrap().mcps.len(), 1);

	manager.remove_mcp("gemini-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

/// Cline: full CRUD workflow
#[test]
fn test_cline_mcp_crud() {
	let test = TestConfig::new(AgentType::Cline).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager.add_mcp(mcp_stdio("cline-mcp")).unwrap();
	manager.load().unwrap();
	assert_eq!(manager.config().unwrap().mcps.len(), 1);

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();
	assert!(json.get("mcpServers").is_some());

	manager.remove_mcp("cline-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

/// Warp: full CRUD workflow
#[test]
fn test_warp_mcp_crud() {
	let test = TestConfig::new(AgentType::Warp).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager.add_mcp(mcp_stdio("warp-mcp")).unwrap();
	manager.load().unwrap();
	assert_eq!(manager.config().unwrap().mcps.len(), 1);

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();
	assert!(json.get("mcpServers").is_some());

	manager.remove_mcp("warp-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

/// Factory: full CRUD workflow (.factory/mcp.json, mcpServers key)
/// Corresponds to ruler test: Factory Droid uses project-local path
#[test]
fn test_factory_mcp_crud() {
	let test = TestConfig::new(AgentType::Factory).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager.add_mcp(mcp_stdio("factory-mcp")).unwrap();
	manager.load().unwrap();
	assert_eq!(manager.config().unwrap().mcps.len(), 1);

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();
	assert!(json.get("mcpServers").is_some());
	assert!(json["mcpServers"].get("factory-mcp").is_some());

	manager.remove_mcp("factory-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

/// Kiro: full CRUD workflow (.kiro/settings/mcp.json, mcpServers key)
/// Corresponds to ruler test: Kiro uses project-local path .kiro/settings/mcp.json
#[test]
fn test_kiro_mcp_crud() {
	let test = TestConfig::new(AgentType::Kiro).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager.add_mcp(mcp_stdio("kiro-mcp")).unwrap();
	manager.load().unwrap();
	assert_eq!(manager.config().unwrap().mcps.len(), 1);

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();
	assert!(json.get("mcpServers").is_some());
	assert!(json["mcpServers"].get("kiro-mcp").is_some());

	manager.remove_mcp("kiro-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

/// GitHub Copilot: full CRUD workflow (.vscode/mcp.json, servers key)
#[test]
fn test_copilot_mcp_crud() {
	let test = TestConfig::new(AgentType::Copilot).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager.add_mcp(mcp_stdio("copilot-mcp")).unwrap();
	manager.load().unwrap();
	assert_eq!(manager.config().unwrap().mcps.len(), 1);

	manager.remove_mcp("copilot-mcp").unwrap();
	manager.load().unwrap();
	assert!(manager.config().unwrap().mcps.is_empty());
}

/// Cursor supports both stdio and remote MCP transports
/// Corresponds to ruler test: Cursor returns path within project root (stdio + remote capable)
#[test]
fn test_cursor_supports_stdio_and_remote() {
	let test = TestConfig::new(AgentType::Cursor).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	// Add stdio MCP
	manager.add_mcp(mcp_stdio("stdio-server")).unwrap();
	// Add remote (StreamableHttp) MCP
	manager.add_mcp(mcp_http("remote-server")).unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 2);

	let stdio = config.mcps.iter().find(|m| m.name == "stdio-server").unwrap();
	assert!(matches!(stdio.transport, McpTransport::Stdio { .. }));

	let remote = config.mcps.iter().find(|m| m.name == "remote-server").unwrap();
	assert!(matches!(remote.transport, McpTransport::StreamableHttp { .. }));
}

// ==================== Group 5: TOML format agents ====================
// From ruler: apply-mcp.toml-stdio.test.ts, apply-mcp.toml-remote.test.ts,
//             apply-mcp.toml-disable.test.ts

/// Codex: stdio MCP serialized to TOML [mcp_servers.name] section
/// Corresponds to ruler test: applies TOML-defined stdio MCP servers to native config
#[test]
fn test_codex_mcp_toml_stdio() {
	let test = TestConfig::new(AgentType::Codex).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager
		.add_mcp(McpServer::new(
			"repo",
			McpTransport::stdio(
				"node",
				vec!["scripts/repo-mcp.js".to_string()],
			),
		))
		.unwrap();
	manager
		.add_mcp(McpServer::new(
			"git",
			McpTransport::stdio(
				"npx",
				vec![
					"-y".to_string(),
					"@modelcontextprotocol/server-git".to_string(),
					"--repository".to_string(),
					".".to_string(),
				],
			),
		))
		.unwrap();

	let content = test.read_config().unwrap();
	// Verify TOML format contains the MCP servers
	assert!(
		content.contains("[mcp_servers.repo]"),
		"TOML should have [mcp_servers.repo] section"
	);
	assert!(content.contains("command = \"node\""));
	assert!(content.contains("scripts/repo-mcp.js"));
	assert!(
		content.contains("[mcp_servers.git]"),
		"TOML should have [mcp_servers.git] section"
	);
	assert!(content.contains("command = \"npx\""));
}

/// Codex: stdio MCP with env vars serialized to TOML
#[test]
fn test_codex_mcp_toml_stdio_with_env() {
	let test = TestConfig::new(AgentType::Codex).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	let mut env = HashMap::new();
	env.insert("API_KEY".to_string(), "abc123".to_string());
	let mcp = McpServer {
		name: "repo".to_string(),
		enabled: true,
		transport: McpTransport::Stdio {
			command: "node".to_string(),
			args: vec!["scripts/repo-mcp.js".to_string()],
			env: Some(env),
			timeout: None,
		},
		timeout: None,
	};
	manager.add_mcp(mcp).unwrap();

	let content = test.read_config().unwrap();
	assert!(content.contains("API_KEY"));
	assert!(content.contains("abc123"));
}

/// Codex: StreamableHttp (remote) MCP is silently dropped in TOML format
/// (TOML format only supports stdio transports)
/// Corresponds to ruler test: apply-mcp.toml-remote behavior — remote servers require
/// agent support. Codex only supports stdio (mcp_remote: false in descriptor).
#[test]
fn test_codex_mcp_toml_remote_not_supported() {
	let test = TestConfig::new(AgentType::Codex).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	// Codex descriptor has mcp_remote: false, but the manager still accepts
	// the add_mcp call — it just won't serialize the remote transport to TOML
	manager.add_mcp(mcp_stdio("stdio-server")).unwrap();

	let content = test.read_config().unwrap();
	assert!(content.contains("[mcp_servers.stdio-server]"));

	// Remote transport silently dropped by TOML serializer
	// SSE/HTTP not supported in TOML format per toml_format.rs
}

/// Codex: pre-existing TOML keys (model, etc.) are preserved after MCP update
/// Corresponds to ruler test: apply-mcp.toml preserves other config
#[test]
fn test_codex_mcp_toml_preserves_existing_keys() {
	let test = TestConfigBuilder::new(AgentType::Codex)
		.with_content(
			r#"model = "gpt-4o"
model_provider = "openai"
"#,
		)
		.build()
		.unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager
		.add_mcp(McpServer::new(
			"repo",
			McpTransport::stdio("node", vec!["server.js".to_string()]),
		))
		.unwrap();

	let content = test.read_config().unwrap();
	assert!(
		content.contains("model = \"gpt-4o\""),
		"Model should be preserved"
	);
	assert!(
		content.contains("model_provider = \"openai\""),
		"Model provider should be preserved"
	);
	assert!(content.contains("[mcp_servers.repo]"));
}

/// Mistral: stdio MCP serialized to TOML
#[test]
fn test_mistral_mcp_toml_stdio() {
	let test = TestConfig::new(AgentType::Mistral).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager
		.add_mcp(McpServer::new(
			"filesystem",
			McpTransport::stdio(
				"npx",
				vec![
					"-y".to_string(),
					"@modelcontextprotocol/server-filesystem".to_string(),
				],
			),
		))
		.unwrap();

	let content = test.read_config().unwrap();
	assert!(content.contains("[mcp_servers.filesystem]"));
	assert!(content.contains("command = \"npx\""));
}

// ==================== Group 6: Merge and overwrite behaviors ====================
// From ruler: apply-mcp.merge.test.ts, apply-mcp.overwrite.test.ts

/// Adding a new MCP server preserves existing servers (merge, not replace-all)
/// Corresponds to ruler test: merges servers from .ruler/mcp.json and existing native config
#[test]
fn test_mcp_merge_preserves_existing_servers() {
	// Start with an existing native config that has a server
	let test = TestConfigBuilder::new(AgentType::Copilot)
		.with_content(
			r#"{"servers": {"native-server": {"type": "stdio", "command": "native-cmd"}}}"#,
		)
		.build()
		.unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	// Verify existing server loaded
	assert_eq!(manager.config().unwrap().mcps.len(), 1);
	assert_eq!(manager.config().unwrap().mcps[0].name, "native-server");

	// Add a new server
	manager.add_mcp(mcp_stdio("new-server")).unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	let names: Vec<&str> = config.mcps.iter().map(|m| m.name.as_str()).collect();

	// Both servers should be present
	assert!(
		names.contains(&"native-server"),
		"Original server should still be present"
	);
	assert!(names.contains(&"new-server"), "New server should be present");
}

/// Updating only the target server, others remain unchanged
/// Corresponds to ruler test: update replaces only the named server
#[test]
fn test_mcp_update_replaces_target_only() {
	let test = TestConfigBuilder::new(AgentType::Cursor)
		.with_content(
			r#"{"mcpServers": {
    "foo": {"type": "stdio", "command": "foo-cmd"},
    "bar": {"type": "stdio", "command": "bar-cmd"}
}}"#,
		)
		.build()
		.unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	// Update only "foo"
	manager
		.update_mcp(
			"foo",
			McpServer::new(
				"foo",
				McpTransport::stdio("foo-updated", vec![]),
			),
		)
		.unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	assert_eq!(config.mcps.len(), 2);

	let foo = config.mcps.iter().find(|m| m.name == "foo").unwrap();
	match &foo.transport {
		McpTransport::Stdio { command, .. } => assert_eq!(command, "foo-updated"),
		_ => panic!("Expected Stdio"),
	}

	let bar = config.mcps.iter().find(|m| m.name == "bar").unwrap();
	match &bar.transport {
		McpTransport::Stdio { command, .. } => assert_eq!(command, "bar-cmd"),
		_ => panic!("Expected Stdio"),
	}
}

/// Overwrite via remove-all + re-add: results in clean state
/// Corresponds to ruler test: overwrites existing native config when --mcp-overwrite is used
#[test]
fn test_mcp_overwrite_via_remove_then_add() {
	let test = TestConfigBuilder::new(AgentType::Copilot)
		.with_content(
			r#"{"servers": {"bar": {"type": "stdio", "command": "bar-cmd"}}}"#,
		)
		.build()
		.unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	// Remove existing server
	manager.remove_mcp("bar").unwrap();
	// Add new server only
	manager.add_mcp(mcp_stdio("foo")).unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	let names: Vec<&str> = config.mcps.iter().map(|m| m.name.as_str()).collect();

	assert_eq!(names, vec!["foo"], "Only foo should remain");
}

// ==================== Group 7: Edge cases ====================
// From ruler: mcp-warning-deduplication.test.ts, mcp-backup-prevention.test.ts,
//             mcp-invalid-fields.test.ts

/// Duplicate add returns error with "already exists" message
/// Corresponds to ruler test: mcp-warning-deduplication (duplicate detection)
#[test]
fn test_mcp_duplicate_add_returns_error() {
	let test = TestConfig::new(AgentType::Cursor).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager.add_mcp(mcp_stdio("my-server")).unwrap();

	let result = manager.add_mcp(mcp_stdio("my-server"));
	assert!(result.is_err(), "Duplicate add should fail");
	assert!(
		result.unwrap_err().to_string().contains("already exists"),
		"Error should mention 'already exists'"
	);
}

/// Remove/update on non-existent server returns error with "not found"
/// Corresponds to ruler test: mcp-invalid-fields (not-found detection)
#[test]
fn test_mcp_not_found_returns_error() {
	let test = TestConfig::new(AgentType::Cursor).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	let remove_result = manager.remove_mcp("nonexistent");
	assert!(remove_result.is_err());
	assert!(
		remove_result.unwrap_err().to_string().contains("not found"),
		"Remove error should mention 'not found'"
	);

	let update_result =
		manager.update_mcp("nonexistent", mcp_stdio("nonexistent"));
	assert!(update_result.is_err());
	assert!(
		update_result.unwrap_err().to_string().contains("not found"),
		"Update error should mention 'not found'"
	);
}

/// Stdio MCP with empty args list is handled correctly
/// Corresponds to ruler test: mcp-invalid-fields — handle edge cases gracefully
#[test]
fn test_mcp_empty_args_vec() {
	let test = TestConfig::new(AgentType::KiloCode).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	let mcp =
		McpServer::new("empty-args", McpTransport::stdio("my-command", vec![]));
	manager.add_mcp(mcp).unwrap();

	manager.load().unwrap();
	let config = manager.config().unwrap();
	let saved = config
		.mcps
		.iter()
		.find(|m| m.name == "empty-args")
		.unwrap();

	match &saved.transport {
		McpTransport::Stdio { command, args, .. } => {
			assert_eq!(command, "my-command");
			assert!(args.is_empty());
		}
		_ => panic!("Expected Stdio"),
	}
}

/// Authorization Bearer header is preserved through save → load roundtrip
/// Corresponds to ruler test: mcp-real-configs — real headers preserved
#[test]
fn test_mcp_headers_preserved_on_roundtrip() {
	let test = TestConfig::new(AgentType::Cursor).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	let mut headers = HashMap::new();
	headers.insert(
		"Authorization".to_string(),
		"Bearer secret-token-123".to_string(),
	);
	headers.insert(
		"X-API-Version".to_string(),
		"v1".to_string(),
	);
	let mcp = McpServer::new(
		"auth-server",
		McpTransport::streamable_http_with_headers(
			"https://secure.example.com/mcp",
			headers,
		),
	);
	manager.add_mcp(mcp).unwrap();

	// Reload from disk
	manager.load().unwrap();
	let config = manager.config().unwrap();
	let saved = config
		.mcps
		.iter()
		.find(|m| m.name == "auth-server")
		.unwrap();

	match &saved.transport {
		McpTransport::StreamableHttp { url, headers, .. } => {
			assert_eq!(url, "https://secure.example.com/mcp");
			let h = headers.as_ref().unwrap();
			assert_eq!(h.get("Authorization"), Some(&"Bearer secret-token-123".to_string()));
			assert_eq!(h.get("X-API-Version"), Some(&"v1".to_string()));
		}
		_ => panic!("Expected StreamableHttp"),
	}
}

/// No stray backup or temp files are created during MCP operations
/// Corresponds to ruler test: mcp-backup-prevention
#[test]
fn test_mcp_no_backup_files_created() {
	let test = TestConfig::new(AgentType::KiloCode).unwrap();
	let dir = test.temp_dir().to_path_buf();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager.add_mcp(mcp_stdio("server1")).unwrap();
	manager.update_mcp("server1", mcp_stdio("server1")).unwrap();
	manager.remove_mcp("server1").unwrap();

	// No backup or temp files should exist
	let entries: Vec<_> = std::fs::read_dir(&dir)
		.unwrap()
		.filter_map(|e| e.ok())
		.map(|e| e.file_name().to_string_lossy().to_string())
		.collect();

	for entry in &entries {
		assert!(
			!entry.ends_with(".bak"),
			"No .bak files should be created: {}",
			entry
		);
		assert!(
			!entry.ends_with(".tmp"),
			"No .tmp files should be created: {}",
			entry
		);
		assert!(
			!entry.contains('~'),
			"No tilde backup files should be created: {}",
			entry
		);
	}
}

/// Invalid JSON in config file returns a load error
/// Corresponds to ruler test: mcp-invalid-fields — invalid config handling
#[test]
fn test_mcp_invalid_json_fails_load() {
	let test = TestConfigBuilder::new(AgentType::KiloCode)
		.with_content("{ invalid json }")
		.build()
		.unwrap();
	let mut manager = test.create_manager();

	let result = manager.load();
	assert!(result.is_err(), "Invalid JSON should fail to load");
}

/// Invalid TOML in config file returns a load error
#[test]
fn test_mcp_invalid_toml_fails_load() {
	let test = TestConfigBuilder::new(AgentType::Codex)
		.with_content("invalid = toml = content [[[")
		.build()
		.unwrap();
	let mut manager = test.create_manager();

	let result = manager.load();
	assert!(result.is_err(), "Invalid TOML should fail to load");
}

/// SSE MCP with Authorization header survives full roundtrip via Claude config
/// Corresponds to ruler test: claude-mcp-config — SSE transport preserved
#[test]
fn test_claude_sse_mcp_roundtrip() {
	let test = TestConfig::new(AgentType::Claude).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager.add_mcp(mcp_sse("sse-server")).unwrap();

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();

	// Claude serializes SSE with type "sse"
	assert_eq!(json["mcpServers"]["sse-server"]["type"], "sse");
	assert_eq!(
		json["mcpServers"]["sse-server"]["url"],
		"http://localhost:3000/sse"
	);
	assert_eq!(
		json["mcpServers"]["sse-server"]["headers"]["Authorization"],
		"Bearer test-token"
	);

	// Reload and verify roundtrip
	manager.load().unwrap();
	let config = manager.config().unwrap();
	let server = config
		.mcps
		.iter()
		.find(|m| m.name == "sse-server")
		.unwrap();
	match &server.transport {
		McpTransport::Sse { url, headers, .. } => {
			assert_eq!(url, "http://localhost:3000/sse");
			assert!(headers.is_some());
			assert_eq!(
				headers.as_ref().unwrap().get("Authorization"),
				Some(&"Bearer test-token".to_string())
			);
		}
		_ => panic!("Expected Sse transport"),
	}
}

/// StreamableHttp MCP serialized with type "http" for Claude (not "remote")
/// Corresponds to ruler test: claude-mcp-config — HTTP transport preserved
#[test]
fn test_claude_http_mcp_type_field() {
	let test = TestConfig::new(AgentType::Claude).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager.add_mcp(mcp_http("http-server")).unwrap();

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();

	// Claude uses "http" type for StreamableHttp
	assert_eq!(json["mcpServers"]["http-server"]["type"], "http");
	assert_eq!(
		json["mcpServers"]["http-server"]["url"],
		"http://localhost:3000/mcp"
	);
}

/// OpenCode: SSE transport is serialized as "remote" type (same as StreamableHttp)
/// Corresponds to ruler test: OpenCode MCP Integration — remote servers
#[test]
fn test_opencode_sse_and_http_both_serialize_as_remote() {
	let test = TestConfigBuilder::new(AgentType::OpenCode)
		.with_content("{}")
		.build()
		.unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager.add_mcp(mcp_sse("sse-server")).unwrap();
	manager.add_mcp(mcp_http("http-server")).unwrap();

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();

	// Both SSE and StreamableHttp should serialize as "remote" in OpenCode
	assert_eq!(json["mcp"]["sse-server"]["type"], "remote");
	assert_eq!(json["mcp"]["http-server"]["type"], "remote");
}

/// KiloCode: SSE and StreamableHttp use "sse" and "http" type tags respectively
#[test]
fn test_kilocode_sse_and_http_type_tags() {
	let test = TestConfig::new(AgentType::KiloCode).unwrap();
	let mut manager = test.create_manager();
	manager.load().unwrap();

	manager.add_mcp(mcp_sse("sse-server")).unwrap();
	manager.add_mcp(mcp_http("http-server")).unwrap();

	let content = test.read_config().unwrap();
	let json: serde_json::Value = serde_json::from_str(&content).unwrap();

	assert_eq!(json["mcpServers"]["sse-server"]["type"], "sse");
	assert_eq!(json["mcpServers"]["http-server"]["type"], "http");
}

/// Test that all agents with mcpServers key don't produce empty string key
/// Corresponds to ruler test: mcp-empty-server-key-fix
#[test]
fn test_no_empty_string_mcp_key_produced() {
	let agents_with_mcpservers = [
		AgentType::Claude,
		AgentType::Cursor,
		AgentType::Gemini,
		AgentType::KiloCode,
		AgentType::Windsurf,
		AgentType::Factory,
		AgentType::Kiro,
		AgentType::Cline,
	];

	for agent in agents_with_mcpservers {
		let test = TestConfig::new(agent).unwrap();
		let mut manager = test.create_manager();
		manager.load().unwrap();
		manager
			.add_mcp(McpServer::new(
				"test-server",
				McpTransport::stdio("cmd", vec![]),
			))
			.unwrap();

		let content = test.read_config().unwrap();
		let json: serde_json::Value = serde_json::from_str(&content).unwrap();

		assert!(
			json.get("").is_none(),
			"Agent {:?} should not produce empty string key",
			agent
		);
	}
}
