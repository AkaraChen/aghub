use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct ScopeSupportDto {
	pub global: bool,
	pub project: bool,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct SkillCapabilitiesDto {
	pub scopes: ScopeSupportDto,
	pub universal: bool,
	pub mutable_global: bool,
	pub mutable_project: bool,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct McpCapabilitiesDto {
	pub scopes: ScopeSupportDto,
	pub stdio: bool,
	pub remote: bool,
	pub enable_disable: bool,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct SubAgentCapabilitiesDto {
	pub scopes: ScopeSupportDto,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct CapabilitiesDto {
	pub skills: SkillCapabilitiesDto,
	pub mcp: McpCapabilitiesDto,
	pub sub_agents: SubAgentCapabilitiesDto,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct SkillsPathsDto {
	pub global_read: Vec<String>,
	pub global_write: Option<String>,
	pub project_read: Vec<String>,
	pub project_write: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct AgentInfo {
	pub id: String,
	pub display_name: String,
	pub capabilities: CapabilitiesDto,
	pub skills_paths: SkillsPathsDto,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct AgentAvailabilityDto {
	pub id: String,
	pub has_global_directory: bool,
	pub has_cli: bool,
	pub is_available: bool,
}
