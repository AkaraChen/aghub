use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct CapabilitiesDto {
	pub mcp_stdio: bool,
	pub mcp_remote: bool,
	pub mcp_enable_disable: bool,
	pub skills: bool,
	pub skills_mutable: bool,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct SkillsPathsDto {
	pub project: Vec<String>,
	pub global: Vec<String>,
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
