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
	SkillResponse,
	TransferRequest,
} from "../generated/dto";
import type { ApiClient } from "./client";
import { queryKeys } from "./keys";

interface SkillListQueryParams {
	api: ApiClient;
	scope?: "global" | "project" | "all";
	projectRoot?: string;
	enabled?: boolean;
	staleTime?: number;
}

export function skillListQueryOptions({
	api,
	scope = "global",
	projectRoot,
	enabled = true,
	staleTime = 30_000,
}: SkillListQueryParams) {
	return queryOptions({
		queryKey: queryKeys.skills.list(scope, projectRoot),
		queryFn: async () => {
			const skills = await api.skills.listAll(scope, projectRoot);
			// Filter out skills from Claude Code plugins (shown in Plugins tab instead)
			return skills.filter((skill) => !skill.plugin_id);
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
	enabled?: boolean;
	staleTime?: number;
}

export function skillContentQueryOptions({
	api,
	path,
	enabled = true,
	staleTime = 60_000,
}: SkillPathQueryParams) {
	return queryOptions({
		queryKey: queryKeys.skills.content(path ?? ""),
		queryFn: () => api.skills.getContent(path!),
		enabled: enabled && Boolean(path),
		staleTime,
	});
}

export function skillTreeQueryOptions({
	api,
	path,
	enabled = true,
	staleTime = 60_000,
}: SkillPathQueryParams) {
	return queryOptions({
		queryKey: queryKeys.skills.tree(path ?? ""),
		queryFn: () => api.skills.getTree(path!),
		enabled: enabled && Boolean(path),
		staleTime,
	});
}

export async function invalidateSkillQueries(queryClient: QueryClient) {
	await queryClient.invalidateQueries({
		queryKey: queryKeys.skills.all(),
	});
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
		onSuccess: async (data) => {
			await invalidateSkillQueries(queryClient);
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
		onSuccess: async (data) => {
			await invalidateSkillQueries(queryClient);
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
			await invalidateSkillQueries(queryClient);
			await onSuccess?.(data);
		},
	});
}
