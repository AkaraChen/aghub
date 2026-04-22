"use client";

import { toast } from "@heroui/react";
import {
	useMutation,
	type QueryClient,
	useQueryClient,
} from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import type {
	CCPluginCheckUpdateResponse,
	CCPluginDetailResponse,
	CCPluginListResponse,
	CCPluginMarketResponse,
	CCPluginResponse,
	CCPluginScopeResponse,
} from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import { queryKeys } from "../../requests/keys";
import {
	checkPluginUpdateMutationOptions,
	invalidatePluginSkillQueries,
	reinstallPluginMutationOptions,
	uninstallPluginMutationOptions,
	updatePluginMutationOptions,
} from "../../requests/plugins";

interface UsePluginDetailActionsParams {
	currentPlugin: CCPluginResponse;
	currentScope: "user" | "project" | "local";
	currentScopeInfo: CCPluginScopeResponse | null;
	updateAvailable: boolean;
	latestVersion: string | null;
}

interface PluginToggleSnapshot {
	previousPlugins?: CCPluginListResponse;
	previousDetail?: CCPluginDetailResponse;
	previousMarket?: CCPluginMarketResponse[];
}

function updatePluginCaches(
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

export function usePluginDetailActions({
	currentPlugin,
	currentScope,
	currentScopeInfo,
	updateAvailable,
	latestVersion,
}: UsePluginDetailActionsParams) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const pluginId = currentPlugin.id;
	const pluginScopeRequest = {
		plugin_id: pluginId,
		scope: currentScope,
	};
	const errorMessage = (error: unknown, fallbackKey: string) =>
		error instanceof Error && error.message
			? error.message
			: t(fallbackKey);
	const openWithErrorToast = (title: string, open: () => Promise<unknown>) =>
		void open().catch((error) => {
			toast.danger(title, {
				description: errorMessage(error, "unknownError"),
			});
		});
	const createPluginToggleOptions = (
		enabled: boolean,
		mutationFn: (pluginId: string) => Promise<CCPluginResponse>,
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

	const enableMutation = useMutation<
		CCPluginResponse,
		Error,
		string,
		PluginToggleSnapshot
	>(
		createPluginToggleOptions(true, (pluginToEnable) =>
			api.plugins.enable(pluginToEnable),
		),
	);

	const disableMutation = useMutation<
		CCPluginResponse,
		Error,
		string,
		PluginToggleSnapshot
	>(
		createPluginToggleOptions(false, (pluginToDisable) =>
			api.plugins.disable(pluginToDisable),
		),
	);
	const isToggling = enableMutation.isPending || disableMutation.isPending;

	const updateMutation = useMutation({
		...updatePluginMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				const version =
					latestVersion ??
					currentScopeInfo?.version ??
					currentPlugin.version;
				toast.success(
					t("pluginUpdated", {
						version,
					}),
				);
			},
		}),
		onError: (error) => toast.danger(errorMessage(error, "updateFailed")),
	});

	const checkUpdateMutation = useMutation({
		...checkPluginUpdateMutationOptions({ api }),
		onSuccess: (data) => {
			queryClient.setQueryData<CCPluginCheckUpdateResponse>(
				queryKeys.plugins.updateStatus(pluginId, currentScope),
				data,
			);

			void queryClient.invalidateQueries({
				queryKey: queryKeys.plugins.list(),
			});

			if (data.update_available) {
				toast.success(
					t("updateAvailable", {
						version: data.latest_version ?? "latest",
					}),
				);
				return;
			}

			toast.success(t("noUpdateAvailable"));
		},
		onError: (error) =>
			toast.danger(
				t("updateCheckFailed", {
					error: error.message || t("unknownError"),
				}),
			),
	});

	const reinstallMutation = useMutation({
		...reinstallPluginMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("pluginReinstalled"));
			},
		}),
		onError: (error) =>
			toast.danger(errorMessage(error, "reinstallFailed")),
	});

	const uninstallMutation = useMutation({
		...uninstallPluginMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("pluginUninstalled"));
			},
		}),
		onError: (error) =>
			toast.danger(errorMessage(error, "uninstallFailed")),
	});

	return {
		enableMutation,
		disableMutation,
		isToggling,
		updateMutation,
		checkUpdateMutation,
		reinstallMutation,
		uninstallMutation,
		handleSourceRefresh: () => {
			if (checkUpdateMutation.isPending || updateMutation.isPending) {
				return;
			}

			if (updateAvailable) {
				updateMutation.mutate(pluginScopeRequest);
				return;
			}

			checkUpdateMutation.mutate(pluginScopeRequest);
		},
		handleReinstall: () => {
			reinstallMutation.mutate({
				...pluginScopeRequest,
				keep_data: true,
			});
		},
		handleUninstall: () => {
			uninstallMutation.mutate({
				...pluginScopeRequest,
				keep_data: false,
			});
		},
		handleOpenUrl: (url: string | undefined) => {
			if (!url) {
				return;
			}

			openWithErrorToast(t("openRepository"), () => openUrl(url));
		},
		handleOpenInstallPath: () =>
			openWithErrorToast(t("openFolder"), () =>
				api.plugins.openFolder(currentPlugin.id, currentScope),
			),
	};
}
