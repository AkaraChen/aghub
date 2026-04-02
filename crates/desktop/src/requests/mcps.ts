import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import type { CreateMcpRequest } from "../generated/dto/CreateMcpRequest";
import type { McpResponse } from "../generated/dto/McpResponse";
import type { OperationBatchResponse } from "../generated/dto/OperationBatchResponse";
import type { ReconcileRequest } from "../generated/dto/ReconcileRequest";
import type { TransferRequest } from "../generated/dto/TransferRequest";
import type { UpdateMcpRequest } from "../generated/dto/UpdateMcpRequest";
import type { ApiClient } from "./client";
import { queryKeys } from "./keys";

interface McpListQueryParams {
	api: ApiClient;
	scope?: "global" | "project" | "all";
	projectRoot?: string;
	enabled?: boolean;
	staleTime?: number;
}

export function mcpListQueryOptions({
	api,
	scope = "global",
	projectRoot,
	enabled = true,
	staleTime = 30_000,
}: McpListQueryParams) {
	return queryOptions({
		queryKey: queryKeys.mcps.list(scope, projectRoot),
		queryFn: () => api.mcps.listAll(scope, projectRoot),
		enabled,
		staleTime,
	});
}

export async function invalidateMcpQueries(queryClient: QueryClient) {
	await queryClient.invalidateQueries({
		queryKey: queryKeys.mcps.all(),
	});
}

interface CreateMcpVariables {
	agent: string;
	scope: "global" | "project";
	body: CreateMcpRequest;
	projectRoot?: string;
}

interface CreateMcpMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: McpResponse,
		variables: CreateMcpVariables,
	) => void | Promise<void>;
}

export function createMcpMutationOptions({
	api,
	queryClient,
	onSuccess,
}: CreateMcpMutationParams) {
	return mutationOptions({
		mutationFn: ({ agent, scope, body, projectRoot }: CreateMcpVariables) =>
			api.mcps.create(agent, scope, body, projectRoot),
		onSuccess: async (data, variables) => {
			await invalidateMcpQueries(queryClient);
			await onSuccess?.(data, variables);
		},
	});
}

interface UpdateMcpVariables {
	name: string;
	agent: string;
	scope: "global" | "project";
	body: UpdateMcpRequest;
	projectRoot?: string;
}

interface UpdateMcpMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: McpResponse,
		variables: UpdateMcpVariables,
	) => void | Promise<void>;
}

export function updateMcpMutationOptions({
	api,
	queryClient,
	onSuccess,
}: UpdateMcpMutationParams) {
	return mutationOptions({
		mutationFn: ({
			name,
			agent,
			scope,
			body,
			projectRoot,
		}: UpdateMcpVariables) =>
			api.mcps.update(name, agent, scope, body, projectRoot),
		onSuccess: async (data, variables) => {
			await invalidateMcpQueries(queryClient);
			await onSuccess?.(data, variables);
		},
	});
}

interface DeleteMcpVariables {
	name: string;
	agent: string;
	scope: "global" | "project";
	projectRoot?: string;
}

interface DeleteMcpMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: () => void | Promise<void>;
}

export function deleteMcpMutationOptions({
	api,
	queryClient,
	onSuccess,
}: DeleteMcpMutationParams) {
	return mutationOptions({
		mutationFn: ({ name, agent, scope, projectRoot }: DeleteMcpVariables) =>
			api.mcps.delete(name, agent, scope, projectRoot),
		onSuccess: async () => {
			await invalidateMcpQueries(queryClient);
			await onSuccess?.();
		},
	});
}

interface ReconcileMcpsMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (data: OperationBatchResponse) => void | Promise<void>;
}

export function reconcileMcpsMutationOptions({
	api,
	queryClient,
	onSuccess,
}: ReconcileMcpsMutationParams) {
	return mutationOptions({
		mutationFn: (body: ReconcileRequest) => api.mcps.reconcile(body),
		onSuccess: async (data) => {
			await invalidateMcpQueries(queryClient);
			await onSuccess?.(data);
		},
	});
}

interface TransferMcpsMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (data: OperationBatchResponse) => void | Promise<void>;
}

export function transferMcpsMutationOptions({
	api,
	queryClient,
	onSuccess,
}: TransferMcpsMutationParams) {
	return mutationOptions({
		mutationFn: (body: TransferRequest) => api.mcps.transfer(body),
		onSuccess: async (data) => {
			await invalidateMcpQueries(queryClient);
			await onSuccess?.(data);
		},
	});
}
