import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import type {
	CreatePromptRequest,
	ImportPromptBackupRequest,
	PromptImportResultResponse,
	PromptResponse,
	UpdatePromptRequest,
} from "../generated/dto";
import type { ApiClient } from "./client";
import { queryKeys } from "./keys";

interface PromptListQueryParams {
	api: ApiClient;
	enabled?: boolean;
	staleTime?: number;
}

interface ImportPromptBackupMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: PromptImportResultResponse,
		variables: ImportPromptBackupRequest,
	) => void | Promise<void>;
}

export function importPromptBackupMutationOptions({
	api,
	queryClient,
	onSuccess,
}: ImportPromptBackupMutationParams) {
	return mutationOptions({
		mutationFn: (body: ImportPromptBackupRequest) =>
			api.prompts.importBackup(body),
		onSuccess: async (data, variables) => {
			await invalidatePromptQueries(queryClient);
			await onSuccess?.(data, variables);
		},
	});
}

export function promptListQueryOptions({
	api,
	enabled = true,
	staleTime = 30_000,
}: PromptListQueryParams) {
	return queryOptions({
		queryKey: queryKeys.prompts.list(),
		queryFn: () => api.prompts.list(),
		enabled,
		staleTime,
	});
}

export async function invalidatePromptQueries(queryClient: QueryClient) {
	await queryClient.invalidateQueries({ queryKey: queryKeys.prompts.all() });
}

interface CreatePromptMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: PromptResponse,
		variables: CreatePromptRequest,
	) => void | Promise<void>;
}

export function createPromptMutationOptions({
	api,
	queryClient,
	onSuccess,
}: CreatePromptMutationParams) {
	return mutationOptions({
		mutationFn: (body: CreatePromptRequest) => api.prompts.create(body),
		onSuccess: async (data, variables) => {
			await invalidatePromptQueries(queryClient);
			await onSuccess?.(data, variables);
		},
	});
}

interface UpdatePromptVariables {
	id: string;
	body: UpdatePromptRequest;
}

interface UpdatePromptMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: PromptResponse,
		variables: UpdatePromptVariables,
	) => void | Promise<void>;
}

export function updatePromptMutationOptions({
	api,
	queryClient,
	onSuccess,
}: UpdatePromptMutationParams) {
	return mutationOptions({
		mutationFn: ({ id, body }: UpdatePromptVariables) =>
			api.prompts.update(id, body),
		onSuccess: async (data, variables) => {
			await invalidatePromptQueries(queryClient);
			await onSuccess?.(data, variables);
		},
	});
}

interface DeletePromptMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: () => void | Promise<void>;
}

export function deletePromptMutationOptions({
	api,
	queryClient,
	onSuccess,
}: DeletePromptMutationParams) {
	return mutationOptions({
		mutationFn: (id: string) => api.prompts.delete(id),
		onSuccess: async () => {
			await invalidatePromptQueries(queryClient);
			await onSuccess?.();
		},
	});
}
