//! Aggregates MCP server listings from catalog sources.
//!
//! Today it speaks to the official MCP Registry
//! (`registry.modelcontextprotocol.io`), a public, no-auth read API designed for
//! aggregator/client consumption. Registry wire shapes are normalized into
//! source-neutral [`McpCatalogEntry`] values before crossing the crate boundary.

pub mod client;
mod model;
mod network;
mod normalize;
mod registry;

pub use client::{Client, ClientBuilder, ClientError};
pub use model::{
	McpCatalogArgument, McpCatalogEntry, McpCatalogInput,
	McpCatalogInstallMethod, McpCatalogKeyValue, McpCatalogTransport,
	McpCatalogValue,
};
