import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import type {
	CCPluginCheckUpdateRequest,
	CCPluginCheckUpdateResponse,
	CCPluginConfigResponse,
	CCPluginInstallRequest,
	CCPluginInstallResponse,
	CCPluginReinstallRequest,
	CCPluginReinstallResponse,
	CCPluginResponse,
	CCPluginUninstallRequest,
	CCPluginUninstallResponse,
	CCPluginUpdateRequest,
	CCPluginUpdateResponse,
	CCPluginUpdateConfigRequest,
} from "../generated/dto";
import type { ApiClient } from "./client";
import { queryKeys } from "./keys";

interface PluginListQueryParams {
	api: ApiClient;
	enabled?: boolean;
	staleTime?: number;
}

export function pluginListQueryOptions({
	api,
	enabled = true,
	staleTime = 30_000,
}: PluginListQueryParams) {
	return queryOptions({
		queryKey: queryKeys.plugins.list(),
		queryFn: () => api.plugins.list(),
		enabled,
		staleTime,
	});
}

interface PluginDetailQueryParams {
	api: ApiClient;
	pluginId?: string;
	enabled?: boolean;
	staleTime?: number;
}

export function pluginDetailQueryOptions({
	api,
	pluginId,
	enabled = true,
	staleTime = 30_000,
}: PluginDetailQueryParams) {
	const isEnabled = enabled && Boolean(pluginId);
	return queryOptions({
		queryKey: pluginId
			? queryKeys.plugins.detail(pluginId)
			: queryKeys.plugins.detailDisabled(),
		queryFn: () => api.plugins.detail(pluginId!),
		enabled: isEnabled,
		staleTime,
	});
}

interface PluginUpdateStatusQueryParams {
	api: ApiClient;
	pluginId?: string;
	scope?: string | null;
	enabled?: boolean;
	staleTime?: number;
}

export function pluginUpdateStatusQueryOptions({
	api,
	pluginId,
	scope,
	enabled = true,
	staleTime = 30_000,
}: PluginUpdateStatusQueryParams) {
	const isEnabled = enabled && Boolean(pluginId);
	return queryOptions({
		queryKey: pluginId
			? queryKeys.plugins.updateStatus(pluginId, scope)
			: queryKeys.plugins.updateStatusDisabled(),
		queryFn: () =>
			api.plugins.checkUpdate({
				plugin_id: pluginId!,
				scope: scope ?? undefined,
			}),
		enabled: isEnabled,
		staleTime,
	});
}

interface PluginMarketQueryParams {
	api: ApiClient;
	enabled?: boolean;
	staleTime?: number;
}

export function pluginMarketQueryOptions({
	api,
	enabled = true,
	staleTime = 30_000,
}: PluginMarketQueryParams) {
	return queryOptions({
		queryKey: queryKeys.plugins.market(),
		queryFn: () => api.plugins.listMarket(),
		enabled,
		staleTime,
	});
}

export async function invalidatePluginQueries(
	queryClient: QueryClient,
	pluginId?: string,
) {
	await queryClient.invalidateQueries({
		queryKey: queryKeys.plugins.all(),
	});
	await queryClient.invalidateQueries({
		queryKey: queryKeys.plugins.market(),
	});

	if (pluginId) {
		await queryClient.invalidateQueries({
			queryKey: queryKeys.plugins.detail(pluginId),
		});
	}
}

export async function invalidatePluginSkillQueries(queryClient: QueryClient) {
	await queryClient.invalidateQueries({
		queryKey: queryKeys.skills.all(),
	});
}

interface InstallPluginMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: CCPluginInstallResponse,
		variables: CCPluginInstallRequest,
	) => void | Promise<void>;
}

export function installPluginMutationOptions({
	api,
	queryClient,
	onSuccess,
}: InstallPluginMutationParams) {
	return mutationOptions({
		mutationFn: (body: CCPluginInstallRequest) => api.plugins.install(body),
		onSuccess: async (data, variables) => {
			await invalidatePluginQueries(queryClient, variables.plugin_id);
			await onSuccess?.(data, variables);
		},
	});
}

