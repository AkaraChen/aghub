# MCP-CATALOG CRATE KNOWLEDGE BASE

**Crate**: `mcp-catalog` — aggregates MCP server listings from catalog sources\
**Used by**: `aghub-api` (MCP marketplace search endpoint)

## STRUCTURE

```text
crates/mcp-catalog/src/
├── lib.rs      # Public client and catalog install-plan exports
├── client.rs   # Client, ClientBuilder — reqwest-based HTTP client
└── types.rs    # Catalog install plan + raw registry shapes + mapping
```

## WHERE TO LOOK

| Task                   | File                                 |
| ---------------------- | ------------------------------------ |
| Search a source        | `src/client.rs` — `Client::search()` |
| Registry→entry mapping | `src/types.rs` — `map_detail()`      |
| Output types           | `src/types.rs`                       |
| Custom base URL        | `ClientBuilder::api_url()`           |

## USAGE

```rust
let client = mcp_catalog::Client::from_env()?;
let entries = client.search("github", 60).await?; // empty query => latest servers
```

Today the only source is the official MCP Registry
(`registry.modelcontextprotocol.io`, public/no-auth). Output is source-neutral
(`McpCatalogEntry`) rather than exposing registry wire types. Override the
registry base URL via `MCP_REGISTRY_URL`.

## ANTI-PATTERNS

- NEVER derive ts-rs / wire DTOs here — wire contracts live in `aghub-api` (`dto/mcp_market.rs`), which maps `McpCatalogEntry` → `MarketMcpServer`.
- NEVER hardcode a source base URL — use `MCP_REGISTRY_URL` for testing.
- Preserve argument, variable, and secret metadata in the install plan; resolve
  user inputs at the client boundary.
- When adding a second source, keep `McpCatalogEntry` source-neutral; do not add a `trait Source` until there is a real second implementation.
