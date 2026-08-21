import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import type {
	CreateSkillRequest,
	DeleteSkillByPathRequest,
	GitInstallRequest,
	GitInstallResponse,
	GitScanRequest,
	GitSyncRequest,
	GitSyncResponse,
	ImportSkillRequest,
	InstallSkillRequest,
	InstallSkillResponse,
	OperationBatchResponse,
	ReconcileRequest,
	SkillCopyResolutionRequest,
	SkillCopyResolutionResponse,
	SkillCopyStatusRequest,
	SkillDiffRequest,
	SkillResponse,
	TransferRequest,
} from "../generated/dto";
import type { ApiClient } from "./client";
import {
	getSkillPreferences,
	type SkillDiscoveryPreferences,
} from "../lib/store";
import { queryKeys } from "./keys";

interface SkillListQueryParams {
	api: ApiClient;
	scope?: "global" | "project" | "all";
	projectRoot?: string;
	enabled?: boolean;
	staleTime?: number;
	discovery?: SkillDiscoveryPreferences;
}

export function skillListQueryOptions({
	api,
	scope = "global",
	projectRoot,
	enabled = true,
	staleTime = 30_000,
	discovery,
}: SkillListQueryParams) {
	return queryOptions({
		queryKey: queryKeys.skills.list(scope, projectRoot, discovery),
		queryFn: async () => {
			const effectiveDiscovery =
				discovery ?? (await getSkillPreferences()).discovery;
			return api.skills.listAll(
				scope,
				projectRoot,
				false,
				effectiveDiscovery,
			);
		},
		enabled,
		staleTime,
	});
}

interface GlobalSkillLockQueryParams {
	api: ApiClient;
	enabled?: boolean;
	staleTime?: number;
}

export function globalSkillLockQueryOptions({
	api,
	enabled = true,
	staleTime = 30_000,
}: GlobalSkillLockQueryParams) {
	return queryOptions({
		queryKey: queryKeys.skills.lock.global(),
		queryFn: () => api.skills.getGlobalLock(),
		enabled,
		staleTime,
	});
}

interface ProjectSkillLockQueryParams {
	api: ApiClient;
	projectPath?: string;
	enabled?: boolean;
	staleTime?: number;
}

export function projectSkillLockQueryOptions({
	api,
	projectPath,
	enabled = true,
	staleTime = 30_000,
}: ProjectSkillLockQueryParams) {
	return queryOptions({
		queryKey: queryKeys.skills.lock.project(projectPath),
		queryFn: () => api.skills.getProjectLock(projectPath),
		enabled,
		staleTime,
	});
}

interface SkillPathQueryParams {
	api: ApiClient;
	path?: string;
	scope?: "global" | "project" | "all";
	projectRoot?: string;
	enabled?: boolean;
	staleTime?: number;
}

export function skillContentQueryOptions({
	api,
	path,
	scope = "global",
	projectRoot,
	enabled = true,
	staleTime = 60_000,
}: SkillPathQueryParams) {
	return queryOptions({
		queryKey: queryKeys.skills.content(path ?? "", scope, projectRoot),
		queryFn: () => api.skills.getContent(path!, scope, projectRoot),
		enabled: enabled && Boolean(path),
		staleTime,
	});
}

interface SkillAuditQueryParams {
	api: ApiClient;
	paths?: string[];
	enabled?: boolean;
	staleTime?: number;
}

export function skillAuditQueryOptions({
	api,
	paths = [],
	enabled = true,
	staleTime = 60_000,
}: SkillAuditQueryParams) {
	const auditPaths = [...new Set(paths.filter(Boolean))].sort();
	return queryOptions({
		queryKey: queryKeys.skills.audit(auditPaths),
		queryFn: () => api.skills.audit({ paths: auditPaths }),
		enabled: enabled && auditPaths.length > 0,
		staleTime,
		// File-system failures are not transient; retries multiply list scans.
		retry: false,
	});
}

export function skillTreeQueryOptions({
	api,
	path,
	scope = "global",
	projectRoot,
	enabled = true,
	staleTime = 60_000,
}: SkillPathQueryParams) {
	return queryOptions({
		queryKey: queryKeys.skills.tree(path ?? "", scope, projectRoot),
		queryFn: () => api.skills.getTree(path!, scope, projectRoot),
		enabled: enabled && Boolean(path),
		staleTime,
		retry: false,
	});
}

