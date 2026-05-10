import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import type { ApiClient } from "./client";
import { queryKeys } from "./keys";

interface WorkspaceFilesQueryParams {
	api: ApiClient;
	agentId: string;
	enabled?: boolean;
	staleTime?: number;
}

export function workspaceFilesQueryOptions({
	api,
	agentId,
	enabled = true,
	staleTime = 30_000,
}: WorkspaceFilesQueryParams) {
	return queryOptions({
		queryKey: queryKeys.workspace.files(agentId),
		queryFn: () => api.workspace.getAgentFiles(agentId),
		enabled: enabled && !!agentId,
		staleTime,
	});
}

interface WorkspaceFileContentQueryParams {
	api: ApiClient;
	agentId: string;
	path: string;
	enabled?: boolean;
	staleTime?: number;
}

export function workspaceFileContentQueryOptions({
	api,
	agentId,
	path,
	enabled = true,
	staleTime = 30_000,
}: WorkspaceFileContentQueryParams) {
	return queryOptions({
		queryKey: queryKeys.workspace.content(agentId, path),
		queryFn: () => api.workspace.getFileContent(agentId, path),
		enabled: enabled && !!agentId && !!path,
		staleTime,
	});
}

interface SaveFileMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: () => void;
}

export function saveFileMutationOptions({
	api,
	queryClient,
	onSuccess,
}: SaveFileMutationParams) {
	return mutationOptions({
		mutationFn: ({
			agentId,
			path,
			content,
		}: {
			agentId: string;
			path: string;
			content: string;
		}) => api.workspace.saveFile(agentId, path, content),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.workspace.all(),
			});
			onSuccess?.();
		},
	});
}
