import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import type {
	AgentProviderResponse,
	CodexProviderStateResponse,
	CreateAgentProviderRequest,
	CreateInferenceProviderRequest,
	InferenceProviderPresetResponse,
	InferenceProviderResponse,
	UpdateAgentProviderRequest,
	UpdateCodexActiveProfileRequest,
	UpdateCodexProfileProviderRequest,
	UpdateInferenceProviderRequest,
} from "../generated/dto";
import type { ApiClient } from "./client";
import { queryKeys } from "./keys";

interface InferenceProviderListQueryParams {
	api: ApiClient;
	enabled?: boolean;
	staleTime?: number;
}

export function inferenceProviderListQueryOptions({
	api,
	enabled = true,
	staleTime = 30_000,
}: InferenceProviderListQueryParams) {
	return queryOptions({
		queryKey: queryKeys.inferenceProviders.list(),
		queryFn: () => api.inferenceProviders.list(),
		enabled,
		staleTime,
	});
}

interface InferenceProviderPresetsQueryParams {
	api: ApiClient;
	enabled?: boolean;
	staleTime?: number;
}

export function inferenceProviderPresetsQueryOptions({
	api,
	enabled = true,
	staleTime = 60 * 60 * 1000,
}: InferenceProviderPresetsQueryParams) {
	return queryOptions<InferenceProviderPresetResponse[]>({
		queryKey: queryKeys.inferenceProviders.presets(),
		queryFn: () => api.inferenceProviders.listPresets(),
		enabled,
		staleTime,
	});
}

export function openCodeProviderListQueryOptions({
	api,
	enabled = true,
	staleTime = 30_000,
}: InferenceProviderListQueryParams) {
	return queryOptions({
		queryKey: queryKeys.inferenceProviders.agent("opencode"),
		queryFn: () => api.inferenceProviders.listOpenCode(),
		enabled,
		staleTime,
	});
}

export function codexProviderListQueryOptions({
	api,
	enabled = true,
	staleTime = 30_000,
}: InferenceProviderListQueryParams) {
	return queryOptions({
		queryKey: queryKeys.inferenceProviders.agent("codex"),
		queryFn: () => api.inferenceProviders.listCodex(),
		enabled,
		staleTime,
	});
}

export function codexProviderStateQueryOptions({
	api,
	enabled = true,
	staleTime = 30_000,
}: InferenceProviderListQueryParams) {
	return queryOptions({
		queryKey: queryKeys.inferenceProviders.agentState("codex"),
		queryFn: () => api.inferenceProviders.getCodexState(),
		enabled,
		staleTime,
	});
}

export async function invalidateInferenceProviderQueries(
	queryClient: QueryClient,
) {
	await queryClient.invalidateQueries({
		queryKey: queryKeys.inferenceProviders.all(),
	});
}

export async function invalidateOpenCodeProviderQueries(
	queryClient: QueryClient,
) {
	await queryClient.invalidateQueries({
		queryKey: queryKeys.inferenceProviders.agent("opencode"),
	});
}

export async function invalidateCodexProviderQueries(queryClient: QueryClient) {
	await queryClient.invalidateQueries({
		queryKey: queryKeys.inferenceProviders.agent("codex"),
	});
	await queryClient.invalidateQueries({
		queryKey: queryKeys.inferenceProviders.agentState("codex"),
	});
}

interface CreateInferenceProviderMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (data: InferenceProviderResponse) => void | Promise<void>;
}

export function createInferenceProviderMutationOptions({
	api,
	queryClient,
	onSuccess,
}: CreateInferenceProviderMutationParams) {
	return mutationOptions({
		mutationFn: (body: CreateInferenceProviderRequest) =>
			api.inferenceProviders.create(body),
		onSuccess: async (data) => {
			await invalidateInferenceProviderQueries(queryClient);
			await onSuccess?.(data);
		},
	});
}

interface CreateAgentProviderMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (data: AgentProviderResponse) => void | Promise<void>;
}

