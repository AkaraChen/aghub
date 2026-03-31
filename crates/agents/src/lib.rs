pub mod agents;
pub mod descriptor;
pub mod errors;
pub mod format;
pub mod models;

pub use descriptor::{AgentDescriptor, Capabilities, ParseFn, SerializeFn};
pub use errors::{ConfigError, Result};
pub use models::{
	AgentConfig, AgentType, ConfigSource, McpServer, McpTransport,
	ResourceScope, Skill,
};
