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

interface PluginToggleSnapshot {
	previousPlugins?: CCPluginListResponse;
	previousDetail?: CCPluginDetailResponse;
	previousMarket?: CCPluginMarketResponse[];
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

	const createPluginToggleOptions = (
		mutationFn: (id: string) => Promise<CCPluginResponse>,
		enabled: boolean,
	) => ({
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

			applyPluginEnabledState(enabled);

			return {
				previousPlugins,
				previousDetail,
				previousMarket,
			};
		},
		onSuccess: async (data: CCPluginResponse) => {
			updatePluginCaches((entry) => ({
				...entry,
				...data,
			}));
			await onSkillsChanged();
		},
		onError: (
			_error: Error,
			_variables: string,
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

	const enableMutation = useMutation<
		CCPluginResponse,
		Error,
		string,
		PluginToggleSnapshot
	>(createPluginToggleOptions((id) => api.plugins.enable(id), true));

	const disableMutation = useMutation<
		CCPluginResponse,
		Error,
		string,
		PluginToggleSnapshot
	>(createPluginToggleOptions((id) => api.plugins.disable(id), false));

	return {
		enableMutation,
		disableMutation,
		isToggling: enableMutation.isPending || disableMutation.isPending,
	};
}
