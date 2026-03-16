//! Integration tests for aghub-core
//!
//! These tests verify the full CRUD workflow and agent validation
//! using temporary configurations to avoid polluting the global environment.

use aghub_core::{
    models::{AgentType, McpServer, McpTransport, Skill, SubAgent},
    testing::{TestConfig, TestConfigBuilder},
    ConfigManager,
};
use std::collections::HashMap;

// ==================== Helper Functions ====================

fn create_test_mcp_command(name: &str) -> McpServer {
    McpServer::new(
        name,
        McpTransport::command("echo", vec!["test".to_string(), "args".to_string()]),
    )
}

fn create_test_mcp_url(name: &str) -> McpServer {
    let mut headers = HashMap::new();
    headers.insert("Authorization".to_string(), "Bearer test-token".to_string());

    McpServer::new(
        name,
        McpTransport::url_with_headers("http://localhost:3000", headers),
    )
}

fn create_test_skill(name: &str) -> Skill {
    Skill {
        name: name.to_string(),
        enabled: true,
        source: Some(format!("https://example.com/{}.json", name)),
        description: Some(format!("Test skill: {}", name)),
        author: Some("test-author".to_string()),
        version: Some("1.0.0".to_string()),
        tools: vec!["tool1".to_string(), "tool2".to_string()],
    }
}

