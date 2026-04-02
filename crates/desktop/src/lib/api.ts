import ky from "ky";
import type {
	AgentAvailabilityDto,
	AgentInfo,
	CodeEditorType,
	CreateCredentialRequest as CreateCredentialDto,
	CreateMcpRequest as CreateMcpDto,
	CreateSkillRequest as CreateSkillDto,
	CredentialResponse,
	DeleteSkillByPathRequest as DeleteSkillByPathDto,
	DeleteSkillByPathResponse,
	GitInstallRequest as GitInstallDto,
	GitInstallResponse,
	GitInstallResultEntry,
	GitScanRequest as GitScanDto,
	GitScanResponse,
	GitScanSkillEntry,
	GlobalSkillLockResponse,
	ImportSkillRequest as ImportSkillDto,
	InstallSkillRequest as InstallSkillDto,
	InstallSkillResponse,
	MarketSkill,
	McpResponse,
	OperationBatchResponse,
	ProjectSkillLockResponse,
	SkillResponse,
	SkillTreeNodeResponse,
	TargetDto,
	ToolInfoDto,
	TransferRequest as TransferDto,
	TransportDto,
	UpdateMcpRequest as UpdateMcpDto,
} from "../generated/dto";

export interface CreateCredentialRequest {
	name: string;
	token: string;
}

export interface CreateSkillRequest {
	name: string;
	description?: string;
	author?: string;
	version?: string;
	content?: string;
	tools?: string[];
}

export interface ImportSkillRequest {
	path: string;
}

export interface InstallSkillRequest {
	source: string;
	agents: string[];
	skills: string[];
	scope: "global" | "project";
	project_path?: string;
	install_all?: boolean;
}

export interface CreateMcpRequest {
	name: string;
	transport: TransportDto;
	timeout?: number;
}

export interface UpdateMcpRequest {
	name?: string;
	transport?: TransportDto;
	enabled?: boolean;
	timeout?: number;
}

export interface InstallTarget {
	agent: string;
	scope: "global" | "project";
	project_root?: string;
}

export interface TransferRequest {
	source: InstallTarget & { name: string };
	destinations: InstallTarget[];
}

export interface ReconcileRequest {
	source: InstallTarget & { name: string };
	added?: string[];
	removed?: string[];
}

export interface DeleteSkillByPathRequest {
	source_path: string;
	agents: string[];
	scope: "global" | "project";
	project_root?: string;
}

export interface GitScanRequest {
	url: string;
	credential_id?: string;
}

export interface GitInstallRequest {
	session_id: string;
	skill_paths: string[];
	agents: string[];
	scope: string;
	project_root?: string;
}

function toNullable<T>(value: T | undefined): T | null {
	return value ?? null;
}

function toTargetDto(target: InstallTarget): TargetDto {
	return {
		agent: target.agent,
		scope: target.scope,
		project_root: toNullable(target.project_root),
	};
}

function toTransferDto(body: TransferRequest): TransferDto {
	return {
		source: {
			...toTargetDto(body.source),
			name: body.source.name,
		},
		destinations: body.destinations.map(toTargetDto),
	};
}

function toReconcileDto(
	body: ReconcileRequest,
): import("../generated/dto").ReconcileRequest {
	return {
		source: {
			...toTargetDto(body.source),
			name: body.source.name,
		},
		added: toNullable(body.added),
		removed: toNullable(body.removed),
	};
}

function toCreateSkillDto(data: CreateSkillRequest): CreateSkillDto {
	return {
		name: data.name,
		description: toNullable(data.description),
		author: toNullable(data.author),
		version: toNullable(data.version),
		content: toNullable(data.content),
		tools: toNullable(data.tools),
	};
}

function toImportSkillDto(data: ImportSkillRequest): ImportSkillDto {
	return { path: data.path };
}

function toInstallSkillDto(data: InstallSkillRequest): InstallSkillDto {
	return {
		source: data.source,
		agents: data.agents,
		skills: data.skills,
		scope: data.scope,
		project_path: toNullable(data.project_path),
		install_all: toNullable(data.install_all),
	};
}

function toCreateMcpDto(body: CreateMcpRequest): CreateMcpDto {
	return {
		name: body.name,
		transport: body.transport,
		timeout: toNullable(body.timeout),
	};
}

function toUpdateMcpDto(body: UpdateMcpRequest): UpdateMcpDto {
	return {
		name: toNullable(body.name),
		transport: toNullable(body.transport),
		enabled: toNullable(body.enabled),
		timeout: toNullable(body.timeout),
	};
}

