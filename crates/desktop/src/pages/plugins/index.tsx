"use client";

import { PuzzlePieceIcon } from "@heroicons/react/24/solid";
import { toast } from "@heroui/react";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PluginDetail } from "../../components/plugin-detail";
import { PluginConfirmDialog } from "../../components/plugin-detail/confirm-dialog";
import { PluginList } from "../../components/plugin-list";
import { PluginMarketDialog } from "../../components/plugin-market-dialog";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "../../components/ui/empty";
import { useApi } from "../../hooks/use-api";
import { queryKeys } from "../../requests/keys";
import {
	bulkUninstallPluginsMutationOptions,
	pluginListQueryOptions,
} from "../../requests/plugins";

type PluginScopeValue = "global" | "project" | "local";

interface PluginScopeSelection {
	pluginId: string;
	scope: PluginScopeValue;
}

export default function PluginsPage() {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const { data, refetch, isFetching } = useSuspenseQuery(
		pluginListQueryOptions({ api }),
	);
	const plugins = data.plugins;
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedPluginId, setSelectedPluginId] = useState<string | null>(
		plugins[0]?.id ?? null,
	);
	const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
		() => new Set(),
	);
	const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
	const [selectedPluginScope, setSelectedPluginScope] =
		useState<PluginScopeSelection | null>(null);
	const [isMarketDialogOpen, setIsMarketDialogOpen] = useState(false);
	const [isBulkUninstallDialogOpen, setIsBulkUninstallDialogOpen] =
		useState(false);

	const sortedPlugins = useMemo(
		() =>
			[...plugins].sort((a, b) => {
				if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
				return a.name.localeCompare(b.name);
			}),
		[plugins],
	);
	const validPluginIds = useMemo(
		() => new Set(plugins.map((plugin) => plugin.id)),
		[plugins],
	);
	const activeSelectedPluginId =
		selectedPluginId && validPluginIds.has(selectedPluginId)
			? selectedPluginId
			: (plugins[0]?.id ?? null);
	const selectedPlugin =
		plugins.find((plugin) => plugin.id === activeSelectedPluginId) ?? null;
	const marketInstallScope =
		selectedPlugin &&
		selectedPluginScope?.pluginId === selectedPlugin.id &&
		selectedPlugin.scopes.some(
			(scope) => scope.scope === selectedPluginScope.scope,
		)
			? selectedPluginScope.scope
			: ((selectedPlugin?.display_scope ??
					selectedPlugin?.scopes[0]?.scope ??
					"global") as PluginScopeValue);
	const selectedKeysInPlugins = useMemo(
		() =>
			new Set(
				[...selectedKeys].filter((pluginId) =>
					validPluginIds.has(pluginId),
				),
			),
		[selectedKeys, validPluginIds],
	);
	const effectiveSelectedKeys = useMemo(() => {
		if (selectedKeysInPlugins.size > 0 && isMultiSelectMode) {
			return selectedKeysInPlugins;
		}

		return activeSelectedPluginId
			? new Set([activeSelectedPluginId])
			: new Set<string>();
	}, [selectedKeysInPlugins, isMultiSelectMode, activeSelectedPluginId]);
	const selectedPlugins = useMemo(
		() => plugins.filter((plugin) => selectedKeysInPlugins.has(plugin.id)),
		[plugins, selectedKeysInPlugins],
	);

	const handleSelectionChange = (keys: Set<string>, clickedKey?: string) => {
		setSelectedKeys(keys);

		if (!isMultiSelectMode) {
			if (clickedKey) {
				setSelectedPluginId(clickedKey);
			} else if (keys.size === 1) {
				setSelectedPluginId([...keys][0] ?? null);
			} else if (keys.size === 0) {
				setSelectedPluginId(null);
			}
		}

		if (keys.size > 1 && !isMultiSelectMode) {
			setIsMultiSelectMode(true);
		}

		if (keys.size === 0 && isMultiSelectMode) {
			setIsMultiSelectMode(false);
		}
	};

	const toggleMultiSelect = () => {
		if (isMultiSelectMode) {
			setSelectedKeys(new Set());
			setIsMultiSelectMode(false);
			return;
		}

		setIsMultiSelectMode(true);
	};

	const setSelectedPluginScopeForPlugin = (
		pluginId: string,
		scope: PluginScopeValue,
	) => {
		setSelectedPluginScope({
			pluginId,
			scope,
		});
	};

	const clearBulkSelectionAfterUninstall = (
		removedPluginIds: Set<string>,
	) => {
		setSelectedKeys(new Set());
		setIsMultiSelectMode(false);
		setSelectedPluginScope(null);
		setIsBulkUninstallDialogOpen(false);
		setSelectedPluginId((currentSelectedPluginId) =>
			currentSelectedPluginId &&
			!removedPluginIds.has(currentSelectedPluginId)
				? currentSelectedPluginId
				: (plugins.find((plugin) => !removedPluginIds.has(plugin.id))
						?.id ?? null),
		);
	};

	const bulkUninstallMutation = useMutation({
		...bulkUninstallPluginsMutationOptions({
			api,
			queryClient,
			onSuccess: async (removedPluginIds) => {
				toast.success(
					t("pluginsUninstalled", {
						count: removedPluginIds.size,
					}),
				);
				clearBulkSelectionAfterUninstall(removedPluginIds);
			},
			onError: async (error) => {
				toast.danger(
					t("bulkUninstallPluginsFailed", {
						error:
							error instanceof Error
								? error.message
								: String(error),
					}),
				);
			},
		}),
	});

	const handleRefresh = async () => {
		const refreshes: Array<Promise<unknown>> = [
			refetch(),
			queryClient.refetchQueries({
				queryKey: queryKeys.skills.all(),
				type: "active",
			}),
			queryClient.refetchQueries({
				queryKey: queryKeys.plugins.market(),
				type: "active",
			}),
		];

		if (activeSelectedPluginId) {
			refreshes.push(
				queryClient.refetchQueries({
					queryKey: queryKeys.plugins.detail(activeSelectedPluginId),
					type: "active",
				}),
			);
		}

		await Promise.all(refreshes);
	};

	return (
		<div className="flex h-full">
			<div className="relative flex w-80 shrink-0 flex-col border-r border-border">
				<PluginList
					plugins={sortedPlugins}
					selectedKeys={effectiveSelectedKeys}
					searchQuery={searchQuery}
					onSearchChange={setSearchQuery}
					onSelectionChange={handleSelectionChange}
					onOpenMarket={() => setIsMarketDialogOpen(true)}
					onToggleMultiSelect={toggleMultiSelect}
					onRefresh={() => void handleRefresh()}
					onDeleteSelection={() => setIsBulkUninstallDialogOpen(true)}
					selectedCount={selectedKeysInPlugins.size}
					totalCount={plugins.length}
					isRefreshing={isFetching}
					isMultiSelectMode={isMultiSelectMode}
				/>
			</div>

			<div className="flex-1 overflow-hidden">
				{selectedPlugin ? (
					<PluginDetail
						key={selectedPlugin.id}
						plugin={selectedPlugin}
						selectedScope={marketInstallScope}
						onScopeChange={(scope) =>
							setSelectedPluginScopeForPlugin(
								selectedPlugin.id,
								scope,
							)
						}
					/>
				) : (
					<Empty className="h-full gap-4 rounded-none border-none">
						<EmptyMedia
							variant="icon"
							className="size-16 rounded-full"
						>
							<PuzzlePieceIcon className="size-8 text-muted" />
						</EmptyMedia>
						<EmptyHeader>
							<EmptyTitle>{t("plugins")}</EmptyTitle>
							<EmptyDescription>
								{t("selectPlugin")}
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				)}
			</div>

			<PluginMarketDialog
				isOpen={isMarketDialogOpen}
				onClose={() => setIsMarketDialogOpen(false)}
				installScope={marketInstallScope}
			/>

			<PluginConfirmDialog
				isOpen={isBulkUninstallDialogOpen}
				title={t("bulkDeleteConfirmTitle")}
				description={t("bulkUninstallPluginsConfirm", {
					count: selectedPlugins.length,
				})}
				confirmLabel={t("deleteSelected")}
				cancelLabel={t("cancel")}
				status="danger"
				isPending={bulkUninstallMutation.isPending}
				isConfirmDisabled={selectedPlugins.length === 0}
				onOpenChange={(open) => {
					if (bulkUninstallMutation.isPending) {
						return;
					}
					setIsBulkUninstallDialogOpen(open);
				}}
				onConfirm={() => bulkUninstallMutation.mutate(selectedPlugins)}
			/>
		</div>
	);
}
