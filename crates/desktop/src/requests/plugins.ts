import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import type {
	CCPluginCheckUpdateRequest,
	CCPluginCheckUpdateResponse,
	CCPluginConfigResponse,
	CCPluginDetailResponse,
	CCPluginInstallRequest,
	CCPluginInstallResponse,
	CCPluginListResponse,
	CCPluginMarketResponse,
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
	onSuccess?: (
		data: Awaited<ReturnType<ApiClient["plugins"]["updateMarketplace"]>>,
	) => void | Promise<void>;
}

export function updateMarketplaceMutationOptions({
	api,
	queryClient,
	onSuccess,
}: UpdateMarketplaceMutationParams) {
	return mutationOptions({
		mutationFn: () => api.plugins.updateMarketplace(),
		onSuccess: async (data) => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.plugins.market(),
			});
			await onSuccess?.(data);
		},
	});
}

export interface PluginToggleSnapshot {
	previousPlugins?: CCPluginListResponse;
	previousDetail?: CCPluginDetailResponse;
	previousMarket?: CCPluginMarketResponse[];
}

export function updatePluginCaches(
	queryClient: QueryClient,
	pluginId: string,
	currentPlugin: CCPluginResponse,
	updater: (entry: CCPluginResponse) => CCPluginResponse,
) {
	queryClient.setQueryData<CCPluginListResponse | undefined>(
		queryKeys.plugins.list(),
		(existing) =>
			existing
				? {
						...existing,
						plugins: existing.plugins.map((entry) =>
							entry.id === pluginId ? updater(entry) : entry,
						),
					}
				: existing,
	);
	queryClient.setQueryData<CCPluginDetailResponse | undefined>(
		queryKeys.plugins.detail(pluginId),
		(existing) =>
			existing
				? {
						...existing,
						...updater(existing),
					}
				: existing,
	);
	queryClient.setQueryData<CCPluginMarketResponse[] | undefined>(
		queryKeys.plugins.market(),
		(existing) =>
			existing?.map((entry) =>
				entry.id === pluginId
					? { ...entry, enabled: updater(currentPlugin).enabled }
					: entry,
			) ?? existing,
	);
}

interface TogglePluginMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	pluginId: string;
	currentPlugin: CCPluginResponse;
	onSuccess?: (data: CCPluginResponse) => void | Promise<void>;
}

function togglePluginMutationOptions(
	enabled: boolean,
	mutationFn: (pluginId: string) => Promise<CCPluginResponse>,
	{
		queryClient,
		pluginId,
		currentPlugin,
		onSuccess,
	}: Omit<TogglePluginMutationParams, "api">,
) {
	return mutationOptions({
		mutationFn,
		onMutate: async (): Promise<PluginToggleSnapshot> => {
			await Promise.all([
				queryClient.cancelQueries({
					queryKey: queryKeys.plugins.list(),
				}),
				queryClient.cancelQueries({
					queryKey: queryKeys.plugins.detail(pluginId),
				}),
				queryClient.cancelQueries({
					queryKey: queryKeys.plugins.market(),
				}),
			]);

			const previousPlugins =
				queryClient.getQueryData<CCPluginListResponse>(
					queryKeys.plugins.list(),
				);
			const previousDetail =
				queryClient.getQueryData<CCPluginDetailResponse>(
					queryKeys.plugins.detail(pluginId),
				);
			const previousMarket = queryClient.getQueryData<
				CCPluginMarketResponse[]
			>(queryKeys.plugins.market());

			updatePluginCaches(
				queryClient,
				pluginId,
				currentPlugin,
				(entry) => ({
					...entry,
					enabled,
				}),
			);

			return {
				previousPlugins,
				previousDetail,
				previousMarket,
			};
		},
		onSuccess: async (data: CCPluginResponse) => {
			updatePluginCaches(
				queryClient,
				pluginId,
				currentPlugin,
				(entry) => ({
					...entry,
					...data,
				}),
			);
			await invalidatePluginSkillQueries(queryClient);
			await onSuccess?.(data);
		},
		onError: (
			_error: Error,
			_pluginId: string,
			context: PluginToggleSnapshot | undefined,
		) => {
			queryClient.setQueryData(
				queryKeys.plugins.list(),
				context?.previousPlugins,
			);
			queryClient.setQueryData(
				queryKeys.plugins.detail(pluginId),
				context?.previousDetail,
			);
			queryClient.setQueryData(
				queryKeys.plugins.market(),
				context?.previousMarket,
			);
		},
	});
}

export function enablePluginMutationOptions({
	api,
	queryClient,
	pluginId,
	currentPlugin,
	onSuccess,
}: TogglePluginMutationParams) {
	return togglePluginMutationOptions(true, (id) => api.plugins.enable(id), {
		queryClient,
		pluginId,
		currentPlugin,
		onSuccess,
	});
}

export function disablePluginMutationOptions({
	api,
	queryClient,
	pluginId,
	currentPlugin,
	onSuccess,
}: TogglePluginMutationParams) {
	return togglePluginMutationOptions(false, (id) => api.plugins.disable(id), {
		queryClient,
		pluginId,
		currentPlugin,
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

interface BulkUninstallPluginsMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (removedPluginIds: Set<string>) => void | Promise<void>;
	onError?: (error: Error) => void | Promise<void>;
}

export function bulkUninstallPluginsMutationOptions({
	api,
	queryClient,
	onSuccess,
	onError,
}: BulkUninstallPluginsMutationParams) {
	return mutationOptions({
		mutationFn: async (plugins: CCPluginResponse[]) => {
			const requests = plugins.flatMap((plugin) =>
				Array.from(
					new Map(
						plugin.scopes.map((scopeInfo) => [
							scopeInfo.scope,
							scopeInfo,
						]),
					).keys(),
				).map((scope) => ({
					pluginId: plugin.id,
					scope,
					request: api.plugins.uninstall({
						plugin_id: plugin.id,
						scope,
						keep_data: false,
					}),
				})),
			);
			const results = await Promise.allSettled(
				requests.map((entry) => entry.request),
			);
			const failures = results
				.map((result, index) => ({
					result,
					pluginId: requests[index]?.pluginId,
					scope: requests[index]?.scope,
				}))
				.filter(
					(
						entry,
					): entry is {
						result: PromiseRejectedResult;
						pluginId: string;
						scope: string;
					} => entry.result.status === "rejected",
				);

			if (failures.length > 0) {
				throw new Error(
					failures
						.map(({ pluginId, scope, result }) => {
							const reason =
								result.reason instanceof Error
									? result.reason.message
									: String(result.reason);

							return `${pluginId} (${scope}): ${reason}`;
						})
						.join("; "),
				);
			}

			return new Set(plugins.map((plugin) => plugin.id));
		},
		onSuccess: async (removedPluginIds) => {
			await invalidatePluginQueries(queryClient);
			await invalidatePluginSkillQueries(queryClient);
			await onSuccess?.(removedPluginIds);
		},
		onError: async (error) => {
			await invalidatePluginQueries(queryClient);
			await invalidatePluginSkillQueries(queryClient);
			await onError?.(
				error instanceof Error ? error : new Error(String(error)),
			);
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
