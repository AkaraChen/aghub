import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import type {
	AddGatewayCompatProviderRequest,
	AddGatewayUpstreamKeyRequest,
	CreateExternalGatewayRequest,
	CreateManagedGatewayRequest,
	GatewayInstanceDto,
	GatewayOauthExcludedModelsDto,
	GatewaySettingValue,
	ImportGatewayVertexRequest,
	UpdateGatewayInstanceRequest,
	UploadGatewayAuthFileRequest,
} from "../generated/dto";
import type { ApiClient } from "./client";
import { queryKeys } from "./keys";

interface GatewayInstanceListQueryParams {
	api: ApiClient;
	enabled?: boolean;
}

export function gatewayInstanceListQueryOptions({
	api,
	enabled = true,
}: GatewayInstanceListQueryParams) {
	return queryOptions({
		queryKey: queryKeys.gateway.instances(),
		queryFn: () => api.gateway.listInstances(),
		enabled,
		// Statuses move on their own (start/stop/health checks), so keep the
		// list fresh.
		staleTime: 5_000,
	});
}

interface GatewayInstanceScopedQueryParams {
	api: ApiClient;
	instanceId: string;
	enabled?: boolean;
}

export function gatewayVersionQueryOptions({
	api,
	instanceId,
	enabled = true,
}: GatewayInstanceScopedQueryParams) {
	return queryOptions({
		queryKey: queryKeys.gateway.version(instanceId),
		queryFn: () => api.gateway.version(instanceId),
		enabled,
		staleTime: 60_000,
	});
}

export function gatewayAuthFilesQueryOptions({
	api,
	instanceId,
	enabled = true,
}: GatewayInstanceScopedQueryParams) {
	return queryOptions({
		queryKey: queryKeys.gateway.authFiles(instanceId),
		queryFn: () => api.gateway.listAuthFiles(instanceId),
		enabled,
		staleTime: 5_000,
	});
}

export function gatewayApiKeysQueryOptions({
	api,
	instanceId,
	enabled = true,
}: GatewayInstanceScopedQueryParams) {
	return queryOptions({
		queryKey: queryKeys.gateway.apiKeys(instanceId),
		queryFn: () => api.gateway.getApiKeys(instanceId),
		enabled,
		staleTime: 5_000,
	});
}

export function gatewaySettingsQueryOptions({
	api,
	instanceId,
	enabled = true,
}: GatewayInstanceScopedQueryParams) {
	return queryOptions({
		queryKey: queryKeys.gateway.settings(instanceId),
		queryFn: () => api.gateway.getSettings(instanceId),
		enabled,
		staleTime: 5_000,
	});
}

export function gatewayConfigFileQueryOptions({
	api,
	instanceId,
	enabled = true,
}: GatewayInstanceScopedQueryParams) {
	return queryOptions({
		queryKey: queryKeys.gateway.configFile(instanceId),
		queryFn: () => api.gateway.getConfigFile(instanceId),
		enabled,
		staleTime: 5_000,
	});
}

export function gatewayUsageQueryOptions({
	api,
	instanceId,
	enabled = true,
}: GatewayInstanceScopedQueryParams) {
	return queryOptions({
		queryKey: queryKeys.gateway.usage(instanceId),
		queryFn: () => api.gateway.usage(instanceId),
		enabled,
		staleTime: 15_000,
	});
}

export function gatewayUpstreamKeysQueryOptions({
	api,
	instanceId,
	enabled = true,
}: GatewayInstanceScopedQueryParams) {
	return queryOptions({
		queryKey: queryKeys.gateway.upstreamKeys(instanceId),
		queryFn: () => api.gateway.listUpstreamKeys(instanceId),
		enabled,
		staleTime: 5_000,
	});
}

export function gatewayCompatProvidersQueryOptions({
	api,
	instanceId,
	enabled = true,
}: GatewayInstanceScopedQueryParams) {
	return queryOptions({
		queryKey: queryKeys.gateway.compatProviders(instanceId),
		queryFn: () => api.gateway.listCompatProviders(instanceId),
		enabled,
		staleTime: 5_000,
	});
}

export function gatewayLogsQueryOptions({
	api,
	instanceId,
	enabled = true,
}: GatewayInstanceScopedQueryParams) {
	return queryOptions({
		queryKey: queryKeys.gateway.logs(instanceId),
		queryFn: () => api.gateway.logs(instanceId),
		enabled,
		staleTime: 0,
		// Follow the tail while the panel is mounted; stop polling once the
		// endpoint errors (e.g. file logging disabled) instead of hammering it.
		refetchInterval: (query) => (query.state.error ? false : 5_000),
		retry: false,
	});
}

