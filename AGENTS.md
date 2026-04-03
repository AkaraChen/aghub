# AGHUB KNOWLEDGE BASE

**Project**: aghub — AI coding agent configuration management tool\
**Stack**: Rust workspace + Tauri v2 desktop + React/TypeScript\
**Package Manager**: cargo (Rust), bun (desktop frontend)

## OVERVIEW

Aghub manages AGENTS.md, MCP configs, and skills for 25+ AI assistants through a unified CLI (`aghub-cli`) and desktop app. Stateless design—reads actual config files, tracks capability sources, enforces explicit opt-in for changes.

## STRUCTURE

```
.
├── crates/
│   ├── agents/       # Agent descriptors, models, formats (24 agents)
│   ├── core/         # Orchestration: adapter dispatch, manager, registry, transfer
│   ├── cli/          # CLI binary: aghub-cli
│   ├── api/          # REST API: Rocket HTTP server
│   ├── skill/        # Skill packaging: .skill/.zip format + lock files
│   ├── skills-sh/    # skills.sh registry HTTP client
│   ├── git/          # Git clone with credential injection
│   └── desktop/      # Tauri v2 + React 19 + HeroUI v3
├── .agents/skills/   # Local skill definitions
├── justfile          # Build commands
└── AGENTS.md         # This file
```

## WHERE TO LOOK

| Task               | Location                          | Notes                         |
| ------------------ | --------------------------------- | ----------------------------- |
| Add agent support  | `crates/agents/src/agents/`       | Create `<name>.rs` descriptor |
| Agent models/types | `crates/agents/src/models.rs`     | `AgentConfig`, `AgentType`    |
| Agent registry     | `crates/core/src/registry/mod.rs` | `ALL_AGENTS` array            |
| Config management  | `crates/core/src/manager/mod.rs`  | `ConfigManager` struct        |
| Adapter trait      | `crates/core/src/adapters/mod.rs` | `AgentAdapter` trait          |
| Batch install/copy | `crates/core/src/transfer.rs`     | `OperationBatchResult`        |
| CLI commands       | `crates/cli/src/commands/`        | Clap-based subcommands        |
| API routes         | `crates/api/src/routes/`          | Rocket route handlers         |
| Desktop UI         | `crates/desktop/src/`             | React + HeroUI v3             |

## CONVENTIONS

### Rust

- **Indentation**: Hard tabs (width 4) — NOT spaces
- **Line width**: 80 characters max
- **Formatter**: `rustfmt` for Rust, `prettier` for JS/TS (via `just fmt`)
- **Linter**: `cargo clippy -- -D warnings` (warnings = errors)

### TypeScript/Frontend

- **Package manager**: `bun` (never npm/yarn/pnpm)
- **Framework**: React 19 + HeroUI v3
- **CSS**: Tailwind CSS v4
- **Config**: Strict TypeScript (`strict: true`)

### Code Organization

- One agent = one file in `crates/agents/src/agents/<name>.rs`
- Each agent descriptor defines: config paths, file format, capabilities
- No hand-wired adapters — behavior driven by descriptor function pointers

## COMMANDS

```bash
# Build & Development
just build              # Release build
just dev                # Debug build
just start -- --help    # Run CLI with args

# Testing
just test               # All workspace tests
just integration-test   # Core integration tests only
just test-with-validation  # Requires claude/opencode CLIs

# Code Quality
just fmt                # Format with rustfmt (Rust) and prettier (JS/TS)
just lint               # Clippy (denies warnings)

# Desktop App
cd crates/desktop && bun run dev      # Vite dev
cd crates/desktop && bun run start    # Tauri dev
just desktop                           # Convenience alias

# Install
just install            # Copy aghub-cli to ~/.cargo/bin
```

## ANTI-PATTERNS

### Code Quality

- NEVER use spaces for Rust indentation (hard_tabs enforced)
- NEVER exceed 80 character line width
- NEVER ignore clippy warnings (CI/build treats as errors)

### Adding/Removing Agents

Must touch ALL of these:

1. `crates/agents/src/agents/<name>.rs` — create/delete descriptor constant
2. `crates/agents/src/agents/mod.rs` — add/remove `pub mod`
3. `crates/agents/src/agents/factory.rs` — add/remove dispatch arm
4. `crates/agents/src/models.rs` — add/remove enum variant + `ALL` array + `as_str()` + `from_str()`
5. `crates/core/src/registry/mod.rs` — add/remove from `ALL_AGENTS`

### Agent-Specific Gotchas

- **Claude**: Skills discovered from `~/.claude/skills/` — NOT stored in JSON
- **OpenCode**: Native `mcp` object key (not `mcp_servers` array); SSE/StreamableHttp unified as `remote`
- **Codex/Mistral**: TOML config format (not JSON)
- **Copilot**: Shares `~/.claude/skills/` path with Claude

## NOTES

- Registry fallback: Returns Claude's descriptor if agent ID not found
- `.git` alone is NOT sufficient for project root — needs agent marker (`.claude/`, `.opencode/`, etc.)
- `skills-lock.json` tracks skill dependencies with content hashes
- Desktop HeroUI docs: Search `./.heroui-docs/react/` before implementing UI
- `.impeccable.md` — project code style guide (read before writing Rust)
- `cliff.toml` — changelog generation config (git-cliff, used in release workflow)</content>