interface SkillDiffQueryParams {
	api: ApiClient;
	request?: SkillDiffRequest;
	enabled?: boolean;
}

export function skillDiffQueryOptions({
	api,
	request,
	enabled = true,
}: SkillDiffQueryParams) {
	return queryOptions({
		queryKey: queryKeys.skills.diff(request ?? null),
		queryFn: ({ signal }) => api.skills.diff(request!, signal),
		enabled: enabled && Boolean(request),
		staleTime: 0,
		retry: false,
	});
}

interface SkillCopyStatusQueryParams {
	api: ApiClient;
	request?: SkillCopyStatusRequest;
	enabled?: boolean;
}

export function skillCopyStatusQueryOptions({
	api,
	request,
	enabled = true,
}: SkillCopyStatusQueryParams) {
	return queryOptions({
		queryKey: queryKeys.skills.copyStatus(request ?? null),
		queryFn: () => api.skills.getCopyStatus(request!),
		enabled: enabled && Boolean(request),
		staleTime: 30_000,
		retry: false,
	});
}

interface ResolveSkillCopiesMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: SkillCopyResolutionResponse,
		variables: SkillCopyResolutionRequest,
	) => void | Promise<void>;
}

export function resolveSkillCopiesMutationOptions({
	api,
	queryClient,
	onSuccess,
}: ResolveSkillCopiesMutationParams) {
	return mutationOptions({
		mutationFn: (body: SkillCopyResolutionRequest) =>
			api.skills.resolveCopies(body),
		onSuccess: async (data, variables) => {
			const consumedSessionId =
				variables.reference.kind === "git_scan"
					? variables.reference.session_id
					: undefined;
			if (consumedSessionId) {
				await onSuccess?.(data, variables);
			}
			await invalidateSkillQueries(queryClient, consumedSessionId);
			if (!consumedSessionId) {
				await onSuccess?.(data, variables);
			}
		},
	});
}

function isGitScanDiffForSession(
	queryKey: readonly unknown[],
	sessionId: string,
) {
	if (queryKey[0] !== "skills" || queryKey[1] !== "diff") return false;
	const request = queryKey[2];
	if (!request || typeof request !== "object") return false;
	const reference = (request as { reference?: unknown }).reference;
	if (!reference || typeof reference !== "object") return false;
	const gitReference = reference as {
		kind?: unknown;
		session_id?: unknown;
	};
	return (
		gitReference.kind === "git_scan" &&
		gitReference.session_id === sessionId
	);
}

export async function invalidateSkillQueries(
	queryClient: QueryClient,
	consumedGitScanSessionId?: string,
) {
	await queryClient.invalidateQueries({
		queryKey: queryKeys.skills.all(),
		predicate: ({ queryKey }) =>
			!consumedGitScanSessionId ||
			!isGitScanDiffForSession(queryKey, consumedGitScanSessionId),
	});
	await Promise.all([
		queryClient.refetchQueries({
			queryKey: queryKeys.skills.lists(),
			type: "active",
		}),
		queryClient.refetchQueries({
			queryKey: queryKeys.skills.lock.all(),
			type: "active",
		}),
	]);
	if (consumedGitScanSessionId) {
		queryClient.removeQueries({
			queryKey: queryKeys.skills.all(),
			predicate: ({ queryKey }) =>
				isGitScanDiffForSession(queryKey, consumedGitScanSessionId),
		});
	}
}

interface CreateSkillVariables {
	agent: string;
	body: CreateSkillRequest;
	projectPath?: string;
}

interface CreateSkillMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: SkillResponse,
		variables: CreateSkillVariables,
	) => void | Promise<void>;
}

export function createSkillMutationOptions({
	api,
	queryClient,
	onSuccess,
}: CreateSkillMutationParams) {
	return mutationOptions({
		mutationFn: ({ agent, body, projectPath }: CreateSkillVariables) =>
			api.skills.create(agent, body, projectPath),
		onSuccess: async (data, variables) => {
			await invalidateSkillQueries(queryClient);
			await onSuccess?.(data, variables);
		},
	});
}

