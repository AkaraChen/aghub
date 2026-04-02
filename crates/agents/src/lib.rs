pub mod agents;
pub mod descriptor;
pub mod errors;
pub mod format;
pub mod models;

pub use descriptor::{
	AgentDescriptor, Capabilities, LoadMcpsFn, McpParseFn, McpSerializeFn,
	SaveMcpsFn,
};
pub use errors::{ConfigError, Result};
pub use models::{
	AgentConfig, AgentType, ConfigSource, McpServer, McpTransport,
	ResourceScope, Skill,
};
