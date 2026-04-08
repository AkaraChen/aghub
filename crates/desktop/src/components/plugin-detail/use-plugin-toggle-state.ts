"use client";

import { useMutation, type QueryClient } from "@tanstack/react-query";
import type {
	CCPluginDetailResponse,
	CCPluginListResponse,
	CCPluginMarketResponse,
	CCPluginResponse,
} from "../../generated/dto";
import type { ApiClient } from "../../requests/client";
import { queryKeys } from "../../requests/keys";

interface UsePluginToggleStateParams {
	api: ApiClient;
	queryClient: QueryClient;
	pluginId: string;
	currentPlugin: CCPluginResponse;
	onSkillsChanged: () => void | Promise<void>;
}

export function usePluginToggleState({
	api,
	queryClient,
	pluginId,
	currentPlugin,
	onSkillsChanged,
}: UsePluginToggleStateParams) {
	const updatePluginCaches = (
		updater: (entry: CCPluginResponse) => CCPluginResponse,
	) => {
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
	};

	const applyPluginEnabledState = (enabled: boolean) => {
		updatePluginCaches((entry) => ({
			...entry,
			enabled,
		}));
	};

	const enableMutation = useMutation({
		mutationFn: (id: string) => api.plugins.enable(id),
		onMutate: async () => {
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

			applyPluginEnabledState(true);

			return {
				previousPlugins,
				previousDetail,
				previousMarket,
			};
		},
		onSuccess: async (data) => {
			updatePluginCaches((entry) => ({
				...entry,
				...data,
			}));
			await onSkillsChanged();
		},
		onError: (_error, _variables, context) => {
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

	const disableMutation = useMutation({
		mutationFn: (id: string) => api.plugins.disable(id),
		onMutate: async () => {
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

			applyPluginEnabledState(false);

			return {
				previousPlugins,
				previousDetail,
				previousMarket,
			};
		},
		onSuccess: async (data) => {
			updatePluginCaches((entry) => ({
				...entry,
				...data,
			}));
			await onSkillsChanged();
		},
		onError: (_error, _variables, context) => {
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

	return {
		enableMutation,
		disableMutation,
		isToggling: enableMutation.isPending || disableMutation.isPending,
	};
}
