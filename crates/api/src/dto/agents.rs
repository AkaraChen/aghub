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
	pub sse: bool,
	pub streamable_http: bool,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AgentSurfaceKindDto {
	Cli,
	Ide,
	Desktop,
	Cloud,
	RemoteWorkspace,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct AgentSurfaceInfoDto {
	pub id: String,
	pub kind: AgentSurfaceKindDto,
	pub capabilities: CapabilitiesDto,
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
	pub surfaces: Vec<AgentSurfaceInfoDto>,
	pub capabilities: CapabilitiesDto,
	pub skills_paths: SkillsPathsDto,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum DetectionStateDto {
	Detected,
	NotDetected,
	Unknown,
	Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum DetectionProbeKindDto {
	Command,
	Path,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum DetectionResultDto {
	Detected,
	Absent,
	Error,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct DetectionEvidenceDto {
	pub kind: DetectionProbeKindDto,
	pub target: String,
	pub result: DetectionResultDto,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub detail: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct ConfigurationEvidenceDto {
	pub path: String,
	pub exists: bool,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct AgentSurfaceAvailabilityDto {
	pub id: String,
	pub kind: AgentSurfaceKindDto,
	pub state: DetectionStateDto,
	pub configured: bool,
	pub evidence: Vec<DetectionEvidenceDto>,
	pub configuration: Vec<ConfigurationEvidenceDto>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct AgentAvailabilityDto {
	pub id: String,
	pub state: DetectionStateDto,
	pub configured: bool,
	pub surfaces: Vec<AgentSurfaceAvailabilityDto>,
}