export function gatewayOauthExcludedModelsQueryOptions({
	api,
	instanceId,
	enabled = true,
}: GatewayInstanceScopedQueryParams) {
	return queryOptions({
		queryKey: queryKeys.gateway.oauthExcludedModels(instanceId),
		queryFn: () => api.gateway.getOauthExcludedModels(instanceId),
		enabled,
		staleTime: 5_000,
	});
}

export async function invalidateGatewayInstanceQueries(
	queryClient: QueryClient,
) {
	await queryClient.invalidateQueries({
		queryKey: queryKeys.gateway.instances(),
	});
	// The backend mirrors every instance into inference-provider entries
	// (and imports models once it is running), so instance lifecycle
	// changes must refresh that inventory too.
	await queryClient.invalidateQueries({
		queryKey: queryKeys.inferenceProviders.all(),
	});
}

export async function invalidateGatewayAuthFileQueries(
	queryClient: QueryClient,
	instanceId: string,
) {
	await queryClient.invalidateQueries({
		queryKey: queryKeys.gateway.authFiles(instanceId),
	});
}

interface CreateManagedGatewayMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (data: GatewayInstanceDto) => void | Promise<void>;
}

export function createManagedGatewayMutationOptions({
	api,
	queryClient,
	onSuccess,
}: CreateManagedGatewayMutationParams) {
	return mutationOptions({
		mutationFn: (body: CreateManagedGatewayRequest) =>
			api.gateway.createManaged(body),
		onSuccess: async (data) => {
			await invalidateGatewayInstanceQueries(queryClient);
			await onSuccess?.(data);
		},
	});
}

interface CreateExternalGatewayMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (data: GatewayInstanceDto) => void | Promise<void>;
}

export function createExternalGatewayMutationOptions({
	api,
	queryClient,
	onSuccess,
}: CreateExternalGatewayMutationParams) {
	return mutationOptions({
		mutationFn: (body: CreateExternalGatewayRequest) =>
			api.gateway.createExternal(body),
		onSuccess: async (data) => {
			await invalidateGatewayInstanceQueries(queryClient);
			await onSuccess?.(data);
		},
	});
}

interface UpdateGatewayInstanceVariables {
	id: string;
	body: UpdateGatewayInstanceRequest;
}

interface UpdateGatewayInstanceMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (data: GatewayInstanceDto) => void | Promise<void>;
}

export function updateGatewayInstanceMutationOptions({
	api,
	queryClient,
	onSuccess,
}: UpdateGatewayInstanceMutationParams) {
	return mutationOptions({
		mutationFn: ({ id, body }: UpdateGatewayInstanceVariables) =>
			api.gateway.updateInstance(id, body),
		onSuccess: async (data) => {
			await invalidateGatewayInstanceQueries(queryClient);
			await onSuccess?.(data);
		},
	});
}

interface DeleteGatewayInstanceMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: () => void | Promise<void>;
}

export function deleteGatewayInstanceMutationOptions({
	api,
	queryClient,
	onSuccess,
}: DeleteGatewayInstanceMutationParams) {
	return mutationOptions({
		mutationFn: (id: string) => api.gateway.deleteInstance(id),
		onSuccess: async () => {
			await invalidateGatewayInstanceQueries(queryClient);
			await onSuccess?.();
		},
	});
}

interface GatewayInstanceLifecycleMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (data: GatewayInstanceDto) => void | Promise<void>;
}

export function startGatewayInstanceMutationOptions({
	api,
	queryClient,
	onSuccess,
}: GatewayInstanceLifecycleMutationParams) {
	return mutationOptions({
		mutationFn: (id: string) => api.gateway.startInstance(id),
		onSuccess: async (data) => {
			await invalidateGatewayInstanceQueries(queryClient);
			await onSuccess?.(data);
		},
	});
}

export function stopGatewayInstanceMutationOptions({
	api,
	queryClient,
	onSuccess,
}: GatewayInstanceLifecycleMutationParams) {
	return mutationOptions({
		mutationFn: (id: string) => api.gateway.stopInstance(id),
		onSuccess: async (data) => {
			await invalidateGatewayInstanceQueries(queryClient);
			await onSuccess?.(data);
		},
	});
}

