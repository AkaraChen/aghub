pub mod agents;
pub mod descriptor;
pub mod errors;
pub mod format;
pub mod macros;
pub mod models;
pub mod sub_agents;

pub use descriptor::{
	AgentDescriptor, AgentSurface, AgentSurfaceKind, Capabilities,
	GlobalSkillPaths, GlobalSubAgentPaths, LoadMcpsFn, LoadSubAgentsFn,
	McpCapabilities, McpParseFn, McpReadSource, McpSerializeFn,
	ProjectSkillPaths, ProjectSubAgentPaths, ResourcePrecedence, SaveMcpsFn,
	SaveSubAgentsFn, ScopePrecedence, ScopeSupport, SkillCapabilities,
	SkillDiscovery, SkillReadSource, SkillSourceClassification,
	SkillSourceClassifier, SubAgentCapabilities,
};
pub use errors::{ConfigError, Result};
pub use models::{
	AgentConfig, AgentType, ConfigSource, McpServer, McpTransport,
	ResourceOrigin, ResourceScope, ResourceSourceKind, ResourceWritePolicy,
	RuntimeVisibility, Skill, SubAgent,
};
