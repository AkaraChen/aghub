pub mod agents;
pub mod descriptor;
pub mod errors;
pub mod format;
pub mod models;

pub use descriptor::{
	AgentDescriptor, Capabilities, GlobalSkillPaths, LoadMcpsFn,
	McpCapabilities, McpParseFn, McpSerializeFn, ProjectSkillPaths, SaveMcpsFn,
	ScopeSupport, SkillCapabilities,
};
pub use errors::{ConfigError, Result};
pub use models::{
	AgentConfig, AgentType, ConfigSource, McpServer, McpTransport,
	ResourceScope, Skill,
};
