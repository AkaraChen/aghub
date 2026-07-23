import ky, { isHTTPError } from "ky";
import type {
	AgentAvailabilityDto,
	AgentInfo,
	AgentProviderResponse,
	AuditReportDto,
	AuditRequest,
	CCMarketplaceAddRequest,
	CCMarketplaceListResponse,
	CCMarketplaceMutationResponse,
	CCPluginCliStatusResponse,
	CCPluginPruneRequest,
	CCPluginPruneResponse,
	CCPluginValidateRequest,
	CCPluginValidateResponse,
	ClaudeProviderStateResponse,
	CodeEditorType,
	CodexProviderStateResponse,
	CreateAgentProviderRequest,
	CreateCredentialRequest,
	CreateInferenceProviderRequest,
	CreateMcpRequest,
	CreateSkillRequest,
	CreateSubAgentRequest,
	CcusageRuntimeDto,
	InstallCcusageRuntimeRequest,
	CredentialResponse,
	DeleteSkillByPathRequest,
	DeleteSkillByPathResponse,
	FetchInferenceProviderModelsRequest,
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
	InferenceProviderPasswordResponse,
	InferenceProviderPresetResponse,
	InferenceProviderResponse,
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
	SkillResponse,
	SkillCopyResolutionRequest,
	SkillCopyResolutionResponse,
	SkillCopyStatusRequest,
	SkillCopyStatusResponse,
	SkillDiffRequest,
	SkillDiffResponse,
	SkillTreeNodeResponse,
	SubAgentResponse,
	SetCcusageRuntimeRequest,
	ToolInfoDto,
	TransferRequest,
	CCPluginUninstallRequest,
	CCPluginUninstallResponse,
	UpdateAgentProviderRequest,
	UpdateCodexActiveProfileRequest,
	UpdateCodexProfileProviderRequest,
	UpdateInferenceProviderRequest,
	UpdateMcpRequest,
	CCPluginUpdateConfigRequest,
	CCPluginUpdateRequest,
	CCPluginUpdateResponse,
	UpdateSubAgentRequest,
	UsageAgent,
	UsageLimitsReportDto,
	UsageReportDto,
	UsageStatusDto,
} from "../generated/dto";
import type { SkillDiscoveryPreferences } from "./store";

interface ApiErrorBody {
	error?: string;
	code?: string;
}

// Directory comparisons may hash the API's bounded 256 MiB batch before
// returning, so they need longer than Ky's default request timeout.
const SKILL_DIFF_TIMEOUT_MS = 120_000;

// The backend stops provider discovery after 15 seconds; this leaves time for
// its response to cross the local HTTP boundary.
const PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS = 20_000;

export function getApiErrorCode(error: unknown) {
	if (!isHTTPError(error) || !error.data || typeof error.data !== "object") {
		return undefined;
	}
	const body = error.data as ApiErrorBody;
	return body.code;
}

// The backend caps local selection/refresh at 60 seconds and install/update at
// five minutes. HTTP deadlines include time for the returned runtime snapshot.
const RUNTIME_PROBE_REQUEST_TIMEOUT_MS = 90_000;
const RUNTIME_INSTALL_REQUEST_TIMEOUT_MS = 330_000;
const DEFAULT_USAGE_SUMMARY_TIMEOUT_SECS = 30;
// The backend process deadline covers ccusage itself; reserve 15 seconds for
// response normalization and transport before the client aborts the request.
const USAGE_SUMMARY_RESPONSE_GRACE_MS = 15_000;

function usageSummaryRequestTimeout(timeoutSecs?: number) {
	const processTimeoutSecs =
		timeoutSecs !== undefined && timeoutSecs > 0
			? timeoutSecs
			: DEFAULT_USAGE_SUMMARY_TIMEOUT_SECS;
	return processTimeoutSecs * 1_000 + USAGE_SUMMARY_RESPONSE_GRACE_MS;
}