interface ImportSkillVariables {
	agent: string;
	body: ImportSkillRequest;
	projectPath?: string;
}

interface ImportSkillMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: SkillResponse,
		variables: ImportSkillVariables,
	) => void | Promise<void>;
}

export function importSkillMutationOptions({
	api,
	queryClient,
	onSuccess,
}: ImportSkillMutationParams) {
	return mutationOptions({
		mutationFn: ({ agent, body, projectPath }: ImportSkillVariables) =>
			api.skills.import(agent, body, projectPath),
		onSuccess: async (data, variables) => {
			await invalidateSkillQueries(queryClient);
			await onSuccess?.(data, variables);
		},
	});
}

interface InstallSkillMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (data: InstallSkillResponse) => void | Promise<void>;
}

export function installSkillMutationOptions({
	api,
	queryClient,
	onSuccess,
}: InstallSkillMutationParams) {
	return mutationOptions({
		mutationFn: (body: InstallSkillRequest) => api.skills.install(body),
		onSuccess: async (data, variables) => {
			if (!variables.audit_only) {
				await invalidateSkillQueries(queryClient);
			}
			await onSuccess?.(data);
		},
	});
}

interface DeleteSkillByPathMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: () => void | Promise<void>;
}

export function deleteSkillByPathMutationOptions({
	api,
	queryClient,
	onSuccess,
}: DeleteSkillByPathMutationParams) {
	return mutationOptions({
		mutationFn: async (body: DeleteSkillByPathRequest) => {
			const result = await api.skills.deleteByPath(body);

			if (!result.success) {
				throw new Error(result.error || "Failed to delete skill");
			}

			return result;
		},
		onSuccess: async () => {
			await invalidateSkillQueries(queryClient);
			await onSuccess?.();
		},
	});
}

interface ReconcileSkillsMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (data: OperationBatchResponse) => void | Promise<void>;
}

export function reconcileSkillsMutationOptions({
	api,
	queryClient,
	onSuccess,
}: ReconcileSkillsMutationParams) {
	return mutationOptions({
		mutationFn: (body: ReconcileRequest) => api.skills.reconcile(body),
		onSuccess: async (data) => {
			await invalidateSkillQueries(queryClient);
			await onSuccess?.(data);
		},
	});
}

interface TransferSkillsMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (data: OperationBatchResponse) => void | Promise<void>;
}

export function transferSkillsMutationOptions({
	api,
	queryClient,
	onSuccess,
}: TransferSkillsMutationParams) {
	return mutationOptions({
		mutationFn: (body: TransferRequest) => api.skills.transfer(body),
		onSuccess: async (data) => {
			await invalidateSkillQueries(queryClient);
			await onSuccess?.(data);
		},
	});
}

export function gitScanSkillsMutationOptions({ api }: { api: ApiClient }) {
	return mutationOptions({
		mutationFn: (body: GitScanRequest) => api.skills.gitScan(body),
	});
}

interface GitInstallSkillsMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (data: GitInstallResponse) => void | Promise<void>;
}

export function gitInstallSkillsMutationOptions({
	api,
	queryClient,
	onSuccess,
}: GitInstallSkillsMutationParams) {
	return mutationOptions({
		mutationFn: (body: GitInstallRequest) => api.skills.gitInstall(body),
		onSuccess: async (data, variables) => {
			if (!variables.audit_only) {
				await invalidateSkillQueries(queryClient);
			}
			await onSuccess?.(data);
		},
	});
}

export function openSkillFolderMutationOptions({ api }: { api: ApiClient }) {
	return mutationOptions({
		mutationFn: (skillPath: string) => api.skills.openFolder(skillPath),
	});
}

interface GitSyncSkillMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (data: GitSyncResponse) => void | Promise<void>;
}

export function gitSyncSkillMutationOptions({
	api,
	queryClient,
	onSuccess,
}: GitSyncSkillMutationParams) {
	return mutationOptions({
		mutationFn: (body: GitSyncRequest) => api.skills.gitSync(body),
		onSuccess: async (data) => {
			if (!data.success) {
				await onSuccess?.(data);
				return;
			}
			await onSuccess?.(data);
			await invalidateSkillQueries(queryClient);
		},
	});
}
