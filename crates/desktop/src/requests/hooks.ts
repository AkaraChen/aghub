import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import type {
	CreateHookRequest,
	HookResponse,
	UpdateHookRequest,
} from "../generated/dto";
import type { ApiClient } from "./client";
import { queryKeys } from "./keys";

interface HookListQueryParams {
	api: ApiClient;
	agent?: string;
	enabled?: boolean;
	staleTime?: number;
}

export function hookListQueryOptions({
	api,
	agent,
	enabled = true,
	staleTime = 30_000,
}: HookListQueryParams) {
	return queryOptions({
		queryKey: queryKeys.hooks.list(agent),
		queryFn: () => (agent ? api.hooks.list(agent) : api.hooks.listAll()),
		enabled,
		staleTime,
	});
}

export async function invalidateHookQueries(queryClient: QueryClient) {
	await queryClient.invalidateQueries({
		queryKey: queryKeys.hooks.all(),
	});
}

interface CreateHookVariables {
	agent: string;
	body: CreateHookRequest;
}

interface CreateHookMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: HookResponse,
		variables: CreateHookVariables,
	) => void | Promise<void>;
}

export function createHookMutationOptions({
	api,
	queryClient,
	onSuccess,
}: CreateHookMutationParams) {
	return mutationOptions({
		mutationFn: ({ agent, body }: CreateHookVariables) =>
			api.hooks.create(agent, body),
		onSuccess: async (data, variables) => {
			await invalidateHookQueries(queryClient);
			await onSuccess?.(data, variables);
		},
	});
}

interface UpdateHookVariables {
	agent: string;
	id: string;
	body: UpdateHookRequest;
}

interface UpdateHookMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: HookResponse,
		variables: UpdateHookVariables,
	) => void | Promise<void>;
}

export function updateHookMutationOptions({
	api,
	queryClient,
	onSuccess,
}: UpdateHookMutationParams) {
	return mutationOptions({
		mutationFn: ({ agent, id, body }: UpdateHookVariables) =>
			api.hooks.update(agent, id, body),
		onSuccess: async (data, variables) => {
			await invalidateHookQueries(queryClient);
			await onSuccess?.(data, variables);
		},
	});
}

interface DeleteHookVariables {
	agent: string;
	id: string;
}

interface DeleteHookMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (variables: DeleteHookVariables) => void | Promise<void>;
}

export function deleteHookMutationOptions({
	api,
	queryClient,
	onSuccess,
}: DeleteHookMutationParams) {
	return mutationOptions({
		mutationFn: ({ agent, id }: DeleteHookVariables) =>
			api.hooks.delete(agent, id),
		onSuccess: async (_data, variables) => {
			await invalidateHookQueries(queryClient);
			await onSuccess?.(variables);
		},
	});
}