fn create_test_sub_agent(name: &str) -> SubAgent {
    SubAgent {
        name: name.to_string(),
        enabled: true,
        description: Some(format!("Test sub-agent: {}", name)),
        model: Some("claude-sonnet-4-6".to_string()),
        instructions: Some("You are a helpful assistant.".to_string()),
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
    let mcp1 = create_test_mcp_command("mcp1");
    manager.add_mcp(mcp1.clone()).unwrap();

    // Verify it was added
    manager.load().unwrap();
    let config = manager.config().unwrap();
    assert_eq!(config.mcps.len(), 1);
    assert_eq!(config.mcps[0].name, "mcp1");
    assert!(config.mcps[0].enabled);

    // Add second MCP
    let mcp2 = create_test_mcp_command("mcp2");
    manager.add_mcp(mcp2.clone()).unwrap();

    manager.load().unwrap();
    let config = manager.config().unwrap();
    assert_eq!(config.mcps.len(), 2);

    // Update MCP
    let mut updated_mcp = mcp1.clone();
    updated_mcp.transport = McpTransport::command("updated", vec!["new".to_string()]);
    manager.update_mcp("mcp1", updated_mcp).unwrap();

    manager.load().unwrap();
    let config = manager.config().unwrap();
    let mcp1_ref = config.mcps.iter().find(|m| m.name == "mcp1").unwrap();
    match &mcp1_ref.transport {
        McpTransport::Command { command, .. } => assert_eq!(command, "updated"),
        _ => panic!("Expected command transport"),
    }

    // Note: Claude doesn't preserve disabled state - disabled MCPs are removed from config
    // This is expected behavior for Claude adapter

    // Delete MCP
    manager.remove_mcp("mcp1").unwrap();
    manager.load().unwrap();
    let config = manager.config().unwrap();
    assert_eq!(config.mcps.len(), 1);
    assert!(config.mcps.iter().find(|m| m.name == "mcp1").is_none());
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
fn test_claude_url_mcp_silently_ignored() {
    let test = TestConfig::new(AgentType::Claude).unwrap();
    let mut manager = test.create_manager();

    manager.load().unwrap();

    // Add URL-based MCP (not supported by Claude)
    let url_mcp = create_test_mcp_url("url-mcp");
    manager.add_mcp(url_mcp).unwrap();

    // Serialize and check - URL MCP should be silently skipped
    let content = test.read_config().unwrap();
    let json: serde_json::Value = serde_json::from_str(&content).unwrap();
    let mcp_servers = json.get("mcpServers").unwrap().as_object().unwrap();

    // URL MCPs are not serialized for Claude
    assert!(mcp_servers.is_empty() || !mcp_servers.contains_key("url-mcp"));
}

#[test]
fn test_claude_sub_agents_silently_disabled() {
    let test = TestConfig::new(AgentType::Claude).unwrap();
    let mut manager = test.create_manager();

    manager.load().unwrap();

    // Try to add sub-agent (not supported by Claude)
    let agent = create_test_sub_agent("reviewer");
    manager.add_sub_agent(agent).unwrap();

    // It should be stored in memory but not serialized
    let config = manager.config().unwrap();
    assert_eq!(config.sub_agents.len(), 1);

    // After save and reload, sub-agents should be gone
    manager.save_current().unwrap();
    manager.load().unwrap();
    let config = manager.config().unwrap();
    assert!(config.sub_agents.is_empty());
}

// ==================== OpenCode Integration Tests ====================

#[test]
fn test_opencode_full_mcp_workflow() {
    let test = TestConfig::new(AgentType::OpenCode).unwrap();
    let mut manager = test.create_manager();

    manager.load().unwrap();

    // Add both command and URL MCPs
    let cmd_mcp = create_test_mcp_command("cmd-mcp");
    let url_mcp = create_test_mcp_url("url-mcp");

    manager.add_mcp(cmd_mcp).unwrap();
    manager.add_mcp(url_mcp).unwrap();

    manager.load().unwrap();
    let config = manager.config().unwrap();
    assert_eq!(config.mcps.len(), 2);

    // Verify types are preserved
    let cmd_ref = config.mcps.iter().find(|m| m.name == "cmd-mcp").unwrap();
    let url_ref = config.mcps.iter().find(|m| m.name == "url-mcp").unwrap();

    assert!(matches!(cmd_ref.transport, McpTransport::Command { .. }));
    assert!(matches!(url_ref.transport, McpTransport::Url { .. }));

    // Verify URL headers preserved
    match &url_ref.transport {
        McpTransport::Url { headers, .. } => {
            assert!(headers.is_some());
            let headers = headers.as_ref().unwrap();
            assert_eq!(
                headers.get("Authorization"),
                Some(&"Bearer test-token".to_string())
            );
        }
        _ => panic!("Expected URL transport"),
    }
}

#[test]
fn test_opencode_sub_agent_workflow() {
    let test = TestConfig::new(AgentType::OpenCode).unwrap();
    let mut manager = test.create_manager();

    manager.load().unwrap();

    // Add sub-agent
    let agent = create_test_sub_agent("reviewer");
    manager.add_sub_agent(agent.clone()).unwrap();

    manager.load().unwrap();
    let config = manager.config().unwrap();
    assert_eq!(config.sub_agents.len(), 1);

    let saved_agent = &config.sub_agents[0];
    assert_eq!(saved_agent.name, "reviewer");
    assert_eq!(saved_agent.model, Some("claude-sonnet-4-6".to_string()));
    assert!(saved_agent.instructions.is_some());

    // Update
    let mut updated = agent.clone();
    updated.model = Some("claude-opus-4-6".to_string());
    manager.update_sub_agent("reviewer", updated).unwrap();

    manager.load().unwrap();
    let config = manager.config().unwrap();
    let saved_agent = config
        .sub_agents
        .iter()
        .find(|a| a.name == "reviewer")
        .unwrap();
    assert_eq!(saved_agent.model, Some("claude-opus-4-6".to_string()));

    // Disable and enable
    manager.disable_sub_agent("reviewer").unwrap();
    manager.load().unwrap();
    let config = manager.config().unwrap();
    assert!(!config.sub_agents[0].enabled);

    manager.enable_sub_agent("reviewer").unwrap();
    manager.load().unwrap();
    let config = manager.config().unwrap();
    assert!(config.sub_agents[0].enabled);

    // Delete
    manager.remove_sub_agent("reviewer").unwrap();
    manager.load().unwrap();
    let config = manager.config().unwrap();
    assert!(config.sub_agents.is_empty());
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
        transport: McpTransport::command("echo", vec!["test".to_string()]),
    };
    let disabled_mcp = McpServer {
        name: "disabled-mcp".to_string(),
        enabled: false,
        transport: McpTransport::command("echo", vec!["test".to_string()]),
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

    let mcp = create_test_mcp_command("duplicate");
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

/// These tests validate configurations using the actual agent CLIs.
/// They will be skipped gracefully if the CLIs are not installed.

#[test]
fn test_claude_config_validation() {
    let test = TestConfig::new(AgentType::Claude).unwrap();
    let mut manager = test.create_manager();

    manager.load().unwrap();

    // Add a valid MCP
    let mcp = create_test_mcp_command("test");
    manager.add_mcp(mcp).unwrap();

    // Validate with Claude CLI
    let result = manager.validate();
    assert!(result.is_ok(), "Claude should accept the configuration");
}

#[test]
fn test_opencode_config_validation() {
    let test = TestConfig::new(AgentType::OpenCode).unwrap();
    let mut manager = test.create_manager();

    manager.load().unwrap();

    // Add valid resources
    let mcp = create_test_mcp_command("test");
    let skill = create_test_skill("test-skill");
    let agent = create_test_sub_agent("test-agent");

    manager.add_mcp(mcp).unwrap();
    manager.add_skill(skill).unwrap();
    manager.add_sub_agent(agent).unwrap();

    // Validate with OpenCode CLI
    let result = manager.validate();
    assert!(result.is_ok(), "OpenCode should accept the configuration");
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
    assert!(config.sub_agents.is_empty());
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
        transport: McpTransport::Command {
            command: "my-server".to_string(),
            args: vec!["--port".to_string(), "8080".to_string()],
            env: Some(env),
        },
    };

    manager.add_mcp(mcp).unwrap();

    manager.load().unwrap();
    let config = manager.config().unwrap();
    let saved_mcp = config.mcps.iter().find(|m| m.name == "env-mcp").unwrap();

    match &saved_mcp.transport {
        McpTransport::Command { env, .. } => {
            assert!(env.is_some());
            let env = env.as_ref().unwrap();
            assert_eq!(env.get("API_KEY"), Some(&"secret123".to_string()));
            assert_eq!(env.get("DEBUG"), Some(&"true".to_string()));
        }
        _ => panic!("Expected command transport with env"),
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
        let mcp = create_test_mcp_command(name);
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
        let mcp = create_test_mcp_command(&format!("mcp{}", i));
        manager.add_mcp(mcp).unwrap();
    }

    // Disable some
    manager.disable_mcp("mcp1").unwrap();
    manager.disable_mcp("mcp3").unwrap();

    // Add more after disabling
    for i in 5..10 {
        let mcp = create_test_mcp_command(&format!("mcp{}", i));
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
