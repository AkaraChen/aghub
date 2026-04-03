pub mod agents;
pub mod codex_sub_agents;
pub mod descriptor;
pub mod errors;
pub mod format;
pub mod models;
pub mod sub_agents;

pub use descriptor::{
	AgentDescriptor, Capabilities, GlobalSkillPaths, LoadMcpsFn,
	LoadSubAgentsFn, McpCapabilities, McpParseFn, McpSerializeFn,
	ProjectSkillPaths, SaveMcpsFn, SaveSubAgentsFn, ScopeSupport,
	SkillCapabilities, SubAgentCapabilities,
};
pub use errors::{ConfigError, Result};
pub use models::{
	AgentConfig, AgentType, ConfigSource, McpServer, McpTransport,
	ResourceScope, Skill, SubAgent,
};
