# CLI CRATE

**Crate**: `aghub` — Binary providing the `aghub-cli` CLI tool.

## OVERVIEW

Command-line interface for managing AI agent configurations. Uses clap derive macros for argument parsing and dispatches to subcommand handlers.

## STRUCTURE

```
src/
├── main.rs           # Entry point, CLI parsing, command dispatch
├── commands/
│   ├── mod.rs        # Module exports
│   ├── get.rs        # List resources (skills, mcps)
│   ├── add.rs        # Add resources with options
│   ├── update.rs     # Update existing resources
│   ├── delete.rs     # Delete resources
│   ├── enable.rs     # Enable disabled resources
│   └── disable.rs    # Disable resources
└── ui/               # (reserved for UI utilities)
```

## WHERE TO LOOK

| Task                | Location                            | Notes                             |
| ------------------- | ----------------------------------- | --------------------------------- |
| Add CLI flag        | `src/main.rs`                       | Modify `Cli` or `Commands` struct |
| Add subcommand      | `src/commands/<name>.rs` + `mod.rs` | Follow existing command pattern   |
| Resource type alias | `src/main.rs:ResourceType`          | Add `#[value(alias = "...")]`     |
| Table output format | `src/commands/get.rs`               | Uses `tabled` crate               |
| CLI tests           | `tests/cli_tests.rs`                | Uses `assert_cmd`                 |

## COMMANDS

```bash
# Build this crate only
cargo build -p aghub

# Run with args
cargo run -p aghub -- get skills
cargo run -p aghub -- add mcp my-server --command "npx -y @modelcontextprotocol/server-filesystem /path"

# Test this crate only
cargo test -p aghub

# Install locally (from workspace root)
just install
```

## ANTI-PATTERNS

- **Don't** use `println!` for diagnostic output — use `eprintln_verbose!` macro
- **Don't** add `--interactive` as a global flag — use the `interactive` subcommand pattern instead
- **Don't** hardcode agent type strings — use `AgentType` enum and `to_string()`
- **Don't** bypass `ConfigManager` — all config operations go through the manager
