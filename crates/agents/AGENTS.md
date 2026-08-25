# AGENTS CRATE KNOWLEDGE BASE

**Crate**: `aghub-agents` — Agent descriptors, models, and format serializers\
**Role in monorepo**: The single source of truth for all agent-specific behavior. `aghub-core` re-exports this crate's public API.

## STRUCTURE

```
crates/agents/src/
├── lib.rs              # Public exports (AgentDescriptor, models, errors, format)
├── descriptor.rs       # AgentDescriptor struct + fn pointer type aliases
├── models.rs           # AgentConfig, AgentType, McpServer, McpTransport, Skill
├── errors.rs           # ConfigError, Result
├── agents/             # One file per supported agent (24 total)
│   ├── mod.rs          # pub mod declarations
│   ├── factory.rs      # create_descriptor() dispatch
│   ├── claude.rs       # Claude descriptor
│   ├── opencode.rs
│   └── ...             # amp, antigravity, augmentcode, cline, codex, copilot,
│                       # cursor, gemini, jetbrains_ai, kilocode, kimi, kiro,
│                       # mistral, openclaw, pi, roocode, trae, warp, windsurf, zed
└── format/
    ├── mod.rs           # Format trait
    ├── json_opencode.rs # OpenCode native format
    ├── json_map.rs      # MCP as JSON object map
    ├── json_list.rs     # MCP as JSON array
    └── toml_format.rs   # TOML (Codex, Mistral)
```

## WHERE TO LOOK

| Task                   | Location                             |
| ---------------------- | ------------------------------------ |
| Add new agent          | `src/agents/<name>.rs` + `mod.rs`    |
| Agent capability flags | `src/descriptor.rs` — `Capabilities` |
| Normalized data types  | `src/models.rs`                      |
| Config serialization   | `src/format/`                        |
| Agent factory/dispatch | `src/agents/factory.rs`              |

## KEY TYPES

**`AgentDescriptor`** (static per agent): holds id, display_name, fn pointers for load_mcps/save_mcps/mcp_parse_config/mcp_serialize_config, path fns, capabilities.

**`Capabilities`**: `{ skills: SkillCapabilities, mcp: McpCapabilities }` — scopes (global/project), transport support (stdio/remote), enable/disable toggle.

**`AgentConfig`**: normalized `{ mcps: Vec<McpServer>, skills: Vec<Skill> }`.

**`McpTransport`**: `Stdio { command, args, env }` | `Sse { url, headers }` | `StreamableHttp { url, headers }`.

## AGENT-SPECIFIC GOTCHAS

- **Claude**: Skills from `~/.claude/skills/` — NOT in JSON; URL-based MCPs silently skipped on serialize
- **OpenCode**: `mcp` object key (not `mcp_servers`); SSE/StreamableHttp unified as `"type": "remote"` — SSE identity lost on roundtrip
- **Codex/Mistral**: TOML config format
- **Copilot**: Shares `~/.claude/skills/` path with Claude
- **SSE transport**: Deprecated in `models.rs` — use `StreamableHttp` instead (SSE identity lost on OpenCode roundtrip anyway)
- **Universal skills** (amp, cline, codex, cursor, gemini, opencode, warp): also read `~/.agents/skills`
- **Registry fallback**: If agent ID unknown, returns Claude's descriptor silently

## ADDING AN AGENT

Must touch ALL of these in this crate:

1. `src/agents/<name>.rs` — descriptor constant (`pub static DESCRIPTOR: AgentDescriptor = AgentDescriptor { ... }`)
2. `src/agents/mod.rs` — `pub mod <name>;`
3. `src/agents/factory.rs` — dispatch arm
4. `src/models.rs` — `AgentType` enum variant + `ALL` array + `as_str()` + `from_str()`

Then in `crates/core`: `src/registry/mod.rs` — add `&agents::<name>::DESCRIPTOR` to `ALL_AGENTS`.

## ANTI-PATTERNS

- NEVER add an agent to `agents/` without wiring `factory.rs` and `models.rs`
- NEVER hand-wire adapter structs — behavior is entirely in `AgentDescriptor` fn pointers
- NEVER use `AgentType` string literals — always use `as_str()` / `from_str()`
- NEVER make `AgentDescriptor` fields non-Copy — must remain `'static`