interface UpdateMarketplaceMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: () => void | Promise<void>;
}

export function updateMarketplaceMutationOptions({
	api,
	queryClient,
	onSuccess,
}: UpdateMarketplaceMutationParams) {
	return mutationOptions({
		mutationFn: () => api.plugins.updateMarketplace(),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.plugins.market(),
			});
			await onSuccess?.();
		},
	});
}

interface EnablePluginMutationParams {
	api: ApiClient;
	onSuccess?: (
		data: CCPluginResponse,
		pluginId: string,
	) => void | Promise<void>;
}

export function enablePluginMutationOptions({
	api,
	onSuccess,
}: EnablePluginMutationParams) {
	return mutationOptions({
		mutationFn: (pluginId: string) => api.plugins.enable(pluginId),
		onSuccess,
	});
}

interface DisablePluginMutationParams {
	api: ApiClient;
	onSuccess?: (
		data: CCPluginResponse,
		pluginId: string,
	) => void | Promise<void>;
}

export function disablePluginMutationOptions({
	api,
	onSuccess,
}: DisablePluginMutationParams) {
	return mutationOptions({
		mutationFn: (pluginId: string) => api.plugins.disable(pluginId),
		onSuccess,
	});
}

interface UpdatePluginMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: CCPluginUpdateResponse,
		variables: CCPluginUpdateRequest,
	) => void | Promise<void>;
}

export function updatePluginMutationOptions({
	api,
	queryClient,
	onSuccess,
}: UpdatePluginMutationParams) {
	return mutationOptions({
		mutationFn: (body: CCPluginUpdateRequest) => api.plugins.update(body),
		onSuccess: async (data, variables) => {
			await invalidatePluginQueries(queryClient, variables.plugin_id);
			await onSuccess?.(data, variables);
		},
	});
}

interface CheckPluginUpdateMutationParams {
	api: ApiClient;
	onSuccess?: (
		data: CCPluginCheckUpdateResponse,
		variables: CCPluginCheckUpdateRequest,
	) => void | Promise<void>;
}

export function checkPluginUpdateMutationOptions({
	api,
	onSuccess,
}: CheckPluginUpdateMutationParams) {
	return mutationOptions({
		mutationFn: (body: CCPluginCheckUpdateRequest) =>
			api.plugins.checkUpdate(body),
		onSuccess,
	});
}

interface ReinstallPluginMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: CCPluginReinstallResponse,
		variables: CCPluginReinstallRequest,
	) => void | Promise<void>;
}

export function reinstallPluginMutationOptions({
	api,
	queryClient,
	onSuccess,
}: ReinstallPluginMutationParams) {
	return mutationOptions({
		mutationFn: (body: CCPluginReinstallRequest) =>
			api.plugins.reinstall(body),
		onSuccess: async (data, variables) => {
			await invalidatePluginQueries(queryClient, variables.plugin_id);
			await onSuccess?.(data, variables);
		},
	});
}

interface UninstallPluginMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: CCPluginUninstallResponse,
		variables: CCPluginUninstallRequest,
	) => void | Promise<void>;
}

export function uninstallPluginMutationOptions({
	api,
	queryClient,
	onSuccess,
}: UninstallPluginMutationParams) {
	return mutationOptions({
		mutationFn: (body: CCPluginUninstallRequest) =>
			api.plugins.uninstall(body),
		onSuccess: async (data, variables) => {
			await invalidatePluginQueries(queryClient, variables.plugin_id);
			await invalidatePluginSkillQueries(queryClient);
			await onSuccess?.(data, variables);
		},
	});
}

interface UpdatePluginConfigMutationParams {
	api: ApiClient;
	onSuccess?: (
		data: CCPluginConfigResponse,
		variables: { body: CCPluginUpdateConfigRequest },
	) => void | Promise<void>;
}

export function updatePluginConfigMutationOptions({
	api,
	onSuccess,
}: UpdatePluginConfigMutationParams) {
	return mutationOptions({
		mutationFn: ({ body }: { body: CCPluginUpdateConfigRequest }) =>
			api.plugins.updateConfig(body),
		onSuccess,
	});
}
