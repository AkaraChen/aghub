use crate::{
    errors::{ConfigError, Result},
    models::{AgentConfig, McpServer, McpTransport, Skill},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::AgentAdapter;

/// Claude Code specific configuration structure
#[derive(Debug, Default, Serialize, Deserialize)]
struct ClaudeConfig {
    #[serde(rename = "mcpServers", default)]
    mcp_servers: HashMap<String, ClaudeMcpServer>,
    /// Note: Skills are now loaded from ~/.claude/skills/ directory
    /// This field is kept for backward compatibility but not used
    #[serde(default)]
    skills: HashMap<String, serde_json::Value>,
}

/// Claude MCP server configuration
#[derive(Debug, Serialize, Deserialize)]
struct ClaudeMcpServer {
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: Option<HashMap<String, String>>,
}

/// Parse SKILL.md frontmatter to extract skill metadata
fn parse_skill_md(content: &str) -> Option<(String, Option<String>)> {
    // Look for YAML frontmatter between --- markers
    let lines: Vec<&str> = content.lines().collect();
    if lines.len() < 3 || !lines[0].trim().is_empty() && lines[0] != "---" {
        return None;
    }

    // Find the end of frontmatter
    let mut name = None;
    let mut description = None;
    let mut in_frontmatter = false;
    let mut current_key: Option<&str> = None;

    for line in &lines {
        let trimmed = line.trim();

        if trimmed == "---" {
            if !in_frontmatter {
                in_frontmatter = true;
                continue;
            } else {
                break;
            }
        }

        if !in_frontmatter {
            continue;
        }

        // Check for key: value pairs
        if let Some(pos) = line.find(':') {
            let key = line[..pos].trim();
            let value = line[pos + 1..].trim();

            if key == "name" {
                name = Some(value.to_string());
            } else if key == "description" {
                // Description might be a folded scalar (>)
                if value.is_empty() || value == ">" {
                    current_key = Some("description");
                    description = Some(String::new());
                } else {
                    description = Some(value.to_string());
                }
            }
        } else if in_frontmatter && current_key == Some("description") {
            // Continuation of multi-line description
            if let Some(ref mut desc) = description {
                if !trimmed.is_empty() {
                    if !desc.is_empty() {
                        desc.push(' ');
                    }
                    desc.push_str(trimmed);
                }
            }
        }
    }

    name.map(|n| (n, description))
}

/// Load skills from the skills directory
fn load_skills_from_dir(skills_dir: &Path) -> Vec<Skill> {
    let mut skills = Vec::new();

    if !skills_dir.exists() {
        return skills;
    }

    let Ok(entries) = fs::read_dir(skills_dir) else {
        return skills;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let skill_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if skill_name.is_empty() {
            continue;
        }

        // Try to read SKILL.md for metadata
        let skill_md_path = path.join("SKILL.md");
        let (display_name, description) = if skill_md_path.exists() {
            fs::read_to_string(&skill_md_path)
                .ok()
                .and_then(|content| parse_skill_md(&content))
                .unwrap_or_else(|| (skill_name.to_string(), None))
        } else {
            (skill_name.to_string(), None)
        };

        skills.push(Skill {
            name: display_name,
            enabled: true,
            source: None, // Could be derived from path if needed
            description,
            author: None,
            version: None,
            tools: Vec::new(),
        });
    }

    skills.sort_by(|a, b| a.name.cmp(&b.name));
    skills
}

use std::cell::RefCell;

thread_local! {
    /// Thread-local override for skills path (used in tests)
    static SKILLS_PATH_OVERRIDE: RefCell<Option<PathBuf>> = const { RefCell::new(None) };
}

/// Set the thread-local skills path override (for testing)
pub fn set_thread_local_skills_path(path: Option<PathBuf>) {
    SKILLS_PATH_OVERRIDE.with(|p| *p.borrow_mut() = path);
}

/// Get skills directory path, respecting thread-local override and CLAUDE_SKILLS_PATH env var
fn get_skills_path() -> PathBuf {
    // First check thread-local override (for isolated testing)
    if let Some(path) = SKILLS_PATH_OVERRIDE.with(|p| p.borrow().clone()) {
        return path;
    }
    // Then check environment variable
    std::env::var("CLAUDE_SKILLS_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| crate::paths::claude_global_skills_path())
}

pub struct ClaudeAdapter;

impl ClaudeAdapter {
    pub fn new() -> Self {
        Self
    }

    /// Get the global skills directory path
    fn global_skills_path(&self) -> PathBuf {
        crate::paths::claude_global_skills_path()
    }

    /// Get the project skills directory path
    fn project_skills_path(&self, project_root: &Path) -> PathBuf {
        project_root.join(".claude/skills")
    }
}

impl Default for ClaudeAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentAdapter for ClaudeAdapter {
    fn name(&self) -> &'static str {
        "claude"
    }

    fn global_config_path(&self) -> PathBuf {
        crate::paths::claude_global_path()
    }

    fn project_config_path(&self, project_root: &Path) -> PathBuf {
        crate::paths::claude_project_path(project_root)
    }

    fn parse_config(&self, content: &str) -> Result<AgentConfig> {
        let claude_config: ClaudeConfig = serde_json::from_str(content)?;

        let mut config = AgentConfig::new();

        // Parse MCP servers from settings.json
        for (name, mcp) in claude_config.mcp_servers {
            config.mcps.push(McpServer {
                name,
                enabled: true, // Claude doesn't have explicit enabled field
                transport: McpTransport::Command {
                    command: mcp.command,
                    args: mcp.args,
                    env: mcp.env,
                },
            });
        }

        // Parse skills from skills directory
        // Note: We use global skills directory for both global and project configs
        // since skills are typically installed globally
        let skills_dir = get_skills_path();
        config.skills = load_skills_from_dir(&skills_dir);

        // Note: Claude Code doesn't have sub-agents in the same way
        // This feature is silently disabled for Claude

        Ok(config)
    }

    fn serialize_config(&self, config: &AgentConfig) -> Result<String> {
        let mut claude_config = ClaudeConfig::default();

        // Serialize MCP servers
        for mcp in &config.mcps {
            if let McpTransport::Command { command, args, env } = &mcp.transport {
                // Only include enabled MCPs in the output
                if mcp.enabled {
                    claude_config.mcp_servers.insert(
                        mcp.name.clone(),
                        ClaudeMcpServer {
                            command: command.clone(),
                            args: args.clone(),
                            env: env.clone(),
                        },
                    );
                }
            }
            // Note: URL-based MCPs are not supported by Claude Code
            // They're silently skipped during serialization
        }

        // Note: Skills are NOT serialized to settings.json
        // They are managed in the ~/.claude/skills/ directory
        // We keep the skills field empty in the JSON output

        // Note: Sub-agents are not serialized for Claude Code
        // This feature is silently disabled

        serde_json::to_string_pretty(&claude_config).map_err(ConfigError::Json)
    }

    fn validate_command(&self, config_path: &Path) -> Command {
        let mut cmd = Command::new("claude");
        cmd.arg("--settings").arg(config_path);
        cmd.arg("--version");
        cmd
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::SubAgent;

    #[test]
    fn test_parse_claude_config() {
        let json = r#"{
            "mcpServers": {
                "filesystem": {
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
                },
                "github": {
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-github"],
                    "env": {
                        "GITHUB_TOKEN": "secret"
                    }
                }
            }
        }"#;

        let adapter = ClaudeAdapter::new();
        let config = adapter.parse_config(json).unwrap();

        assert_eq!(config.mcps.len(), 2);

        // Find filesystem MCP (HashMap iteration order is not deterministic)
        let filesystem = config.mcps.iter().find(|m| m.name == "filesystem").unwrap();
        assert!(matches!(filesystem.transport, McpTransport::Command { .. }));

        // Find github MCP and check env
        let github = config.mcps.iter().find(|m| m.name == "github").unwrap();
        assert!(matches!(github.transport, McpTransport::Command { .. }));
    }

    #[test]
    fn test_serialize_claude_config() {
        let config = AgentConfig {
            mcps: vec![McpServer::new(
                "test",
                McpTransport::command("echo", vec!["hello".to_string()]),
            )],
            skills: vec![Skill {
                name: "my-skill".to_string(),
                enabled: true,
                source: Some("https://example.com".to_string()),
                description: Some("A test skill".to_string()),
                author: Some("test".to_string()),
                version: Some("1.0.0".to_string()),
                tools: vec!["tool1".to_string()],
            }],
            sub_agents: vec![SubAgent::new("agent1")], // Should be ignored
        };

        let adapter = ClaudeAdapter::new();
        let json = adapter.serialize_config(&config).unwrap();

        assert!(json.contains("mcpServers"));
        assert!(json.contains("test"));
        // Skills should NOT be in the serialized output (they're in directory)
        assert!(!json.contains("my-skill"));
        assert!(!json.contains("sub_agents")); // Claude doesn't support this
    }

    #[test]
    fn test_disabled_resources_not_serialized() {
        let config = AgentConfig {
            mcps: vec![
                McpServer {
                    name: "enabled".to_string(),
                    enabled: true,
                    transport: McpTransport::command("echo", vec!["hello".to_string()]),
                },
                McpServer {
                    name: "disabled".to_string(),
                    enabled: false,
                    transport: McpTransport::command("echo", vec!["world".to_string()]),
                },
            ],
            skills: vec![],
            sub_agents: vec![],
        };

        let adapter = ClaudeAdapter::new();
        let json = adapter.serialize_config(&config).unwrap();

        assert!(json.contains("enabled"));
        assert!(!json.contains("disabled"));
    }

    #[test]
    fn test_url_mcp_silently_skipped() {
        // Claude doesn't support URL-based MCPs
        let config = AgentConfig {
            mcps: vec![McpServer::new(
                "url-mcp",
                McpTransport::url("http://localhost:3000"),
            )],
            skills: vec![],
            sub_agents: vec![],
        };

        let adapter = ClaudeAdapter::new();
        let json = adapter.serialize_config(&config).unwrap();

        // Should serialize successfully but with empty mcpServers
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        let mcp_servers = parsed.get("mcpServers").unwrap().as_object().unwrap();
        assert!(mcp_servers.is_empty());
    }

    #[test]
    fn test_parse_skill_md_simple() {
        let content = r#"---
name: test-skill
description: A simple test skill
---

# Usage

Some content here.
"#;

        let result = parse_skill_md(content);
        assert!(result.is_some());
        let (name, desc) = result.unwrap();
        assert_eq!(name, "test-skill");
        assert_eq!(desc, Some("A simple test skill".to_string()));
    }

    #[test]
    fn test_parse_skill_md_multiline_description() {
        let content = r#"---
name: agent-reach
description: >
  Give your AI agent eyes to see the entire internet.
  Search and read 16 platforms.
---

# Usage
"#;

        let result = parse_skill_md(content);
        assert!(result.is_some());
        let (name, desc) = result.unwrap();
        assert_eq!(name, "agent-reach");
        assert!(desc.unwrap().contains("eyes to see"));
    }

    #[test]
    fn test_parse_skill_md_no_frontmatter() {
        let content = r#"# Just a regular markdown file

No frontmatter here.
"#;

        let result = parse_skill_md(content);
        assert!(result.is_none());
    }
}
