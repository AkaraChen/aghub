"use client";

import { PuzzlePieceIcon } from "@heroicons/react/24/solid";
import { toast } from "@heroui/react";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
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
import { usePluginsPageState } from "./use-plugins-page-state";

export default function PluginsPage() {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const { data, refetch, isFetching } = useSuspenseQuery(
		pluginListQueryOptions({ api }),
	);
	const plugins = data?.plugins ?? [];
	const {
		searchQuery,
		setSearchQuery,
		sortedPlugins,
		selectedPlugin,
		marketInstallScope,
		selectedKeysInPlugins,
		effectiveSelectedKeys,
		selectedPlugins,
		isMultiSelectMode,
		isMarketDialogOpen,
		isBulkUninstallDialogOpen,
		activeSelectedPluginId,
		handleSelectionChange,
		openMarketDialog,
		closeMarketDialog,
		toggleMultiSelect,
		openBulkUninstallDialog,
		setBulkUninstallDialogOpen,
		setSelectedPluginScope,
		clearBulkSelectionAfterUninstall,
	} = usePluginsPageState(plugins);

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
					onOpenMarket={openMarketDialog}
					onToggleMultiSelect={toggleMultiSelect}
					onRefresh={() => void handleRefresh()}
					onDeleteSelection={openBulkUninstallDialog}
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
							setSelectedPluginScope(selectedPlugin.id, scope)
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
				onClose={closeMarketDialog}
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
					setBulkUninstallDialogOpen(open);
				}}
				onConfirm={() => bulkUninstallMutation.mutate(selectedPlugins)}
			/>
		</div>
	);
}
