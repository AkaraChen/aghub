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
│   ├── core/         # Core library: adapters, models, registry (44 files)
│   ├── cli/          # CLI binary: aghub-cli
│   ├── api/          # REST API: Rocket HTTP server
│   ├── skill/        # Skill packaging: .skill/.zip format
│   ├── skills-sh/    # skills.sh registry client
│   └── desktop/      # Tauri + React + HeroUI v3
├── .agents/skills/   # Local skill definitions
├── justfile          # Build commands
└── AGENTS.md         # This file
```

## WHERE TO LOOK

| Task              | Location                          | Notes                         |
| ----------------- | --------------------------------- | ----------------------------- |
| Add agent support | `crates/core/src/agents/`         | Create `<name>.rs` descriptor |
| Agent registry    | `crates/core/src/registry/mod.rs` | `ALL_AGENTS` array            |
| Config management | `crates/core/src/manager/mod.rs`  | `ConfigManager` struct        |
| Data models       | `crates/core/src/models.rs`       | `AgentConfig`, `AgentType`    |
| Adapter trait     | `crates/core/src/adapters/mod.rs` | `AgentAdapter` trait          |
| CLI commands      | `crates/cli/src/commands/`        | Clap-based subcommands        |
| API routes        | `crates/api/src/routes/`          | Rocket route handlers         |
| Desktop UI        | `crates/desktop/src/`             | React + HeroUI v3             |

## CONVENTIONS

### Rust

- **Indentation**: Hard tabs (width 4) — NOT spaces
- **Line width**: 80 characters max
- **Formatter**: `fama` (via `just fmt`)
- **Linter**: `cargo clippy -- -D warnings` (warnings = errors)

### TypeScript/Frontend

- **Package manager**: `bun` (never npm/yarn/pnpm)
- **Framework**: React 19 + HeroUI v3
- **CSS**: Tailwind CSS v4
- **Config**: Strict TypeScript (`strict: true`)

### Code Organization

- One agent = one file in `crates/core/src/agents/<name>.rs`
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
just fmt                # Format with fama
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

1. `crates/core/src/agents/<name>.rs` — create/delete descriptor
2. `crates/core/src/agents/mod.rs` — add/remove `pub mod`
3. `crates/core/src/registry/mod.rs` — add/remove from `ALL_AGENTS`
4. `crates/core/src/models.rs` — add/remove enum variant + `ALL` array + `as_str()` + `from_str()`

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
  </content>
