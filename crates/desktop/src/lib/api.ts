import ky, { isHTTPError } from "ky";
import type {
	AgentAvailabilityDto,
	AgentInfo,
	CCPluginCheckUpdateRequest,
	CCPluginCheckUpdateResponse,
	CodeEditorType,
	CreateCredentialRequest,
	CreateMcpRequest,
	CreateSkillRequest,
	CreateSubAgentRequest,
	CredentialResponse,
	DeleteSkillByPathRequest,
	DeleteSkillByPathResponse,
	GitInstallRequest,
	GitInstallResponse,
	GitScanRequest,
	GitScanResponse,
	GitSyncRequest,
	GitSyncResponse,
	GlobalSkillLockResponse,
	ImportSkillRequest,
	CCPluginInstallRequest,
	CCPluginInstallResponse,
	InstallSkillRequest,
	InstallSkillResponse,
	CCPluginMarketResponse,
	MarketSkill,
	McpResponse,
	OperationBatchResponse,
	CCPluginConfigResponse,
	CCPluginDetailResponse,
	CCPluginListResponse,
	CCPluginOpenSkillInEditorRequest,
	CCPluginResponse,
	ProjectSkillLockResponse,
	ReconcileRequest,
	CCPluginReinstallRequest,
	CCPluginReinstallResponse,
	SkillResponse,
	SkillTreeNodeResponse,
	SubAgentResponse,
	ToolInfoDto,
	TransferRequest,
	CCPluginUninstallRequest,
	CCPluginUninstallResponse,
	UpdateMcpRequest,
	CCPluginUpdateConfigRequest,
	CCPluginUpdateRequest,
	CCPluginUpdateResponse,
	UpdateSubAgentRequest,
} from "../generated/dto";

interface ApiErrorBody {
	error?: string;
	code?: string;
}

export function createApi(baseUrl: string) {
	const client = ky.create({
		prefix: baseUrl,
		hooks: {
			beforeError: [
				async ({ error }) => {
					if (
						isHTTPError(error) &&
						error.data &&
						typeof error.data === "object"
					) {
						const body = error.data as ApiErrorBody;
						if (body.error) {
							error.message = body.error;
						}
					}

					return error;
				},
			],
		},
	});

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
				includeManaged = false,
			): Promise<SkillResponse[]> {
				return client
					.get("agents/all/skills", {
						searchParams: {
							scope,
							include_managed: includeManaged.toString(),
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
			gitSync(data: GitSyncRequest): Promise<GitSyncResponse> {
				return client.post("skills/git/sync", { json: data }).json();
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
		subAgents: {
			listAll(
				scope: "global" | "project" | "all" = "global",
				projectRoot?: string,
			): Promise<SubAgentResponse[]> {
				return client
					.get("agents/all/sub-agents", {
						searchParams: {
							scope,
							...(projectRoot
								? { project_root: projectRoot }
								: {}),
						},
					})
					.json();
			},
			list(
				agent: string,
				scope: "global" | "project" | "all" = "global",
				projectRoot?: string,
			): Promise<SubAgentResponse[]> {
				return client
					.get(`agents/${agent}/sub-agents`, {
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
				projectRoot?: string,
			): Promise<SubAgentResponse> {
				return client
					.get(`agents/${agent}/sub-agents/${name}`, {
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
				scope: "global" | "project",
				body: CreateSubAgentRequest,
				projectRoot?: string,
			): Promise<SubAgentResponse> {
				return client
					.post(`agents/${agent}/sub-agents`, {
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
				body: UpdateSubAgentRequest,
				projectRoot?: string,
			): Promise<SubAgentResponse> {
				return client
					.put(`agents/${agent}/sub-agents/${name}`, {
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
					.delete(`agents/${agent}/sub-agents/${name}`, {
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
					.post("sub-agents/transfer", { json: body })
					.json();
			},
			reconcile(body: ReconcileRequest): Promise<OperationBatchResponse> {
				return client
					.post("sub-agents/reconcile", { json: body })
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
				return client.post("credentials", { json: body }).json();
			},
			delete(id: string): Promise<void> {
				return client.delete(`credentials/${id}`).then(() => undefined);
			},
		},
		plugins: {
			list(): Promise<CCPluginListResponse> {
				return client.get("plugins").json();
			},
			detail(pluginId: string): Promise<CCPluginDetailResponse> {
				return client
					.get("plugins/detail", {
						searchParams: { plugin_id: pluginId },
					})
					.json();
			},
			enable(pluginId: string): Promise<CCPluginResponse> {
				return client
					.post("plugins/enable", {
						searchParams: { plugin_id: pluginId },
					})
					.json();
			},
			disable(pluginId: string): Promise<CCPluginResponse> {
				return client
					.post("plugins/disable", {
						searchParams: { plugin_id: pluginId },
					})
					.json();
			},
			install(
				body: CCPluginInstallRequest,
			): Promise<CCPluginInstallResponse> {
				return client
					.post("plugins/install", { json: body, timeout: 180000 })
					.json();
			},
			uninstall(
				body: CCPluginUninstallRequest,
			): Promise<CCPluginUninstallResponse> {
				return client
					.post("plugins/uninstall", { json: body, timeout: 60000 })
					.json();
			},
			update(
				body: CCPluginUpdateRequest,
			): Promise<CCPluginUpdateResponse> {
				return client
					.post("plugins/update", { json: body, timeout: 180000 })
					.json();
			},
			checkUpdate(
				body: CCPluginCheckUpdateRequest,
			): Promise<CCPluginCheckUpdateResponse> {
				return client
					.post("plugins/check-update", { json: body })
					.json();
			},
			openFolder(pluginId: string, scope?: string): Promise<void> {
				const search = new URLSearchParams({ plugin_id: pluginId });
				if (scope) {
					search.set("scope", scope);
				}
				return client
					.post("plugins/open-folder", {
						searchParams: search,
					})
					.then(() => undefined);
			},
			openSkillInEditor(
				body: CCPluginOpenSkillInEditorRequest,
			): Promise<void> {
				return client
					.post("plugins/open-skill-in-editor", { json: body })
					.then(() => undefined);
			},
			reinstall(
				body: CCPluginReinstallRequest,
			): Promise<CCPluginReinstallResponse> {
				return client
					.post("plugins/reinstall", { json: body, timeout: 180000 })
					.json();
			},
			getConfig(pluginId: string): Promise<CCPluginConfigResponse> {
				return client
					.get("plugins/config", {
						searchParams: { plugin_id: pluginId },
					})
					.json();
			},
			updateConfig(
				body: CCPluginUpdateConfigRequest,
			): Promise<CCPluginConfigResponse> {
				return client.post("plugins/config", { json: body }).json();
			},
			deleteConfig(pluginId: string): Promise<CCPluginConfigResponse> {
				return client
					.delete("plugins/config", {
						searchParams: { plugin_id: pluginId },
					})
					.json();
			},
			listMarket(): Promise<CCPluginMarketResponse[]> {
				return client.get("plugins-market", { timeout: 30000 }).json();
			},
			updateMarketplace(): Promise<{
				success: boolean;
				updated_count: number;
			}> {
				return client
					.post("plugins-market/update", {
						timeout: 300000,
					})
					.json();
			},
		},
	};
}
