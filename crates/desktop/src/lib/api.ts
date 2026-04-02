import ky from "ky";
import type { AgentAvailabilityDto } from "../generated/dto/AgentAvailabilityDto";
import type { AgentInfo } from "../generated/dto/AgentInfo";
import type { CodeEditorType } from "../generated/dto/CodeEditorType";
import type { CreateCredentialRequest } from "../generated/dto/CreateCredentialRequest";
import type { CreateMcpRequest } from "../generated/dto/CreateMcpRequest";
import type { CreateSkillRequest } from "../generated/dto/CreateSkillRequest";
import type { CredentialResponse } from "../generated/dto/CredentialResponse";
import type { DeleteSkillByPathRequest } from "../generated/dto/DeleteSkillByPathRequest";
import type { DeleteSkillByPathResponse } from "../generated/dto/DeleteSkillByPathResponse";
import type { GitInstallRequest } from "../generated/dto/GitInstallRequest";
import type { GitInstallResponse } from "../generated/dto/GitInstallResponse";
import type { GitScanRequest } from "../generated/dto/GitScanRequest";
import type { GitScanResponse } from "../generated/dto/GitScanResponse";
import type { GlobalSkillLockResponse } from "../generated/dto/GlobalSkillLockResponse";
import type { ImportSkillRequest } from "../generated/dto/ImportSkillRequest";
import type { InstallSkillRequest } from "../generated/dto/InstallSkillRequest";
import type { InstallSkillResponse } from "../generated/dto/InstallSkillResponse";
import type { MarketSkill } from "../generated/dto/MarketSkill";
import type { McpResponse } from "../generated/dto/McpResponse";
import type { OperationBatchResponse } from "../generated/dto/OperationBatchResponse";
import type { ProjectSkillLockResponse } from "../generated/dto/ProjectSkillLockResponse";
import type { ReconcileRequest } from "../generated/dto/ReconcileRequest";
import type { SkillResponse } from "../generated/dto/SkillResponse";
import type { SkillTreeNodeResponse } from "../generated/dto/SkillTreeNodeResponse";
import type { ToolInfoDto } from "../generated/dto/ToolInfoDto";
import type { TransferRequest } from "../generated/dto/TransferRequest";
import type { UpdateMcpRequest } from "../generated/dto/UpdateMcpRequest";

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
						json: data,
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
						json: data,
					})
					.json();
			},
			install(data: InstallSkillRequest): Promise<InstallSkillResponse> {
				return client
					.post("skills/install", { json: data, timeout: 300000 })
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
				return client.post("skills/transfer", { json: body }).json();
			},
			reconcile(body: ReconcileRequest): Promise<OperationBatchResponse> {
				return client.post("skills/reconcile", { json: body }).json();
			},
			deleteByPath(
				body: DeleteSkillByPathRequest,
			): Promise<DeleteSkillByPathResponse> {
				return client.delete("skills/by-path", { json: body }).json();
			},
			gitScan(data: GitScanRequest): Promise<GitScanResponse> {
				return client
					.post("skills/git/scan", { json: data, timeout: 120000 })
					.json();
			},
			gitInstall(data: GitInstallRequest): Promise<GitInstallResponse> {
				return client.post("skills/git/install", { json: data }).json();
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
						json: body,
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
						json: body,
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
				return client.post("mcps/transfer", { json: body }).json();
			},
			reconcile(body: ReconcileRequest): Promise<OperationBatchResponse> {
				return client.post("mcps/reconcile", { json: body }).json();
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
				return client.post("credentials", { json: body }).json();
			},
			delete(id: string): Promise<void> {
				return client.delete(`credentials/${id}`).then(() => undefined);
			},
		},
	};
}
