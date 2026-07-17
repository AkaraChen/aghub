import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import type {
	CreateExternalGatewayRequest,
	CreateManagedGatewayRequest,
	GatewayInstanceDto,
	GatewayProvisionStatusDto,
	GatewaySettingValue,
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

interface GatewayProvisionStatusQueryParams {
	api: ApiClient;
	enabled?: boolean;
}

export function gatewayProvisionStatusQueryOptions({
	api,
	enabled = true,
}: GatewayProvisionStatusQueryParams) {
	return queryOptions({
		queryKey: queryKeys.gateway.provisionStatus(),
		queryFn: () => api.gateway.provisionStatus(),
		enabled,
		staleTime: 0,
		// Poll only while a download is actually in flight.
		refetchInterval: (query) => {
			const phase = query.state.data?.phase;
			return phase === "downloading" || phase === "extracting"
				? 1_000
				: false;
		},
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

export async function invalidateGatewayInstanceQueries(
	queryClient: QueryClient,
) {
	await queryClient.invalidateQueries({
		queryKey: queryKeys.gateway.instances(),
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

interface ProvisionGatewayMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (data: GatewayProvisionStatusDto) => void | Promise<void>;
}

export function provisionGatewayMutationOptions({
	api,
	queryClient,
	onSuccess,
}: ProvisionGatewayMutationParams) {
	return mutationOptions({
		mutationFn: () => api.gateway.provision(),
		onSuccess: async (data) => {
			// Seed the status cache so the poller sees the in-flight phase
			// immediately instead of waiting for the next refetch.
			queryClient.setQueryData(queryKeys.gateway.provisionStatus(), data);
			await queryClient.invalidateQueries({
				queryKey: queryKeys.gateway.provisionStatus(),
			});
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
			await onSuccess?.();
		},
	});
}
