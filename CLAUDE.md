# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aghub is a CLI tool (`agentctl`) for managing AI coding agent configurations. It supports 22 agents (Claude, OpenCode, Cursor, Windsurf, Copilot, RooCode, Cline, Gemini, Codex, Zed, Warp, and more), handling MCP servers and skills through a unified interface. Full agent list: `crates/core/src/models.rs` or `agentctl --help`.

## Common Commands

Use `just` for task running:

```bash
# Build
just dev          # Debug build
just build        # Release build

# Test
just test         # Run all tests
just integration-test  # Run integration tests only
just test-with-validation  # Tests requiring real CLI tools installed (claude, opencode, etc.)

# Lint/Format
just lint         # Run clippy with warnings as errors
just fmt          # Format code

# Run
just start -- --help                    # Run with cargo
just start -- -a claude get skills      # List skills
just start -- -a claude get mcps        # List MCP servers
just install                            # Release build → ~/.cargo/bin/
```

Run a single test: `cargo test --package aghub-core test_name -- --exact`

## Architecture

### Workspace Structure

- **`crates/core`** (`aghub-core`): Core library with models, config management, and agent adapters
- **`crates/cli`** (`aghub`): CLI binary (`agentctl`) with clap-based commands
- **`crates/skills-sh`**: HTTP API client for skills.sh registry (`SKILLS_API_URL` env var overrides base URL)
- **`crates/skills-ref`** (`skills-ref`): Parses SKILL.md files, validates `SkillProperties`, generates XML prompt blocks via `to_prompt()`
- **`crates/skill`** (`skill`): Extends skills-ref with `.skill` zip format; `parse()` auto-detects directory/zip/SKILL.md. Called by `manager.add_skill_from_path()`
- **`crates/api`**: Axum-based HTTP API server exposing agent config operations over HTTP

### Key Design Patterns

**Adapter Pattern**: `AgentAdapter` trait in `crates/core/src/adapters/mod.rs`. All agents are dispatched through `create_adapter(agent_type)` → `registry::get(agent_type)` → `&'static AgentDescriptor`, which implements `AgentAdapter` via `adapter.rs`. There are no hand-wired adapter structs — behavior is entirely driven by function pointers on each descriptor.

**Normalized Model**: `AgentConfig` in `models.rs` provides a unified representation with:

- `Vec<Skill>`: Skills with frontmatter metadata (name, description, author, version, tools)
- `Vec<McpServer>`: MCP servers with `McpTransport` (Stdio, Sse, StreamableHttp variants)

**ConfigManager**: Central abstraction in `manager.rs` that coordinates adapter operations and provides CRUD methods for resources.

### Agent-Specific Behavior

Agent behavior is defined entirely in `crates/core/src/agents/<name>.rs` descriptor constants. Key notes:

- **Claude**: skills are NOT stored in JSON; discovered from `~/.claude/skills/` SKILL.md files. URL-based MCPs silently skipped on serialize.
- **OpenCode**: uses native format with `mcp` object key (not `mcp_servers` array). SSE and StreamableHttp transports are unified as `"type": "remote"` — SSE transport identity is lost on roundtrip. Reads skills only from the universal path (no agent-specific skills dir).
- **Codex/Mistral**: TOML config format.
- **Amp, Cline, Codex, Cursor, Gemini, OpenCode, Warp** (`capabilities.universal_skills: true`): also read from `$XDG_CONFIG_HOME/agents/skills` (default `~/.config/agents/skills`) in addition to any agent-specific skills dir.
- **Copilot**: shares `~/.claude/skills/` as its skills path (same as Claude).
- **`registry::get()` fallback**: returns Claude's descriptor silently if the requested agent ID is not found.

### CLI Command Surface

```
agentctl [-a <agent>] [-g|--global] [-p|--project] [-v|--verbose] <command>

Commands:
  get    <skills|mcps>               # list resources
  add    <skills|mcps>               # --name, --from PATH, --command, --url, --transport,
                                     #   --header KEY:VALUE, --env KEY=VAL, --description,
                                     #   --author, --version, --tools
  update <skills|mcps> <name>        # same flags as add
  delete <skills|mcps> <name>
  enable/disable <skills|mcps> <name> # soft toggle; only meaningful for OpenCode
  describe <skills|mcps> <name>      # JSON output for a single resource
  interactive                        # step-by-step wizard
```

Resource type aliases: `skills`/`skill`, `mcps`/`mcp`.

### Skills Discovery

Skills are loaded from directories containing `SKILL.md` files. The adapter parses YAML frontmatter (between `---` markers) to extract metadata like name, description, author, and version. The `source_path: Option<String>` field on `Skill` records the file path where the skill was loaded from.

### Adding/Removing Agents

Touch all of these when adding or removing an agent:
1. `crates/core/src/agents/` — create or delete the `<name>.rs` descriptor file
2. `crates/core/src/agents/mod.rs` — add/remove `pub mod <name>;`
3. `crates/core/src/registry/mod.rs` — add/remove `&agents::<name>::DESCRIPTOR` from `ALL_AGENTS`
4. `crates/core/src/models.rs` — add/remove enum variant, `ALL` array entry, `as_str()` arm, `from_str()` arm

### Testing

Integration tests in `crates/core/tests/integration_tests.rs` use a `TestConfig` helper to create isolated temp directories with `.claude/` or `.opencode/` structures.

For test isolation, `TestConfig` uses `crate::adapter::set_skills_path_override(agent_id, path)` (per-agent thread-local).

Additional test files:
- `crates/core/tests/mcp_tests.rs`: MCP-specific behavior, transport types, deduplication
- `crates/core/tests/test_agent_paths.rs`: XDG-compliant skills path configuration per agent
- `crates/cli/tests/cli_tests.rs`: End-to-end CLI tests via `assert_cmd`

## Configuration Paths Reference

| Agent    | Global Config                      | Project Config            | Skills Path         |
| -------- | ---------------------------------- | ------------------------- | ------------------- |
| Claude   | `~/.claude.json`                   | `.mcp.json`               | `~/.claude/skills/` |
| OpenCode | `~/.config/opencode/opencode.json` | `.opencode/settings.json` | -                   |

Project root is detected by walking up directories looking for agent markers (`.claude/`, `.opencode/`, `.cursor/`, `.mcp.json`, etc.). `.git` alone is NOT sufficient — the directory must also contain at least one agent marker.
