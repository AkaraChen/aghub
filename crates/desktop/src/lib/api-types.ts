export enum ConfigSource {
	Global = "global",
	Project = "project",
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
	scope: "global" | "project";
	project_path?: string;
}

export interface InstallSkillResponse {
	success: boolean;
	stdout: string;
	stderr: string;
	exit_code: number;
}

export type CodeEditorType =
	| "vscode"
	| "antigravity"
	| "cursor"
	| "zed"
	| "vim";

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
