"use client";

import { toast } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import type {
	CCPluginResponse,
	CCPluginScopeResponse,
} from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import {
	disablePluginMutationOptions,
	enablePluginMutationOptions,
	reinstallPluginMutationOptions,
	uninstallPluginMutationOptions,
	updatePluginMutationOptions,
} from "../../requests/plugins";

interface UsePluginDetailActionsParams {
	currentPlugin: CCPluginResponse;
	currentScope: "global" | "project" | "local";
	currentScopeInfo: CCPluginScopeResponse | null;
}

export function usePluginDetailActions({
	currentPlugin,
	currentScope,
	currentScopeInfo,
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

	const enableMutation = useMutation({
		...enablePluginMutationOptions({
			api,
			queryClient,
			pluginId,
			currentPlugin,
		}),
	});

	const disableMutation = useMutation({
		...disablePluginMutationOptions({
			api,
			queryClient,
			pluginId,
			currentPlugin,
		}),
	});
	const isToggling = enableMutation.isPending || disableMutation.isPending;

	const updateMutation = useMutation({
		...updatePluginMutationOptions({
			api,
			queryClient,
			onSuccess: async (data) => {
				const version =
					currentScopeInfo?.version ?? currentPlugin.version;
				toast.success(t("pluginUpdated", { version }), {
					description: data.restart_required
						? t("pluginUpdateRestartHint")
						: undefined,
				});
			},
		}),
		onError: (error) => toast.danger(errorMessage(error, "updateFailed")),
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
		reinstallMutation,
		uninstallMutation,
		handleUpdate: () => {
			if (updateMutation.isPending) {
				return;
			}
			updateMutation.mutate(pluginScopeRequest);
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
				prune: false,
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
