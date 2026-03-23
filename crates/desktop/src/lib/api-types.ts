export interface SkillResponse {
	name: string;
	enabled: boolean;
	source_path?: string;
	description?: string;
	author?: string;
	version?: string;
	tools: string[];
	source?: "Global" | "Project";
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
	source?: "Global" | "Project";
	agent?: string;
}

export interface CreateSkillRequest {
	name: string;
	description?: string;
	author?: string;
	version?: string;
	tools?: string[];
}

export interface MarketSkill {
	name: string;
	slug: string;
	source: string;
	installs: number;
}
