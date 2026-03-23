# API CRATE KNOWLEDGE BASE

**Crate**: `aghub-api` — REST API server for aghub  
**Framework**: Rocket v0.5 + rocket_cors  
**Domain**: HTTP API exposing agent config operations

## STRUCTURE

```
crates/api/src/
├── main.rs             # Binary entry point
├── lib.rs              # Library exports, route mounting
├── state.rs            # AppState, agent registry
├── dto/                # Data transfer objects
│   └── mod.rs
├── error.rs            # API error types
├── extractors/         # Rocket request guards
│   └── mod.rs
└── routes/             # HTTP route handlers
    ├── mod.rs
    ├── agents.rs       # GET /agents, /agents/check
    ├── catchers.rs     # Error catchers
    ├── mcps.rs         # MCP CRUD endpoints
    ├── skills.rs       # Skill CRUD endpoints
    └── market.rs       # skills.sh search
```

## ROUTES

Mounted at `/api/v1/`:

| Method | Path | Handler |
|--------|------|---------|
| GET | `/agents` | `list_agents` |
| GET | `/agents/check` | `check_availability` |
| GET | `/market/search` | `search_market` |
| GET | `/skills` | `list_all_agents_skills` |
| GET | `/skills/:agent` | `list_skills` |
| POST | `/skills/:agent` | `create_skill` |
| GET | `/skills/:agent/:name` | `get_skill` |
| PUT | `/skills/:agent/:name` | `update_skill` |
| DELETE | `/skills/:agent/:name` | `delete_skill` |
| POST | `/skills/:agent/:name/enable` | `enable_skill` |
| POST | `/skills/:agent/:name/disable` | `disable_skill` |
| GET | `/mcps` | `list_all_agents_mcps` |
| GET | `/mcps/:agent` | `list_mcps` |
| POST | `/mcps/:agent` | `create_mcp` |
| GET | `/mcps/:agent/:name` | `get_mcp` |
| PUT | `/mcps/:agent/:name` | `update_mcp` |
| DELETE | `/mcps/:agent/:name` | `delete_mcp` |
| POST | `/mcps/:agent/:name/enable` | `enable_mcp` |
| POST | `/mcps/:agent/:name/disable` | `disable_mcp` |

## CORS CONFIGURATION

- Allowed origins: All (`AllOrSome::All`)
- Allowed methods: GET, POST, PUT, DELETE
- Allowed headers: Authorization, Accept, Content-Type
- Credentials: allowed

## RUNNING

```bash
# Run API server
cargo run -p aghub-api

# Or with custom port
cargo run -p aghub-api -- --port 8080
```

Default: localhost:8000

## DEPENDENCIES

- `aghub-core` — Core library
- `skills-sh` — skills.sh registry client
- `rocket` — Web framework
- `rocket_cors` — CORS support
- `tokio` — Async runtime

## PATTERNS

- Uses `AppState` for shared agent registry
- Routes extract agent type from path params
- Delegates to `ConfigManager` for actual operations
- Error handling via Rocket catchers

## ANTI-PATTERNS

- NEVER expose raw filesystem paths in API responses
- NEVER bypass `ConfigManager` — always use adapter pattern
- NEVER modify CORS to allow credentials without explicit headers
</content>