interface UploadGatewayAuthFileVariables {
	instanceId: string;
	body: UploadGatewayAuthFileRequest;
}

interface UploadGatewayAuthFileMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		variables: UploadGatewayAuthFileVariables,
	) => void | Promise<void>;
}

export function uploadGatewayAuthFileMutationOptions({
	api,
	queryClient,
	onSuccess,
}: UploadGatewayAuthFileMutationParams) {
	return mutationOptions({
		mutationFn: ({ instanceId, body }: UploadGatewayAuthFileVariables) =>
			api.gateway.uploadAuthFile(instanceId, body),
		onSuccess: async (_data, variables) => {
			await invalidateGatewayAuthFileQueries(
				queryClient,
				variables.instanceId,
			);
			await onSuccess?.(variables);
		},
	});
}

interface DeleteGatewayAuthFileVariables {
	instanceId: string;
	name: string;
}

interface DeleteGatewayAuthFileMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: () => void | Promise<void>;
}

export function deleteGatewayAuthFileMutationOptions({
	api,
	queryClient,
	onSuccess,
}: DeleteGatewayAuthFileMutationParams) {
	return mutationOptions({
		mutationFn: ({ instanceId, name }: DeleteGatewayAuthFileVariables) =>
			api.gateway.deleteAuthFile(instanceId, name),
		onSuccess: async (_data, variables) => {
			await invalidateGatewayAuthFileQueries(
				queryClient,
				variables.instanceId,
			);
			await onSuccess?.();
		},
	});
}

interface UpdateGatewayApiKeysVariables {
	instanceId: string;
	keys: string[];
}

interface UpdateGatewayApiKeysMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: () => void | Promise<void>;
}

export function updateGatewayApiKeysMutationOptions({
	api,
	queryClient,
	onSuccess,
}: UpdateGatewayApiKeysMutationParams) {
	return mutationOptions({
		mutationFn: ({ instanceId, keys }: UpdateGatewayApiKeysVariables) =>
			api.gateway.updateApiKeys(instanceId, { keys }),
		onSuccess: async (_data, variables) => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.gateway.apiKeys(variables.instanceId),
			});
			await queryClient.invalidateQueries({
				queryKey: queryKeys.inferenceProviders.all(),
			});
			await onSuccess?.();
		},
	});
}

interface UpdateGatewaySettingVariables {
	instanceId: string;
	key: string;
	value: GatewaySettingValue;
}

interface UpdateGatewaySettingMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: () => void | Promise<void>;
}

export function updateGatewaySettingMutationOptions({
	api,
	queryClient,
	onSuccess,
}: UpdateGatewaySettingMutationParams) {
	return mutationOptions({
		mutationFn: ({
			instanceId,
			key,
			value,
		}: UpdateGatewaySettingVariables) =>
			api.gateway.updateSetting(instanceId, key, { value }),
		onSuccess: async (_data, variables) => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.gateway.settings(variables.instanceId),
			});
			await onSuccess?.();
		},
	});
}

interface AddGatewayUpstreamKeyVariables {
	instanceId: string;
	body: AddGatewayUpstreamKeyRequest;
}

interface GatewayScopedMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: () => void | Promise<void>;
}

export function addGatewayUpstreamKeyMutationOptions({
	api,
	queryClient,
	onSuccess,
}: GatewayScopedMutationParams) {
	return mutationOptions({
		mutationFn: ({ instanceId, body }: AddGatewayUpstreamKeyVariables) =>
			api.gateway.addUpstreamKey(instanceId, body),
		onSuccess: async (_data, variables) => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.gateway.upstreamKeys(variables.instanceId),
			});
			await onSuccess?.();
		},
	});
}

interface DeleteGatewayUpstreamKeyVariables {
	instanceId: string;
	provider: string;
	apiKey: string;
}

export function deleteGatewayUpstreamKeyMutationOptions({
	api,
	queryClient,
	onSuccess,
}: GatewayScopedMutationParams) {
	return mutationOptions({
		mutationFn: ({
			instanceId,
			provider,
			apiKey,
		}: DeleteGatewayUpstreamKeyVariables) =>
			api.gateway.deleteUpstreamKey(instanceId, provider, apiKey),
		onSuccess: async (_data, variables) => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.gateway.upstreamKeys(variables.instanceId),
			});
			await onSuccess?.();
		},
	});
}

