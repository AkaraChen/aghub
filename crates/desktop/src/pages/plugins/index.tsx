"use client";

import {
	ArrowPathIcon,
	CheckCircleIcon,
	PlusIcon,
	PuzzlePieceIcon,
	RectangleStackIcon,
} from "@heroicons/react/24/solid";
import { AlertDialog, Button, Spinner, toast, Tooltip } from "@heroui/react";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListSearchHeader } from "../../components/list-search-header";
import { MultiSelectFloatingBar } from "../../components/multi-select-floating-bar";
import { PluginDetail } from "../../components/plugin-detail";
import { PluginList } from "../../components/plugin-list";
import { PluginMarketDialog } from "../../components/plugin-market-dialog";
import type { CCPluginResponse } from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import { cn } from "../../lib/utils";
import { queryKeys } from "../../requests/keys";
import {
	invalidatePluginQueries,
	invalidatePluginSkillQueries,
	pluginListQueryOptions,
} from "../../requests/plugins";

type PluginScopeValue = "user" | "project" | "local";

export default function PluginsPage() {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const { data, refetch, isFetching } = useSuspenseQuery(
		pluginListQueryOptions({ api }),
	);

	const plugins = useMemo(() => data?.plugins ?? [], [data]);
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedPluginId, setSelectedPluginId] = useState<string | null>(
		plugins[0]?.id ?? null,
	);
	const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
		() => new Set(),
	);
	const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
	const [isMarketDialogOpen, setIsMarketDialogOpen] = useState(false);
	const [isBulkUninstallDialogOpen, setIsBulkUninstallDialogOpen] =
		useState(false);
	const [selectedPluginScope, setSelectedPluginScope] = useState<{
		pluginId: string;
		scope: PluginScopeValue;
	} | null>(null);
	const validPluginIds = useMemo(
		() => new Set(plugins.map((plugin) => plugin.id)),
		[plugins],
	);
	const activeSelectedPluginId =
		selectedPluginId && validPluginIds.has(selectedPluginId)
			? selectedPluginId
			: (plugins[0]?.id ?? null);

	const selectedPlugin = useMemo(() => {
		return plugins.find((p) => p.id === activeSelectedPluginId) ?? null;
	}, [activeSelectedPluginId, plugins]);

	const marketInstallScope = useMemo(() => {
		if (!selectedPlugin) {
			return "user" as const;
		}

		if (
			selectedPluginScope &&
			selectedPluginScope.pluginId === selectedPlugin.id &&
			selectedPlugin.scopes.some(
				(scope) => scope.scope === selectedPluginScope.scope,
			)
		) {
			return selectedPluginScope.scope;
		}

		return (selectedPlugin.scopes.find(
			(scope) => scope.install_path === selectedPlugin.install_path,
		)?.scope ??
			selectedPlugin.scopes[0]?.scope ??
			"user") as PluginScopeValue;
	}, [selectedPlugin, selectedPluginScope]);

	// Sort plugins by name for stable ordering
	const sortedPlugins = useMemo(() => {
		return [...plugins].sort((a, b) => a.name.localeCompare(b.name));
	}, [plugins]);

	const filteredPlugins = useMemo(() => {
		if (!searchQuery) return sortedPlugins;
		const query = searchQuery.toLowerCase();
		return sortedPlugins.filter(
			(p) =>
				p.name.toLowerCase().includes(query) ||
				p.id.toLowerCase().includes(query),
		);
	}, [sortedPlugins, searchQuery]);

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
		if (activeSelectedPluginId) {
			return new Set([activeSelectedPluginId]);
		}
		return new Set<string>();
	}, [activeSelectedPluginId, isMultiSelectMode, selectedKeysInPlugins]);

	const handleSelectionChange = (keys: Set<string>, clickedKey?: string) => {
		setSelectedKeys(keys);

		if (clickedKey && !isMultiSelectMode) {
			setSelectedPluginId(clickedKey);
		} else if (keys.size === 1 && !isMultiSelectMode) {
			setSelectedPluginId([...keys][0] ?? null);
		} else if (keys.size === 0 && !isMultiSelectMode) {
			setSelectedPluginId(null);
		}

		if (keys.size > 1 && !isMultiSelectMode) {
			setIsMultiSelectMode(true);
		}
		if (keys.size === 0 && isMultiSelectMode) {
			setIsMultiSelectMode(false);
		}
	};

	const selectedPlugins = useMemo(() => {
		return plugins.filter((p) => selectedKeysInPlugins.has(p.id));
	}, [plugins, selectedKeysInPlugins]);

	const bulkUninstallMutation = useMutation({
		mutationFn: async (pluginsToUninstall: CCPluginResponse[]) => {
			const requests = pluginsToUninstall.flatMap((plugin) => {
				const uniqueScopes = Array.from(
					new Map(
						plugin.scopes.map((scopeInfo) => [
							scopeInfo.scope,
							scopeInfo,
						]),
					).values(),
				);

				return uniqueScopes.map((scopeInfo) => ({
					pluginId: plugin.id,
					scope: scopeInfo.scope,
					request: api.plugins.uninstall({
						plugin_id: plugin.id,
						scope: scopeInfo.scope,
						keep_data: false,
					}),
				}));
			});
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
				const failureSummary = failures
					.map(({ pluginId, scope, result }) => {
						const reason =
							result.reason instanceof Error
								? result.reason.message
								: String(result.reason);

						return `${pluginId} (${scope}): ${reason}`;
					})
					.join("; ");

				throw new Error(failureSummary);
			}

			return new Set(pluginsToUninstall.map((plugin) => plugin.id));
		},
		onSuccess: async (removedPluginIds) => {
			toast.success(
				t("pluginsUninstalled", {
					count: removedPluginIds.size,
				}),
			);
			setSelectedKeys(new Set());
			setIsMultiSelectMode(false);
			setIsBulkUninstallDialogOpen(false);
			setSelectedPluginScope(null);
			setSelectedPluginId((currentSelectedId) => {
				if (
					currentSelectedId &&
					!removedPluginIds.has(currentSelectedId)
				) {
					return currentSelectedId;
				}

				return (
					plugins.find((plugin) => !removedPluginIds.has(plugin.id))
						?.id ?? null
				);
			});
			await invalidatePluginQueries(queryClient);
			await invalidatePluginSkillQueries(queryClient);
		},
		onError: async (error) => {
			toast.danger(
				t("bulkUninstallPluginsFailed", {
					error:
						error instanceof Error ? error.message : String(error),
				}),
			);
			await invalidatePluginQueries(queryClient);
			await invalidatePluginSkillQueries(queryClient);
		},
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
			{/* Plugin List Panel */}
			<div className="relative flex w-80 shrink-0 flex-col border-r border-border">
				<ListSearchHeader
					searchValue={searchQuery}
					onSearchChange={setSearchQuery}
					placeholder={t("searchPlugins")}
					ariaLabel={t("searchPlugins")}
				>
					<Tooltip delay={0}>
						<Tooltip.Trigger>
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								className="shrink-0"
								onPress={() => setIsMarketDialogOpen(true)}
								aria-label={t("installFromMarket")}
							>
								<PlusIcon className="size-4" />
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>
							{t("installFromMarket")}
						</Tooltip.Content>
					</Tooltip>
					<Tooltip delay={0}>
						<Tooltip.Trigger>
							<div
								role="button"
								tabIndex={0}
								className={cn(
									"flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-default hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40",
									isMultiSelectMode &&
										"bg-accent/10 text-accent",
								)}
								aria-label={
									isMultiSelectMode
										? t("doneSelecting")
										: t("multiSelect")
								}
								onClick={() => {
									setIsMultiSelectMode((prev) => !prev);
									if (isMultiSelectMode) {
										handleSelectionChange(new Set());
									}
								}}
								onKeyDown={(event) => {
									if (
										event.key !== "Enter" &&
										event.key !== " "
									) {
										return;
									}
									event.preventDefault();
									setIsMultiSelectMode((prev) => !prev);
									if (isMultiSelectMode) {
										handleSelectionChange(new Set());
									}
								}}
							>
								{isMultiSelectMode ? (
									<CheckCircleIcon className="size-4" />
								) : (
									<RectangleStackIcon className="size-4" />
								)}
							</div>
						</Tooltip.Trigger>
						<Tooltip.Content>
							{isMultiSelectMode
								? t("doneSelecting")
								: t("multiSelect")}
						</Tooltip.Content>
					</Tooltip>
					<Tooltip delay={0}>
						<Tooltip.Trigger>
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								className="shrink-0"
								aria-label={t("refreshPlugins")}
								onPress={() => void handleRefresh()}
								isDisabled={isFetching}
							>
								<ArrowPathIcon
									className={cn(
										"size-4",
										isFetching && "animate-spin",
									)}
								/>
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>{t("refreshPlugins")}</Tooltip.Content>
					</Tooltip>
				</ListSearchHeader>

				<div className="flex-1 overflow-y-auto">
					<PluginList
						plugins={filteredPlugins}
						selectedKeys={effectiveSelectedKeys}
						searchQuery={searchQuery}
						onSelectionChange={handleSelectionChange}
						selectionMode="multiple"
						isMultiSelectMode={isMultiSelectMode}
					/>
				</div>

				{isMultiSelectMode && selectedKeys.size > 0 && (
					<MultiSelectFloatingBar
						selectedCount={selectedKeys.size}
						totalCount={plugins.length}
						onDelete={() => setIsBulkUninstallDialogOpen(true)}
					/>
				)}
			</div>

			{/* Plugin Detail Panel */}
			<div className="flex-1 overflow-hidden">
				{selectedPlugin ? (
					<PluginDetail
						key={selectedPlugin.id}
						plugin={selectedPlugin}
						selectedScope={marketInstallScope}
						onScopeChange={(scope) =>
							setSelectedPluginScope({
								pluginId: selectedPlugin.id,
								scope,
							})
						}
					/>
				) : (
					<div className="flex h-full flex-col items-center justify-center gap-3">
						<div className="flex size-16 items-center justify-center rounded-full bg-surface-secondary">
							<PuzzlePieceIcon className="size-8 text-muted" />
						</div>
						<div className="text-center">
							<h3 className="mb-1 text-lg font-semibold">
								{t("plugins")}
							</h3>
							<p className="max-w-sm text-sm text-muted">
								{t("selectPlugin")}
							</p>
						</div>
					</div>
				)}
			</div>

			<PluginMarketDialog
				isOpen={isMarketDialogOpen}
				onClose={() => setIsMarketDialogOpen(false)}
				installScope={marketInstallScope}
			/>

			<AlertDialog.Backdrop
				isOpen={isBulkUninstallDialogOpen}
				onOpenChange={(open) => {
					if (bulkUninstallMutation.isPending) {
						return;
					}
					setIsBulkUninstallDialogOpen(open);
				}}
			>
				<AlertDialog.Container>
					<AlertDialog.Dialog className="sm:max-w-[420px]">
						<AlertDialog.Header>
							<AlertDialog.Icon status="danger" />
							<AlertDialog.Heading>
								{t("bulkDeleteConfirmTitle")}
							</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body>
							<p className="text-sm text-muted">
								{t("bulkUninstallPluginsConfirm", {
									count: selectedPlugins.length,
								})}
							</p>
						</AlertDialog.Body>
						<AlertDialog.Footer>
							<Button
								variant="tertiary"
								onPress={() =>
									setIsBulkUninstallDialogOpen(false)
								}
								isDisabled={bulkUninstallMutation.isPending}
							>
								{t("cancel")}
							</Button>
							<Button
								variant="primary"
								className="bg-danger text-danger-foreground hover:bg-danger/90"
								onPress={() =>
									bulkUninstallMutation.mutate(
										selectedPlugins,
									)
								}
								isDisabled={
									bulkUninstallMutation.isPending ||
									selectedPlugins.length === 0
								}
							>
								{bulkUninstallMutation.isPending ? (
									<Spinner size="sm" color="current" />
								) : (
									t("deleteSelected")
								)}
							</Button>
						</AlertDialog.Footer>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</div>
	);
}
