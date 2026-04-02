# CORE CRATE KNOWLEDGE BASE

**Crate**: `aghub-core` — Core library for agent configuration management\
**Domain**: Adapter pattern, config parsing, agent registry, skills discovery

## STRUCTURE

```
crates/core/src/
├── lib.rs              # Public exports, skill conversion
├── models.rs           # AgentConfig, AgentType, McpServer, Skill
├── errors.rs           # ConfigError, Result
├── paths.rs            # XDG-compliant path utilities
├── availability.rs     # Agent CLI availability detection
├── all_agents.rs       # Agent resource loading
├── adapter.rs          # Adapter dispatch logic
├── adapters/
│   └── mod.rs          # AgentAdapter trait, create_adapter()
├── agents/             # 22 agent descriptors (one per file)
│   ├── claude.rs
│   ├── opencode.rs
│   ├── cursor.rs
│   └── ...
├── registry/
│   └── mod.rs          # AgentDescriptor registry, ALL_AGENTS
├── manager/
│   ├── mod.rs          # ConfigManager (CRUD operations)
│   ├── mcp.rs          # MCP server management
│   └── skill.rs        # Skill management
├── format/
│   ├── mod.rs          # Format trait
│   ├── json_opencode.rs
│   ├── json_map.rs
│   ├── json_list.rs
│   └── toml_format.rs
├── skills/
│   └── mod.rs          # Skills discovery from SKILL.md files
└── testing.rs          # TestConfig, TestConfigBuilder
```

## KEY PATTERNS

### Adapter Pattern

All agents implement `AgentAdapter` trait. No hand-wired structs — behavior defined by function pointers in `AgentDescriptor`:

```rust
pub struct AgentDescriptor {
    pub id: AgentType,
    pub name: &'static str,
    pub mcp_global_path: fn() -> PathBuf,
    pub mcp_project_path: fn(&Path) -> PathBuf,
    pub global_data_dir: fn() -> PathBuf,
    pub load_mcps: LoadMcpsFn,
    pub save_mcps: SaveMcpsFn,
    pub capabilities: Capabilities,
    // ... MCP/skills function pointers and validation metadata
}
```

### Normalized Model

`AgentConfig` provides unified representation:

- `Vec<Skill>` — with frontmatter metadata (name, description, author, version, tools)
- `Vec<McpServer>` — with `McpTransport` variants (Stdio, Sse, StreamableHttp)

### ConfigManager

Central abstraction coordinating adapter operations:

- `load()` / `save()` — MCP persistence + skills aggregation
- `load_both()` — merge project + global configs
- `scope: ResourceScope` — GlobalOnly, ProjectOnly, Both

### Skills Discovery

Skills loaded from directories containing `SKILL.md` files:

- Parses YAML frontmatter (between `---` markers)
- `source_path` field records file path with `~` prefix

## WHERE TO LOOK

| Task                  | Location                                                 |
| --------------------- | -------------------------------------------------------- |
| Add new agent         | `src/agents/<name>.rs` + `registry/mod.rs` + `models.rs` |
| Modify agent behavior | Agent's descriptor file in `src/agents/`                 |
| Config serialization  | `src/format/` — format-specific modules                  |
| Path handling         | `src/paths.rs`                                           |
| Test utilities        | `src/testing.rs` — `TestConfig`, `TestConfigBuilder`     |
| Agent detection       | `src/availability.rs`                                    |

## CONVENTIONS

- One agent = one descriptor file in `src/agents/`
- Agent IDs are `snake_case` in code, `kebab-case` in CLI
- All paths use `~` prefix for home directory (converted at I/O boundary)
- Deduplication: Skills by name (project takes precedence), MCPs not deduplicated

## TESTING

```bash
# Run core tests
cargo test -p aghub-core

# Integration tests only
cargo test -p aghub-core --test integration_tests

# Tests requiring real agent CLIs
cargo test -p aghub-core --features agent-validation
```

Test utilities in `src/testing.rs` provide isolated temp directories per test.

## ANTI-PATTERNS

- NEVER modify `AgentAdapter` trait without updating ALL agent descriptors
- NEVER add agent to `agents/` without registering in `registry/mod.rs`
- NEVER ignore `source_path` — required for skill provenance tracking
- NEVER use non-XDG paths — always use `dirs` crate helpers
  </content>
