# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aghub is a CLI tool (`agentctl`) for managing AI coding agent configurations. It supports Claude Code and OpenCode agents, handling MCP servers, skills, and sub-agents through a unified interface.

## Common Commands

Use `just` for task running:

```bash
# Build
just dev          # Debug build
just build        # Release build

# Test
just test         # Run all tests
just integration-test  # Run integration tests only

# Lint/Format
just lint         # Run clippy with warnings as errors
just fmt          # Format code

# Run
just start -- --help                    # Run with cargo
just start -- -a claude get skills      # List skills
just start -- -a claude get mcps        # List MCP servers
```

Run a single test: `cargo test --package aghub-core test_name -- --exact`

## Architecture

### Workspace Structure

- **`crates/core`** (`aghub-core`): Core library with models, config management, and agent adapters
- **`crates/cli`** (`aghub`): CLI binary (`agentctl`) with clap-based commands
- **`crates/skills-sh`**: HTTP API client for skills.sh registry

### Key Design Patterns

**Adapter Pattern**: `AgentAdapter` trait in `crates/core/src/adapters/mod.rs` abstracts differences between Claude Code and OpenCode config formats. Each adapter handles:

- Path resolution (global vs project-scoped configs)
- Parsing agent-specific JSON into normalized `AgentConfig`
- Serializing back to agent-specific format
- Validation commands

**Normalized Model**: `AgentConfig` in `models.rs` provides a unified representation with:

- `Vec<Skill>`: Skills with frontmatter metadata (name, description, author, version, tools)
- `Vec<McpServer>`: MCP servers with `McpTransport` (Command or URL variant)
- `Vec<SubAgent>`: Sub-agent configurations

**ConfigManager**: Central abstraction in `manager.rs` that coordinates adapter operations and provides CRUD methods for resources.

### Agent-Specific Behavior

**Claude Code** (`adapters/claude.rs`):

- Global config: `~/.claude.json` (MCP servers only)
- Project config: `.mcp.json` in project root
- Skills directory: `~/.claude/skills/` (loaded from SKILL.md files with YAML frontmatter)
- Skills are NOT stored in JSON; they're discovered from filesystem
- Sub-agents not supported (silently ignored)
- URL-based MCPs not supported (silently skipped on serialize)

**OpenCode** (`adapters/opencode.rs`):

- Global config: `~/.config/opencode/opencode.json` (macOS/Linux)
- Project config: `.opencode/settings.json`

### Skills Discovery

Skills are loaded from directories containing `SKILL.md` files. The adapter parses YAML frontmatter (between `---` markers) to extract metadata like name, description, author, and version. The `source` field was recently removed from the Skill struct.

### Testing

Integration tests in `crates/core/tests/integration_tests.rs` use a `TestConfig` helper to create isolated temp directories with `.claude/` or `.opencode/` structures.

Use `CLAUDE_SKILLS_PATH` env var to override skills directory for testing.

## Configuration Paths Reference

| Agent    | Global Config                      | Project Config            | Skills Path         |
| -------- | ---------------------------------- | ------------------------- | ------------------- |
| Claude   | `~/.claude.json`                   | `.mcp.json`               | `~/.claude/skills/` |
| OpenCode | `~/.config/opencode/opencode.json` | `.opencode/settings.json` | -                   |

Project root is detected by looking for `.claude/`, `.opencode/`, `.mcp.json`, or `.git` (as fallback).