export function createOpenCodeProviderMutationOptions({
	api,
	queryClient,
	onSuccess,
}: CreateAgentProviderMutationParams) {
	return mutationOptions({
		mutationFn: (body: CreateAgentProviderRequest) =>
			api.inferenceProviders.createOpenCode(body),
		onSuccess: async (data) => {
			await invalidateOpenCodeProviderQueries(queryClient);
			await onSuccess?.(data);
		},
	});
}

export function createCodexProviderMutationOptions({
	api,
	queryClient,
	onSuccess,
}: CreateAgentProviderMutationParams) {
	return mutationOptions({
		mutationFn: (body: CreateAgentProviderRequest) =>
			api.inferenceProviders.createCodex(body),
		onSuccess: async (data) => {
			await invalidateCodexProviderQueries(queryClient);
			await onSuccess?.(data);
		},
	});
}

interface CreateInferenceModelVariables {
	providerName: string;
	modelName: string;
}

interface CreateInferenceModelMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: InferenceProviderResponse,
		variables: CreateInferenceModelVariables,
	) => void | Promise<void>;
}

export function createInferenceModelMutationOptions({
	api,
	queryClient,
	onSuccess,
}: CreateInferenceModelMutationParams) {
	return mutationOptions({
		mutationFn: ({
			providerName,
			modelName,
		}: CreateInferenceModelVariables) =>
			api.inferenceProviders.createModel(providerName, modelName),
		onSuccess: async (data, variables) => {
			await invalidateInferenceProviderQueries(queryClient);
			await onSuccess?.(data, variables);
		},
	});
}

interface UpdateInferenceProviderVariables {
	name: string;
	body: UpdateInferenceProviderRequest;
}

interface UpdateInferenceProviderMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: InferenceProviderResponse,
		variables: UpdateInferenceProviderVariables,
	) => void | Promise<void>;
}

export function updateInferenceProviderMutationOptions({
	api,
	queryClient,
	onSuccess,
}: UpdateInferenceProviderMutationParams) {
	return mutationOptions({
		mutationFn: ({ name, body }: UpdateInferenceProviderVariables) =>
			api.inferenceProviders.update(name, body),
		onSuccess: async (data, variables) => {
			await invalidateInferenceProviderQueries(queryClient);
			await onSuccess?.(data, variables);
		},
	});
}

interface UpdateAgentProviderVariables {
	id: string;
	body: UpdateAgentProviderRequest;
}

interface UpdateAgentProviderMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: AgentProviderResponse,
		variables: UpdateAgentProviderVariables,
	) => void | Promise<void>;
}

export function updateOpenCodeProviderMutationOptions({
	api,
	queryClient,
	onSuccess,
}: UpdateAgentProviderMutationParams) {
	return mutationOptions({
		mutationFn: ({ id, body }: UpdateAgentProviderVariables) =>
			api.inferenceProviders.updateOpenCode(id, body),
		onSuccess: async (data, variables) => {
			await invalidateOpenCodeProviderQueries(queryClient);
			await onSuccess?.(data, variables);
		},
	});
}

export function updateCodexProviderMutationOptions({
	api,
	queryClient,
	onSuccess,
}: UpdateAgentProviderMutationParams) {
	return mutationOptions({
		mutationFn: ({ id, body }: UpdateAgentProviderVariables) =>
			api.inferenceProviders.updateCodex(id, body),
		onSuccess: async (data, variables) => {
			await invalidateCodexProviderQueries(queryClient);
			await onSuccess?.(data, variables);
		},
	});
}

interface UpdateCodexActiveProfileMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (data: CodexProviderStateResponse) => void | Promise<void>;
}

export function updateCodexActiveProfileMutationOptions({
	api,
	queryClient,
	onSuccess,
}: UpdateCodexActiveProfileMutationParams) {
	return mutationOptions({
		mutationFn: (body: UpdateCodexActiveProfileRequest) =>
			api.inferenceProviders.updateCodexActiveProfile(body),
		onSuccess: async (data) => {
			await invalidateCodexProviderQueries(queryClient);
			await onSuccess?.(data);
		},
	});
}

interface UpdateCodexProfileProviderVariables {
	profileId: string;
	body: UpdateCodexProfileProviderRequest;
}

interface UpdateCodexProfileProviderMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: CodexProviderStateResponse,
		variables: UpdateCodexProfileProviderVariables,
	) => void | Promise<void>;
}

export function updateCodexProfileProviderMutationOptions({
	api,
	queryClient,
	onSuccess,
}: UpdateCodexProfileProviderMutationParams) {
	return mutationOptions({
		mutationFn: ({
			profileId,
			body,
		}: UpdateCodexProfileProviderVariables) =>
			api.inferenceProviders.updateCodexProfileProvider(profileId, body),
		onSuccess: async (data, variables) => {
			await invalidateCodexProviderQueries(queryClient);
			await onSuccess?.(data, variables);
		},
	});
}

interface SyncAgentProviderMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: AgentProviderResponse,
		id: string,
	) => void | Promise<void>;
}

export function syncOpenCodeProviderMutationOptions({
	api,
	queryClient,
	onSuccess,
}: SyncAgentProviderMutationParams) {
	return mutationOptions({
		mutationFn: (id: string) => api.inferenceProviders.syncOpenCode(id),
		onSuccess: async (data, id) => {
			await invalidateOpenCodeProviderQueries(queryClient);
			await onSuccess?.(data, id);
		},
	});
}

export function syncCodexProviderMutationOptions({
	api,
	queryClient,
	onSuccess,
}: SyncAgentProviderMutationParams) {
	return mutationOptions({
		mutationFn: (id: string) => api.inferenceProviders.syncCodex(id),
		onSuccess: async (data, id) => {
			await invalidateCodexProviderQueries(queryClient);
			await onSuccess?.(data, id);
		},
	});
}

interface UpdateInferenceModelVariables {
	providerName: string;
	modelName: string;
	nextModelName: string;
}

interface UpdateInferenceModelMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: InferenceProviderResponse,
		variables: UpdateInferenceModelVariables,
	) => void | Promise<void>;
}

export function updateInferenceModelMutationOptions({
	api,
	queryClient,
	onSuccess,
}: UpdateInferenceModelMutationParams) {
	return mutationOptions({
		mutationFn: ({
			providerName,
			modelName,
			nextModelName,
		}: UpdateInferenceModelVariables) =>
			api.inferenceProviders.updateModel(
				providerName,
				modelName,
				nextModelName,
			),
		onSuccess: async (data, variables) => {
			await invalidateInferenceProviderQueries(queryClient);
			await onSuccess?.(data, variables);
		},
	});
}

interface DeleteInferenceProviderMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: () => void | Promise<void>;
}

export function deleteInferenceProviderMutationOptions({
	api,
	queryClient,
	onSuccess,
}: DeleteInferenceProviderMutationParams) {
	return mutationOptions({
		mutationFn: (name: string) => api.inferenceProviders.delete(name),
		onSuccess: async () => {
			await invalidateInferenceProviderQueries(queryClient);
			await onSuccess?.();
		},
	});
}

interface DeleteAgentProviderMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: () => void | Promise<void>;
}

export function deleteOpenCodeProviderMutationOptions({
	api,
	queryClient,
	onSuccess,
}: DeleteAgentProviderMutationParams) {
	return mutationOptions({
		mutationFn: (id: string) => api.inferenceProviders.deleteOpenCode(id),
		onSuccess: async () => {
			await invalidateOpenCodeProviderQueries(queryClient);
			await onSuccess?.();
		},
	});
}

export function deleteCodexProviderMutationOptions({
	api,
	queryClient,
	onSuccess,
}: DeleteAgentProviderMutationParams) {
	return mutationOptions({
		mutationFn: (id: string) => api.inferenceProviders.deleteCodex(id),
		onSuccess: async () => {
			await invalidateCodexProviderQueries(queryClient);
			await onSuccess?.();
		},
	});
}

interface ClearCodexProviderMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: () => void | Promise<void>;
}

export function clearCodexProviderMutationOptions({
	api,
	queryClient,
	onSuccess,
}: ClearCodexProviderMutationParams) {
	return mutationOptions({
		mutationFn: () => api.inferenceProviders.clearCodexState(),
		onSuccess: async () => {
			await invalidateCodexProviderQueries(queryClient);
			await onSuccess?.();
		},
	});
}

