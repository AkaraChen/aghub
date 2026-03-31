export enum ConfigSource {
	Global = "global",
	Project = "project",
}

export type InstallScope = "global" | "project";

export interface InstallTarget {
	agent: string;
	scope: InstallScope;
	project_root?: string;
}

export interface ReconcileRequest {
	source: {
		agent: string;
		scope: InstallScope;
		project_root?: string;
		name: string;
	};
	added?: string[];
	removed?: string[];
}

export type OperationAction = "copy" | "delete";

export interface OperationResult {
	agent: string;
	scope: InstallScope;
	project_root?: string;
	action: OperationAction;
	success: boolean;
	error?: string;
}

export interface OperationBatchResponse {
	success_count: number;
	failed_count: number;
	results: OperationResult[];
}

export interface SkillResponse {
	name: string;
	enabled: boolean;
	source_path?: string;
	canonical_path?: string;
	description?: string;
	author?: string;
	version?: string;
	tools: string[];
	source?: ConfigSource;
	agent?: string;
}

export type SkillTreeNodeKind = "file" | "directory";

export interface SkillTreeNodeResponse {
	name: string;
	path: string;
	kind: SkillTreeNodeKind;
	children: SkillTreeNodeResponse[];
}

export type TransportDto =
	| {
			type: "stdio";
			command: string;
			args?: string[];
			env?: Record<string, string>;
			timeout?: number;
	  }
	| {
			type: "sse";
			url: string;
			headers?: Record<string, string>;
			timeout?: number;
	  }
	| {
			type: "streamable_http";
			url: string;
			headers?: Record<string, string>;
			timeout?: number;
	  };

export interface McpResponse {
	name: string;
	enabled: boolean;
	transport: TransportDto;
	timeout?: number;
	source?: ConfigSource;
	agent?: string;
}

export interface CreateSkillRequest {
	name: string;
	description?: string;
	author?: string;
	version?: string;
	content?: string;
	tools?: string[];
}

export interface MarketSkill {
	name: string;
	slug: string;
	source: string;
	installs: number;
	author?: string;
}

export interface InstallSkillRequest {
	source: string;
	agents: string[];
	skills: string[];
	scope: "global" | "project";
	project_path?: string;
	install_all?: boolean;
}

export interface InstallSkillResponse {
	success: boolean;
	stdout: string;
	stderr: string;
	exit_code: number;
}

export type CodeEditorType = string;

export interface ToolInfo {
	id: string;
	name: string;
	installed: boolean;
	path?: string;
}

export interface ImportSkillRequest {
	path: string;
}

export interface SkillLockEntryResponse {
	name: string;
	source: string;
	sourceType: string;
	sourceUrl: string;
	skillPath?: string;
	skillFolderHash: string;
	installedAt: string;
	updatedAt: string;
	pluginName?: string;
}

export interface GlobalSkillLockResponse {
	version: number;
	skills: SkillLockEntryResponse[];
	lastSelectedAgents?: string[];
}

export interface LocalSkillLockEntryResponse {
	name: string;
	source: string;
	sourceType: string;
	computedHash: string;
}

export interface ProjectSkillLockResponse {
	version: number;
	skills: LocalSkillLockEntryResponse[];
}

export interface DeleteSkillByPathRequest {
	source_path: string;
	agents: string[];
	scope: "global" | "project";
	project_root?: string;
}

export interface ValidationError {
	agent: string;
	reason: string;
}

export interface DeleteSkillByPathResponse {
	success: boolean;
	deleted_path?: string;
	error?: string;
	validation_errors?: ValidationError[];
}