interface AddGatewayCompatProviderVariables {
	instanceId: string;
	body: AddGatewayCompatProviderRequest;
}

export function addGatewayCompatProviderMutationOptions({
	api,
	queryClient,
	onSuccess,
}: GatewayScopedMutationParams) {
	return mutationOptions({
		mutationFn: ({ instanceId, body }: AddGatewayCompatProviderVariables) =>
			api.gateway.addCompatProvider(instanceId, body),
		onSuccess: async (_data, variables) => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.gateway.compatProviders(
					variables.instanceId,
				),
			});
			await onSuccess?.();
		},
	});
}

interface DeleteGatewayCompatProviderVariables {
	instanceId: string;
	name: string;
}

export function deleteGatewayCompatProviderMutationOptions({
	api,
	queryClient,
	onSuccess,
}: GatewayScopedMutationParams) {
	return mutationOptions({
		mutationFn: ({
			instanceId,
			name,
		}: DeleteGatewayCompatProviderVariables) =>
			api.gateway.deleteCompatProvider(instanceId, name),
		onSuccess: async (_data, variables) => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.gateway.compatProviders(
					variables.instanceId,
				),
			});
			await onSuccess?.();
		},
	});
}

interface ResetGatewayQuotaVariables {
	instanceId: string;
	authIndex: string;
}

export function resetGatewayQuotaMutationOptions({
	api,
	queryClient,
	onSuccess,
}: GatewayScopedMutationParams) {
	return mutationOptions({
		mutationFn: ({ instanceId, authIndex }: ResetGatewayQuotaVariables) =>
			api.gateway.resetQuota(instanceId, { auth_index: authIndex }),
		onSuccess: async (_data, variables) => {
			await invalidateGatewayAuthFileQueries(
				queryClient,
				variables.instanceId,
			);
			await onSuccess?.();
		},
	});
}

export function clearGatewayLogsMutationOptions({
	api,
	queryClient,
	onSuccess,
}: GatewayScopedMutationParams) {
	return mutationOptions({
		mutationFn: (instanceId: string) => api.gateway.clearLogs(instanceId),
		onSuccess: async (_data, instanceId) => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.gateway.logs(instanceId),
			});
			await onSuccess?.();
		},
	});
}

interface UpdateGatewayOauthExcludedModelsVariables {
	instanceId: string;
	body: GatewayOauthExcludedModelsDto;
}

export function updateGatewayOauthExcludedModelsMutationOptions({
	api,
	queryClient,
	onSuccess,
}: GatewayScopedMutationParams) {
	return mutationOptions({
		mutationFn: ({
			instanceId,
			body,
		}: UpdateGatewayOauthExcludedModelsVariables) =>
			api.gateway.updateOauthExcludedModels(instanceId, body),
		onSuccess: async (_data, variables) => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.gateway.oauthExcludedModels(
					variables.instanceId,
				),
			});
			await onSuccess?.();
		},
	});
}

interface ImportGatewayVertexVariables {
	instanceId: string;
	body: ImportGatewayVertexRequest;
}

export function importGatewayVertexMutationOptions({
	api,
	queryClient,
	onSuccess,
}: GatewayScopedMutationParams) {
	return mutationOptions({
		mutationFn: ({ instanceId, body }: ImportGatewayVertexVariables) =>
			api.gateway.importVertex(instanceId, body),
		onSuccess: async (_data, variables) => {
			await invalidateGatewayAuthFileQueries(
				queryClient,
				variables.instanceId,
			);
			await onSuccess?.();
		},
	});
}

interface UpdateGatewayConfigFileVariables {
	instanceId: string;
	content: string;
}

interface UpdateGatewayConfigFileMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: () => void | Promise<void>;
}

export function updateGatewayConfigFileMutationOptions({
	api,
	queryClient,
	onSuccess,
}: UpdateGatewayConfigFileMutationParams) {
	return mutationOptions({
		mutationFn: ({
			instanceId,
			content,
		}: UpdateGatewayConfigFileVariables) =>
			api.gateway.updateConfigFile(instanceId, { content }),
		onSuccess: async (_data, variables) => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.gateway.configFile(variables.instanceId),
			});
			await queryClient.invalidateQueries({
				queryKey: queryKeys.gateway.apiKeys(variables.instanceId),
			});
			await queryClient.invalidateQueries({
				queryKey: queryKeys.inferenceProviders.all(),
			});
			await onSuccess?.();
		},
	});
}
