//! # aghub-core
//!
//! Core library for managing Code Agent configurations.
//!
//! This crate provides a unified interface for reading and writing
//! configurations for Claude Code and OpenCode agents.
//!
//! ## Example
//!
//! ```rust,no_run
//! use aghub_core::{
//!     adapters::create_adapter,
//!     manager::ConfigManager,
//!     models::{McpServer, McpTransport},
//!     AgentType,
//! };
//!
//! fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     // Create an adapter for Claude Code
//!     let adapter = create_adapter(AgentType::Claude);
//!     let mut manager = ConfigManager::new(adapter, true, None);
//!
//!     // Load existing config
//!     manager.load()?;
//!
//!     // Add an MCP server
//!     let mcp = McpServer::new(
//!         "filesystem",
//!         McpTransport::command(
//!             "npx",
//!             vec!["-y".to_string(), "@modelcontextprotocol/server-filesystem".to_string(), "/tmp".to_string()],
//!         ),
//!     );
//!     manager.add_mcp(mcp)?;
//!
//!     Ok(())
//! }
//! ```

pub mod adapters;
pub mod errors;
pub mod manager;
pub mod models;
pub mod paths;

#[cfg(feature = "testing")]
pub mod testing;

// Re-export commonly used items
pub use adapters::{create_adapter, AgentAdapter};
pub use errors::{ConfigError, Result};
pub use manager::ConfigManager;
pub use models::AgentType;