function toCreateCredentialDto(
	body: CreateCredentialRequest,
): CreateCredentialDto {
	return body;
}

function toDeleteSkillByPathDto(
	body: DeleteSkillByPathRequest,
): DeleteSkillByPathDto {
	return {
		source_path: body.source_path,
		agents: body.agents,
		scope: body.scope,
		project_root: toNullable(body.project_root),
	};
}

function toGitScanDto(body: GitScanRequest): GitScanDto {
	return {
		url: body.url,
		credential_id: toNullable(body.credential_id),
	};
}

function toGitInstallDto(body: GitInstallRequest): GitInstallDto {
	return {
		session_id: body.session_id,
		skill_paths: body.skill_paths,
		agents: body.agents,
		scope: body.scope,
		project_root: toNullable(body.project_root),
	};
}

export function createApi(baseUrl: string) {
	const client = ky.create({ prefixUrl: baseUrl });

	return {
		agents: {
			list(): Promise<AgentInfo[]> {
				return client.get("agents").json();
			},
			availability(): Promise<AgentAvailabilityDto[]> {
				return client.get("agents/availability").json();
			},
		},
		skills: {
			listAll(
				scope: "global" | "project" | "all" = "global",
				projectRoot?: string,
			): Promise<SkillResponse[]> {
				return client
					.get("agents/all/skills", {
						searchParams: {
							scope,
							...(projectRoot
								? { project_root: projectRoot }
								: {}),
						},
					})
					.json();
			},
			create(
				agent: string,
				data: CreateSkillRequest,
				projectRoot?: string,
			): Promise<SkillResponse> {
				const scope = projectRoot ? "project" : "global";
				return client
					.post(`agents/${agent}/skills`, {
						searchParams: {
							scope,
							...(projectRoot
								? { project_root: projectRoot }
								: {}),
						},
						json: toCreateSkillDto(data),
					})
					.json();
			},
			import(
				agent: string,
				data: ImportSkillRequest,
				projectRoot?: string,
			): Promise<SkillResponse> {
				const scope = projectRoot ? "project" : "global";
				return client
					.post(`agents/${agent}/skills/import`, {
						searchParams: {
							scope,
							...(projectRoot
								? { project_root: projectRoot }
								: {}),
						},
						json: toImportSkillDto(data),
					})
					.json();
			},
			install(data: InstallSkillRequest): Promise<InstallSkillResponse> {
				return client
					.post("skills/install", {
						json: toInstallSkillDto(data),
						timeout: 300000,
					})
					.json();
			},
			delete(
				agent: string,
				name: string,
				scope: "global" | "project" = "global",
				projectRoot?: string,
			): Promise<void> {
				return client
					.delete(`agents/${agent}/skills/${name}`, {
						searchParams: {
							scope,
							...(projectRoot
								? { project_root: projectRoot }
								: {}),
						},
					})
					.then(() => undefined);
			},
			openFolder(skillPath: string): Promise<void> {
				return client
					.post("skills/open", { json: { skill_path: skillPath } })
					.then(() => undefined);
			},
			editFolder(skillPath: string): Promise<void> {
				return client
					.post("skills/edit", { json: { skill_path: skillPath } })
					.then(() => undefined);
			},
			getContent(skillPath: string): Promise<string> {
				return client
					.get("skills/content", {
						searchParams: { path: skillPath },
					})
					.json();
			},
			getTree(skillPath: string): Promise<SkillTreeNodeResponse> {
				return client
					.get("skills/tree", {
						searchParams: { path: skillPath },
					})
					.json();
			},
			getGlobalLock(): Promise<GlobalSkillLockResponse> {
				return client.get("skills/lock/global").json();
			},
			getProjectLock(
				projectPath?: string,
			): Promise<ProjectSkillLockResponse> {
				return client
					.get("skills/lock/project", {
						searchParams: projectPath
							? { project_path: projectPath }
							: {},
					})
					.json();
			},
			transfer(body: TransferRequest): Promise<OperationBatchResponse> {
				return client
					.post("skills/transfer", { json: toTransferDto(body) })
					.json();
			},
			reconcile(body: ReconcileRequest): Promise<OperationBatchResponse> {
				return client
					.post("skills/reconcile", { json: toReconcileDto(body) })
					.json();
			},
			deleteByPath(
				body: DeleteSkillByPathRequest,
			): Promise<DeleteSkillByPathResponse> {
				return client
					.delete("skills/by-path", {
						json: toDeleteSkillByPathDto(body),
					})
					.json();
			},
			gitScan(data: GitScanRequest): Promise<GitScanResponse> {
				return client
					.post("skills/git/scan", {
						json: toGitScanDto(data),
						timeout: 120000,
					})
					.json();
			},
			gitInstall(data: GitInstallRequest): Promise<GitInstallResponse> {
				return client
					.post("skills/git/install", {
						json: toGitInstallDto(data),
					})
					.json();
			},
		},
		mcps: {
			listAll(
				scope: "global" | "project" | "all" = "global",
				projectRoot?: string,
			): Promise<McpResponse[]> {
				return client
					.get("agents/all/mcps", {
						searchParams: {
							scope,
							...(projectRoot
								? { project_root: projectRoot }
								: {}),
						},
					})
					.json();
			},
			get(
				name: string,
				agent: string,
				scope: "global" | "project" | "all",
			): Promise<McpResponse> {
				return client
					.get(`agents/${agent}/mcps/${name}`, {
						searchParams: { scope },
					})
					.json();
			},
			create(
				agent: string,
				scope: "global" | "project",
				body: CreateMcpRequest,
				projectRoot?: string,
			): Promise<McpResponse> {
				return client
					.post(`agents/${agent}/mcps`, {
						searchParams: {
							scope,
							...(projectRoot
								? { project_root: projectRoot }
								: {}),
						},
						json: toCreateMcpDto(body),
					})
					.json();
			},
			update(
				name: string,
				agent: string,
				scope: "global" | "project",
				body: UpdateMcpRequest,
				projectRoot?: string,
			): Promise<McpResponse> {
				return client
					.put(`agents/${agent}/mcps/${name}`, {
						searchParams: {
							scope,
							...(projectRoot
								? { project_root: projectRoot }
								: {}),
						},
						json: toUpdateMcpDto(body),
					})
					.json();
			},
			delete(
				name: string,
				agent: string,
				scope: "global" | "project",
				projectRoot?: string,
			): Promise<void> {
				return client
					.delete(`agents/${agent}/mcps/${name}`, {
						searchParams: {
							scope,
							...(projectRoot
								? { project_root: projectRoot }
								: {}),
						},
					})
					.then(() => undefined);
			},
			transfer(body: TransferRequest): Promise<OperationBatchResponse> {
				return client
					.post("mcps/transfer", { json: toTransferDto(body) })
					.json();
			},
			reconcile(body: ReconcileRequest): Promise<OperationBatchResponse> {
				return client
					.post("mcps/reconcile", { json: toReconcileDto(body) })
					.json();
			},
		},
		market: {
			search(q: string, limit?: number): Promise<MarketSkill[]> {
				const searchParams: Record<string, string> = { q };
				if (limit) searchParams.limit = String(limit);
				return client
					.get("skills-market/search", { searchParams })
					.json();
			},
		},
		integrations: {
			listCodeEditors(): Promise<ToolInfoDto[]> {
				return client.get("integrations/code-editors").json();
			},
			openWithEditor(
				path: string,
				editor: CodeEditorType,
			): Promise<void> {
				return client
					.post("integrations/open-with-editor", {
						json: { path, editor },
					})
					.then(() => undefined);
			},
		},
		credentials: {
			list(): Promise<CredentialResponse[]> {
				return client.get("credentials").json();
			},
			create(body: CreateCredentialRequest): Promise<CredentialResponse> {
				return client
					.post("credentials", { json: toCreateCredentialDto(body) })
					.json();
			},
			delete(id: string): Promise<void> {
				return client.delete(`credentials/${id}`).then(() => undefined);
			},
		},
	};
}

export type {
	AgentAvailabilityDto as AgentAvailability,
	AgentInfo,
	CodeEditorType,
	CredentialResponse,
	DeleteSkillByPathResponse,
	GitInstallResponse,
	GitInstallResultEntry,
	GitScanResponse,
	GitScanSkillEntry,
	GlobalSkillLockResponse,
	InstallSkillResponse,
	MarketSkill,
	McpResponse,
	OperationBatchResponse,
	ProjectSkillLockResponse,
	SkillResponse,
	SkillTreeNodeResponse,
	ToolInfoDto as ToolInfo,
	TransportDto,
};