interface DeleteInferenceModelVariables {
	providerName: string;
	modelName: string;
}

interface DeleteInferenceModelMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: InferenceProviderResponse,
		variables: DeleteInferenceModelVariables,
	) => void | Promise<void>;
}

export function deleteInferenceModelMutationOptions({
	api,
	queryClient,
	onSuccess,
}: DeleteInferenceModelMutationParams) {
	return mutationOptions({
		mutationFn: ({
			providerName,
			modelName,
		}: DeleteInferenceModelVariables) =>
			api.inferenceProviders.deleteModel(providerName, modelName),
		onSuccess: async (data, variables) => {
			await invalidateInferenceProviderQueries(queryClient);
			await onSuccess?.(data, variables);
		},
	});
}

// ============================================================================
// Claude Code
// ============================================================================

export function claudeProviderStateQueryOptions({
	api,
	enabled = true,
	staleTime = 30_000,
}: InferenceProviderListQueryParams) {
	return queryOptions({
		queryKey: queryKeys.inferenceProviders.agentState("claude"),
		queryFn: () => api.inferenceProviders.getClaudeState(),
		enabled,
		staleTime,
	});
}

export async function invalidateClaudeProviderQueries(
	queryClient: QueryClient,
) {
	await queryClient.invalidateQueries({
		queryKey: queryKeys.inferenceProviders.agentState("claude"),
	});
}

interface CreateClaudeProviderMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (data: AgentProviderResponse) => void | Promise<void>;
}

export function createClaudeProviderMutationOptions({
	api,
	queryClient,
	onSuccess,
}: CreateClaudeProviderMutationParams) {
	return mutationOptions({
		mutationFn: (body: CreateAgentProviderRequest) =>
			api.inferenceProviders.createClaude(body),
		onSuccess: async (data) => {
			await invalidateClaudeProviderQueries(queryClient);
			await onSuccess?.(data);
		},
	});
}

interface UpdateClaudeProviderMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: () => void | Promise<void>;
}

export function updateClaudeProviderMutationOptions({
	api,
	queryClient,
	onSuccess,
}: UpdateClaudeProviderMutationParams) {
	return mutationOptions({
		mutationFn: ({
			id,
			body,
		}: {
			id: string;
			body: UpdateAgentProviderRequest;
		}) => api.inferenceProviders.updateClaude(id, body),
		onSuccess: async () => {
			await invalidateClaudeProviderQueries(queryClient);
			await onSuccess?.();
		},
	});
}

interface SyncClaudeProviderMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: AgentProviderResponse,
		id: string,
	) => void | Promise<void>;
}

export function syncClaudeProviderMutationOptions({
	api,
	queryClient,
	onSuccess,
}: SyncClaudeProviderMutationParams) {
	return mutationOptions({
		mutationFn: (id: string) => api.inferenceProviders.syncClaude(id),
		onSuccess: async (data, id) => {
			await invalidateClaudeProviderQueries(queryClient);
			await onSuccess?.(data, id);
		},
	});
}

interface DeleteClaudeProviderMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: () => void | Promise<void>;
}

export function deleteClaudeProviderMutationOptions({
	api,
	queryClient,
	onSuccess,
}: DeleteClaudeProviderMutationParams) {
	return mutationOptions({
		mutationFn: (id: string) => api.inferenceProviders.deleteClaude(id),
		onSuccess: async () => {
			await invalidateClaudeProviderQueries(queryClient);
			await onSuccess?.();
		},
	});
}

interface ClearClaudeProviderMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: () => void | Promise<void>;
}

export function clearClaudeProviderMutationOptions({
	api,
	queryClient,
	onSuccess,
}: ClearClaudeProviderMutationParams) {
	return mutationOptions({
		mutationFn: () => api.inferenceProviders.clearClaudeState(),
		onSuccess: async () => {
			await invalidateClaudeProviderQueries(queryClient);
			await onSuccess?.();
		},
	});
}
