//! Aggregates MCP server listings from catalog sources.
//!
//! Today it speaks to the official MCP Registry
//! (`registry.modelcontextprotocol.io`), a public, no-auth read API designed for
//! aggregator/client consumption. The output is normalized into source-neutral
//! [`McpCatalogEntry`] values so additional sources (other registries, GitHub
//! import) can be added behind the same surface later.

pub mod client;
pub mod types;

pub use client::{Client, ClientBuilder, ClientError};
pub use types::{McpCatalogEntry, McpCatalogEnv};
