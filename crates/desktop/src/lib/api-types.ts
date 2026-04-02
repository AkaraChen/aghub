export type {
	CodeEditorType,
	CreateSkillRequest,
	DeleteSkillByPathRequest,
	DeleteSkillByPathResponse,
	GitInstallRequest,
	GitInstallResponse,
	GitInstallResultEntry,
	GitScanRequest,
	GitScanResponse,
	GitScanSkillEntry,
	GlobalSkillLockResponse,
	ImportSkillRequest,
	InstallSkillRequest,
	InstallSkillResponse,
	InstallTarget,
	MarketSkill,
	McpResponse,
	OperationBatchResponse,
	ProjectSkillLockResponse,
	ReconcileRequest,
	SkillResponse,
	SkillTreeNodeResponse,
	ToolInfo,
	TransportDto,
	UpdateMcpRequest,
} from "./api";

export type ConfigSource = "global" | "project";

export const ConfigSource = {
	Global: "global" as ConfigSource,
	Project: "project" as ConfigSource,
} as const;
