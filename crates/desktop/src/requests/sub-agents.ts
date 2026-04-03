import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import type {
	CreateSubAgentRequest,
	OperationBatchResponse,
	ReconcileRequest,
	SubAgentResponse,
	TransferRequest,
	UpdateSubAgentRequest,
} from "../generated/dto";
import type { ApiClient } from "./client";
import { queryKeys } from "./keys";

interface SubAgentListQueryParams {
	api: ApiClient;
	scope?: "global" | "project" | "all";
	projectRoot?: string;
	enabled?: boolean;
	staleTime?: number;
}

export function subAgentListQueryOptions({
	api,
	scope = "global",
	projectRoot,
	enabled = true,
	staleTime = 30_000,
}: SubAgentListQueryParams) {
	return queryOptions({
		queryKey: queryKeys.subAgents.list(scope, projectRoot),
		queryFn: () => api.subAgents.listAll(scope, projectRoot),
		enabled,
		staleTime,
	});
}

export async function invalidateSubAgentQueries(queryClient: QueryClient) {
	await queryClient.invalidateQueries({
		queryKey: queryKeys.subAgents.all(),
	});
}

interface CreateSubAgentVariables {
	agent: string;
	scope: "global" | "project";
	body: CreateSubAgentRequest;
	projectRoot?: string;
}

interface CreateSubAgentMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: SubAgentResponse,
		variables: CreateSubAgentVariables,
	) => void | Promise<void>;
}

export function createSubAgentMutationOptions({
	api,
	queryClient,
	onSuccess,
}: CreateSubAgentMutationParams) {
	return mutationOptions({
		mutationFn: ({
			agent,
			scope,
			body,
			projectRoot,
		}: CreateSubAgentVariables) =>
			api.subAgents.create(agent, scope, body, projectRoot),
		onSuccess: async (data, variables) => {
			await invalidateSubAgentQueries(queryClient);
			await onSuccess?.(data, variables);
		},
	});
}

interface UpdateSubAgentVariables {
	name: string;
	agent: string;
	scope: "global" | "project";
	body: UpdateSubAgentRequest;
	projectRoot?: string;
}

interface UpdateSubAgentMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: SubAgentResponse,
		variables: UpdateSubAgentVariables,
	) => void | Promise<void>;
}

export function updateSubAgentMutationOptions({
	api,
	queryClient,
	onSuccess,
}: UpdateSubAgentMutationParams) {
	return mutationOptions({
		mutationFn: ({
			name,
			agent,
			scope,
			body,
			projectRoot,
		}: UpdateSubAgentVariables) =>
			api.subAgents.update(name, agent, scope, body, projectRoot),
		onSuccess: async (data, variables) => {
			await invalidateSubAgentQueries(queryClient);
			await onSuccess?.(data, variables);
		},
	});
}

interface DeleteSubAgentVariables {
	name: string;
	agent: string;
	scope: "global" | "project";
	projectRoot?: string;
}

interface DeleteSubAgentMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: () => void | Promise<void>;
}

export function deleteSubAgentMutationOptions({
	api,
	queryClient,
	onSuccess,
}: DeleteSubAgentMutationParams) {
	return mutationOptions({
		mutationFn: ({
			name,
			agent,
			scope,
			projectRoot,
		}: DeleteSubAgentVariables) =>
			api.subAgents.delete(name, agent, scope, projectRoot),
		onSuccess: async () => {
			await invalidateSubAgentQueries(queryClient);
			await onSuccess?.();
		},
	});
}

interface TransferSubAgentsMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (data: OperationBatchResponse) => void | Promise<void>;
}

export function transferSubAgentsMutationOptions({
	api,
	queryClient,
	onSuccess,
}: TransferSubAgentsMutationParams) {
	return mutationOptions({
		mutationFn: (body: TransferRequest) => api.subAgents.transfer(body),
		onSuccess: async (data) => {
			await invalidateSubAgentQueries(queryClient);
			await onSuccess?.(data);
		},
	});
}

interface ReconcileSubAgentsMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (data: OperationBatchResponse) => void | Promise<void>;
}

export function reconcileSubAgentsMutationOptions({
	api,
	queryClient,
	onSuccess,
}: ReconcileSubAgentsMutationParams) {
	return mutationOptions({
		mutationFn: (body: ReconcileRequest) => api.subAgents.reconcile(body),
		onSuccess: async (data) => {
			await invalidateSubAgentQueries(queryClient);
			await onSuccess?.(data);
		},
	});
}