export function createApi(baseUrl: string, token: string) {
	const client = ky.create({
		prefix: baseUrl,
		headers: {
			Authorization: `Bearer ${token}`,
		},
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

	async function getInferenceProviderByLatinName(latinName: string) {
		const providers: InferenceProviderResponse[] = await client
			.get("inference/providers")
			.json();
		const provider = providers.find(
			(item) => item.latin_name === latinName,
		);

		if (!provider) {
			throw new Error(`inference provider '${latinName}' not found`);
		}

		return provider;
	}

	async function updateInferenceProviderModels(
		latinName: string,
		models: (current: string[]) => string[],
	) {
		const provider = await getInferenceProviderByLatinName(latinName);
		return client
			.put(
				`inference/providers/${encodeURIComponent(provider.latin_name)}`,
				{
					json: {
						latin_name: null,
						display_name: null,
						format: null,
						api_base_url: null,
						api_key: null,
						models: models(provider.models),
					} satisfies UpdateInferenceProviderRequest,
				},
			)
			.json<InferenceProviderResponse>();
	}

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
				discovery?: SkillDiscoveryPreferences,
			): Promise<SkillResponse[]> {
				return client
					.get("agents/all/skills", {
						searchParams: {
							scope,
							include_managed: includeManaged.toString(),
							...(discovery
								? {
										include_project:
											discovery.projectSkills.toString(),
										include_nested:
											discovery.embeddedSkills.toString(),
										include_dependencies:
											discovery.dependencySkills.toString(),
									}
								: {}),
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
			// An arrow property, not a shorthand method: the `import(` token of a
			// method named import is treated as a dynamic import by Vite's
			// import-analysis and rejected by WebKit's parser (blank window in dev).
			import: (
				agent: string,
				data: ImportSkillRequest,
				projectRoot?: string,
				signal?: AbortSignal,
			): Promise<SkillResponse> => {
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
						signal,
					})
					.json();
			},
			install(
				data: InstallSkillRequest,
				signal?: AbortSignal,
			): Promise<InstallSkillResponse> {
				return client
					.post("skills/install", {
						json: data,
						timeout: 300000,
						signal,
					})
					.json();
			},
			audit(
				data: AuditRequest,
				signal?: AbortSignal,
			): Promise<AuditReportDto> {
				return client
					.post("skills/audit", {
						json: data,
						timeout: 60000,
						signal,
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
			getContent(
				skillPath: string,
				scope: "global" | "project" | "all" = "global",
				projectRoot?: string,
			): Promise<string> {
				return client
					.get("skills/content", {
						searchParams: {
							path: skillPath,
							scope,
							...(projectRoot
								? { project_root: projectRoot }
								: {}),
						},
					})
					.json();
			},
			diff(
				data: SkillDiffRequest,
				signal?: AbortSignal,
			): Promise<SkillDiffResponse> {
				return client
					.post("skills/diff", {
						json: data,
						signal,
						timeout: SKILL_DIFF_TIMEOUT_MS,
					})
					.json();
			},
			resolveCopies(
				data: SkillCopyResolutionRequest,
				signal?: AbortSignal,
			): Promise<SkillCopyResolutionResponse> {
				return client
					.post("skills/copies/resolve", {
						json: data,
						signal,
						timeout: SKILL_DIFF_TIMEOUT_MS,
					})
					.json();
			},
			getCopyStatus(
				data: SkillCopyStatusRequest,
			): Promise<SkillCopyStatusResponse> {
				return client
					.post("skills/copies/status", {
						json: data,
						timeout: SKILL_DIFF_TIMEOUT_MS,
					})
					.json();
			},
			getTree(
				skillPath: string,
				scope: "global" | "project" | "all" = "global",
				projectRoot?: string,
			): Promise<SkillTreeNodeResponse> {
				return client
					.get("skills/tree", {
						searchParams: {
							path: skillPath,
							scope,
							...(projectRoot
								? { project_root: projectRoot }
								: {}),
						},
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
			gitScan(
				data: GitScanRequest,
				signal?: AbortSignal,
			): Promise<GitScanResponse> {
				return client
					.post("skills/git/scan", {
						json: data,
						timeout: 120000,
						signal,
					})
					.json();
			},
			gitInstall(
				data: GitInstallRequest,
				signal?: AbortSignal,
			): Promise<GitInstallResponse> {
				return client
					.post("skills/git/install", { json: data, signal })
					.json();
			},
			gitSync(
				data: GitSyncRequest,
				signal?: AbortSignal,
			): Promise<GitSyncResponse> {
				return client
					.post("skills/git/sync", { json: data, signal })
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
		usage: {
			summary(
				params: {
					since?: string;
					until?: string;
					timezone?: string;
					offline?: boolean;
					config?: string;
					timeoutSecs?: number;
					args?: string;
					agents?: readonly string[];
				} = {},
			): Promise<UsageReportDto> {
				const searchParams: Record<string, string> = {};
				if (params.since) searchParams.since = params.since;
				if (params.until) searchParams.until = params.until;
				if (params.timezone) searchParams.timezone = params.timezone;
				if (params.offline !== undefined)
					searchParams.offline = String(params.offline);
				if (params.config) searchParams.config = params.config;
				if (params.timeoutSecs)
					searchParams.timeout_secs = String(params.timeoutSecs);
				if (params.args) searchParams.args = params.args;
				if (params.agents !== undefined)
					searchParams.agents = params.agents.join(",");
				return client
					.get("usage/summary", {
						searchParams,
						timeout: usageSummaryRequestTimeout(params.timeoutSecs),
					})
					.json();
			},
			agents(): Promise<UsageAgent[]> {
				return client.get("usage/agents", { timeout: 30000 }).json();
			},
			limits(agents?: readonly string[]): Promise<UsageLimitsReportDto> {
				return client
					.get("usage/limits", {
						searchParams:
							agents === undefined
								? undefined
								: { agents: agents.join(",") },
						timeout: 30000,
					})
					.json();
			},
			status(): Promise<UsageStatusDto> {
				return client.get("usage/status", { timeout: 30000 }).json();
			},
			runtime(): Promise<CcusageRuntimeDto> {
				return client
					.get("usage/runtime", {
						timeout: RUNTIME_PROBE_REQUEST_TIMEOUT_MS,
					})
					.json();
			},
			setRuntime(
				body: SetCcusageRuntimeRequest,
			): Promise<CcusageRuntimeDto> {
				return client
					.put("usage/runtime", {
						json: body,
						timeout: RUNTIME_PROBE_REQUEST_TIMEOUT_MS,
					})
					.json();
			},
			installRuntime(
				body: InstallCcusageRuntimeRequest,
			): Promise<CcusageRuntimeDto> {
				return client
					.post("usage/runtime/install", {
						json: body,
						timeout: RUNTIME_INSTALL_REQUEST_TIMEOUT_MS,
					})
					.json();
			},
			updateRuntime(): Promise<CcusageRuntimeDto> {
				return client
					.post("usage/runtime/update", {
						timeout: RUNTIME_INSTALL_REQUEST_TIMEOUT_MS,
					})
					.json();
			},
			refreshRuntime(): Promise<CcusageRuntimeDto> {
				return client
					.post("usage/runtime/refresh", {
						timeout: RUNTIME_PROBE_REQUEST_TIMEOUT_MS,
					})
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
		inferenceProviders: {
			list(): Promise<InferenceProviderResponse[]> {
				return client.get("inference/providers").json();
			},
			listPresets(): Promise<InferenceProviderPresetResponse[]> {
				return client.get("inference/presets").json();
			},
			fetchModels(
				body: FetchInferenceProviderModelsRequest,
			): Promise<string[]> {
				return client
					.post("inference/providers/models", {
						json: body,
						timeout: PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS,
					})
					.json();
			},
			listOpenCode(): Promise<AgentProviderResponse[]> {
				return client.get("inference/agents/opencode/providers").json();
			},
			listCodex(): Promise<AgentProviderResponse[]> {
				return client.get("inference/agents/codex/providers").json();
			},
			getCodexState(): Promise<CodexProviderStateResponse> {
				return client.get("inference/agents/codex/state").json();
			},
			clearCodexState(): Promise<void> {
				return client
					.delete("inference/agents/codex/state")
					.then(() => undefined);
			},
			getPassword(
				latinName: string,
			): Promise<InferenceProviderPasswordResponse> {
				return client
					.get(
						`inference/providers/${encodeURIComponent(latinName)}/password`,
					)
					.json();
			},
			create(
				body: CreateInferenceProviderRequest,
			): Promise<InferenceProviderResponse> {
				return client
					.post("inference/providers", { json: body })
					.json();
			},
			createOpenCode(
				body: CreateAgentProviderRequest,
			): Promise<AgentProviderResponse> {
				return client
					.post("inference/agents/opencode/providers", { json: body })
					.json();
			},
			createCodex(
				body: CreateAgentProviderRequest,
			): Promise<AgentProviderResponse> {
				return client
					.post("inference/agents/codex/providers", { json: body })
					.json();
			},
			update(
				latinName: string,
				body: UpdateInferenceProviderRequest,
			): Promise<InferenceProviderResponse> {
				return client
					.put(
						`inference/providers/${encodeURIComponent(latinName)}`,
						{
							json: body,
						},
					)
					.json();
			},
			updateOpenCode(
				id: string,
				body: UpdateAgentProviderRequest,
			): Promise<AgentProviderResponse> {
				return client
					.put(
						`inference/agents/opencode/providers/${encodeURIComponent(id)}`,
						{ json: body },
					)
					.json();
			},
			updateCodex(
				id: string,
				body: UpdateAgentProviderRequest,
			): Promise<AgentProviderResponse> {
				return client
					.put(
						`inference/agents/codex/providers/${encodeURIComponent(id)}`,
						{ json: body },
					)
					.json();
			},
			updateCodexActiveProfile(
				body: UpdateCodexActiveProfileRequest,
			): Promise<CodexProviderStateResponse> {
				return client
					.put("inference/agents/codex/profile", { json: body })
					.json();
			},
			updateCodexProfileProvider(
				profileId: string,
				body: UpdateCodexProfileProviderRequest,
			): Promise<CodexProviderStateResponse> {
				return client
					.put(
						`inference/agents/codex/profiles/${encodeURIComponent(profileId)}/provider`,
						{ json: body },
					)
					.json();
			},
			syncOpenCode(id: string): Promise<AgentProviderResponse> {
				return client
					.post(
						`inference/agents/opencode/providers/${encodeURIComponent(id)}/sync`,
					)
					.json();
			},
			syncCodex(id: string): Promise<AgentProviderResponse> {
				return client
					.post(
						`inference/agents/codex/providers/${encodeURIComponent(id)}/sync`,
					)
					.json();
			},
			async createModel(
				latinName: string,
				modelName: string,
			): Promise<InferenceProviderResponse> {
				return updateInferenceProviderModels(latinName, (models) => [
					...models,
					modelName,
				]);
			},
			async updateModel(
				latinName: string,
				modelName: string,
				nextModelName: string,
			): Promise<InferenceProviderResponse> {
				return updateInferenceProviderModels(latinName, (models) => {
					const index = models.indexOf(modelName);
					if (index === -1) {
						throw new Error(
							`inference model '${modelName}' not found`,
						);
					}
					const nextModels = [...models];
					nextModels[index] = nextModelName;
					return nextModels;
				});
			},
			async deleteModel(
				latinName: string,
				modelName: string,
			): Promise<InferenceProviderResponse> {
				return updateInferenceProviderModels(latinName, (models) => {
					if (!models.includes(modelName)) {
						throw new Error(
							`inference model '${modelName}' not found`,
						);
					}
					return models.filter((model) => model !== modelName);
				});
			},
			delete(latinName: string): Promise<void> {
				return client
					.delete(
						`inference/providers/${encodeURIComponent(latinName)}`,
					)
					.then(() => undefined);
			},
			deleteOpenCode(id: string): Promise<void> {
				return client
					.delete(
						`inference/agents/opencode/providers/${encodeURIComponent(id)}`,
					)
					.then(() => undefined);
			},
			deleteCodex(id: string): Promise<void> {
				return client
					.delete(
						`inference/agents/codex/providers/${encodeURIComponent(id)}`,
					)
					.then(() => undefined);
			},
			getClaudeState(): Promise<ClaudeProviderStateResponse> {
				return client.get("inference/agents/claude/state").json();
			},
			createClaude(
				body: CreateAgentProviderRequest,
			): Promise<AgentProviderResponse> {
				return client
					.post("inference/agents/claude/providers", { json: body })
					.json();
			},
			updateClaude(
				id: string,
				body: UpdateAgentProviderRequest,
			): Promise<ClaudeProviderStateResponse> {
				return client
					.put(
						`inference/agents/claude/providers/${encodeURIComponent(id)}`,
						{ json: body },
					)
					.json();
			},
			syncClaude(id: string): Promise<AgentProviderResponse> {
				return client
					.post(
						`inference/agents/claude/providers/${encodeURIComponent(id)}/sync`,
					)
					.json();
			},
			deleteClaude(id: string): Promise<void> {
				return client
					.delete(
						`inference/agents/claude/providers/${encodeURIComponent(id)}`,
					)
					.then(() => undefined);
			},
			clearClaudeState(): Promise<void> {
				return client
					.delete("inference/agents/claude/state")
					.then(() => undefined);
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
			listMarketplaces(): Promise<CCMarketplaceListResponse> {
				return client.get("plugins/marketplaces").json();
			},
			addMarketplace(
				body: CCMarketplaceAddRequest,
			): Promise<CCMarketplaceMutationResponse> {
				return client
					.post("plugins/marketplaces", {
						json: body,
						timeout: 300000,
					})
					.json();
			},
			removeMarketplace(
				name: string,
			): Promise<CCMarketplaceMutationResponse> {
				return client
					.delete(`plugins/marketplaces/${encodeURIComponent(name)}`)
					.json();
			},
			updateMarketplaceOne(
				name: string,
			): Promise<CCMarketplaceMutationResponse> {
				return client
					.post(
						`plugins/marketplaces/${encodeURIComponent(name)}/update`,
						{ timeout: 300000 },
					)
					.json();
			},
			getCliStatus(): Promise<CCPluginCliStatusResponse> {
				return client.get("plugins/cli/status").json();
			},
			prune(body: CCPluginPruneRequest): Promise<CCPluginPruneResponse> {
				return client
					.post("plugins/prune", { json: body, timeout: 120000 })
					.json();
			},
			validate(
				body: CCPluginValidateRequest,
			): Promise<CCPluginValidateResponse> {
				return client.post("plugins/validate", { json: body }).json();
			},
		},
	};
}
