"use client";

import { ArrowPathIcon } from "@heroicons/react/24/solid";
import {
	Button,
	ListBox,
	Modal,
	SearchField,
	Select,
	toast,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "../hooks/use-api";
import { usePluginInstallState } from "../hooks/use-plugin-install-state";
import { cn } from "../lib/utils";
import {
	installPluginMutationOptions,
	pluginMarketQueryOptions,
	updateMarketplaceMutationOptions,
} from "../requests/plugins";
import { PluginMarketTable } from "./plugin-market/market-table";

interface PluginMarketDialogProps {
	isOpen: boolean;
	onClose: () => void;
	installScope?: "global" | "project" | "local";
}

const OTHER_CATEGORY = "other";

export function PluginMarketDialog({
	isOpen,
	onClose,
	installScope = "global",
}: PluginMarketDialogProps) {
	const { t, i18n } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedCategory, setSelectedCategory] = useState<string | null>(
		null,
	);
	const deferredSearchQuery = useDeferredValue(searchQuery);
	const {
		installStateById,
		transientPluginsById,
		markInstalling,
		markInstalled,
		clearInstallState,
	} = usePluginInstallState();

	const compactFormatter = useMemo(
		() =>
			new Intl.NumberFormat(i18n.language, {
				notation: "compact",
				compactDisplay: "short",
			}),
		[i18n.language],
	);

	const {
		data: plugins = [],
		isLoading,
		refetch,
		isError,
		error,
	} = useQuery(pluginMarketQueryOptions({ api, enabled: isOpen }));

	const errorMessage = (value: unknown) =>
		value instanceof Error ? value.message : t("unknownError");

	const installMutation = useMutation({
		...installPluginMutationOptions({
			api,
			queryClient,
			onSuccess: async (_data, variables) => {
				toast.success(
					t("pluginInstalled", { id: variables.plugin_id }),
				);
				markInstalled(variables.plugin_id);
			},
		}),
		onError: (mutationError, variables) => {
			clearInstallState(variables.plugin_id);
			toast.danger(errorMessage(mutationError));
		},
	});

	const updateMarketplaceMutation = useMutation({
		...updateMarketplaceMutationOptions({
			api,
			queryClient,
			onSuccess: async (data) => {
				toast.success(t("marketplaceUpdated"), {
					description: t("marketplaceUpdatedCount", {
						count: data.updated_count,
					}),
				});
			},
		}),
		onError: (mutationError) => {
			toast.danger(t("marketplaceUpdateFailed"), {
				description: errorMessage(mutationError),
			});
		},
	});

	const getCategoryLabel = (category: string) =>
		t(`pluginCategories.${category.toLowerCase()}`, {
			defaultValue:
				category.charAt(0).toUpperCase() +
				category.slice(1).toLowerCase(),
		});

	const installedPluginsCount = useMemo(
		() =>
			plugins.filter((plugin) =>
				plugin.installed_scopes?.includes(installScope),
			).length,
		[plugins, installScope],
	);

	const marketPlugins = useMemo(
		() =>
			plugins.filter(
				(plugin) => !plugin.installed_scopes?.includes(installScope),
			),
		[plugins, installScope],
	);

	const categories = useMemo(() => {
		const values = new Set<string>();
		for (const plugin of marketPlugins) {
			values.add(plugin.category || OTHER_CATEGORY);
		}
		return Array.from(values).sort((a, b) => {
			if (a === OTHER_CATEGORY) {
				return 1;
			}
			if (b === OTHER_CATEGORY) {
				return -1;
			}
			return a.localeCompare(b);
		});
	}, [marketPlugins]);

	const filteredPlugins = useMemo(() => {
		let filtered = marketPlugins;
		const normalizedQuery = deferredSearchQuery.trim().toLowerCase();

		if (normalizedQuery) {
			filtered = filtered.filter(
				(plugin) =>
					plugin.name.toLowerCase().includes(normalizedQuery) ||
					(plugin.description &&
						plugin.description
							.toLowerCase()
							.includes(normalizedQuery)),
			);
		}

		if (selectedCategory) {
			filtered = filtered.filter(
				(plugin) =>
					(plugin.category || OTHER_CATEGORY) === selectedCategory,
			);
		}

		for (const plugin of Object.values(transientPluginsById)) {
			const matchesSearch =
				!normalizedQuery ||
				plugin.name.toLowerCase().includes(normalizedQuery) ||
				(plugin.description &&
					plugin.description.toLowerCase().includes(normalizedQuery));
			const matchesCategory =
				!selectedCategory ||
				(plugin.category || OTHER_CATEGORY) === selectedCategory;

			if (
				matchesSearch &&
				matchesCategory &&
				!filtered.some((entry) => entry.id === plugin.id)
			) {
				filtered = [...filtered, plugin];
			}
		}

		return [...filtered].sort((a, b) => b.installs - a.installs);
	}, [
		marketPlugins,
		deferredSearchQuery,
		selectedCategory,
		transientPluginsById,
	]);

	const handleInstall = (pluginId: string) => {
		const plugin = marketPlugins.find((entry) => entry.id === pluginId);
		if (!plugin || installStateById[pluginId]) {
			return;
		}

		markInstalling(pluginId, plugin);
		installMutation.mutate({
			plugin_id: pluginId,
			scope: installScope,
		});
	};

	const handleUpdateMarketplace = () => {
		updateMarketplaceMutation.mutate();
	};

	const resetFilters = () => {
		setSearchQuery("");
		setSelectedCategory(null);
	};

	const handleClose = () => {
		resetFilters();
		onClose();
	};

	const selectedCategoryKey = selectedCategory ?? "__all__";
	const isRefreshingMarketplace = updateMarketplaceMutation.isPending;
	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={handleClose}>
			<Modal.Container>
				<Modal.Dialog className="max-h-[80vh] w-[calc(100vw-2rem)] max-w-5xl overflow-hidden">
					<Modal.CloseTrigger />
					<Modal.Body className="flex min-h-0 flex-col gap-2.5 overflow-hidden px-4 pb-2.5 pt-3.5">
						<div className="shrink-0">
							<div className="flex items-center gap-2">
								<SearchField
									value={searchQuery}
									onChange={setSearchQuery}
									aria-label={t("searchPlugins")}
									className="min-w-0 flex-1 [&_[data-slot=group]]:bg-surface-secondary/55 [&_[data-slot=group]]:shadow-none"
								>
									<SearchField.Group>
										<SearchField.SearchIcon />
										<SearchField.Input
											placeholder={t("searchPlugins")}
										/>
										<SearchField.ClearButton />
									</SearchField.Group>
								</SearchField>
								<Select
									variant="secondary"
									aria-label={t("pluginMarketCategory")}
									selectedKey={selectedCategoryKey}
									onSelectionChange={(key) =>
										setSelectedCategory(
											key === "__all__"
												? null
												: (key as string),
										)
									}
									className="min-w-32 max-w-40 shrink-0"
								>
									<Select.Trigger>
										<Select.Value />
										<Select.Indicator />
									</Select.Trigger>
									<Select.Popover>
										<ListBox>
											<ListBox.Item
												id="__all__"
												textValue={t("all")}
											>
												{t("all")}
											</ListBox.Item>
											{categories.map((category) => (
												<ListBox.Item
													key={category}
													id={category}
													textValue={getCategoryLabel(
														category,
													)}
												>
													{getCategoryLabel(category)}
												</ListBox.Item>
											))}
										</ListBox>
									</Select.Popover>
								</Select>
								<Button
									variant="secondary"
									size="sm"
									className="shrink-0"
									onPress={handleUpdateMarketplace}
									isDisabled={isRefreshingMarketplace}
								>
									<span className="flex items-center gap-1.5">
										<ArrowPathIcon
											className={cn(
												"size-4",
												isRefreshingMarketplace &&
													"animate-spin",
											)}
										/>
										{isRefreshingMarketplace
											? t("refreshing")
											: t("updateMarketplace")}
									</span>
								</Button>
							</div>
						</div>

						<PluginMarketTable
							plugins={filteredPlugins}
							isLoading={isLoading}
							isError={isError}
							error={error}
							searchQuery={searchQuery}
							compactFormatter={compactFormatter}
							onRetry={refetch}
							onInstall={handleInstall}
							installStates={installStateById}
						/>
					</Modal.Body>

					<div className="shrink-0 border-t border-separator/70 px-4 py-2">
						<div className="flex items-center justify-between gap-3">
							<div className="flex items-center gap-2 text-xs text-muted">
								<span>
									{filteredPlugins.length ===
									marketPlugins.length
										? t("availablePluginsCount", {
												count: marketPlugins.length,
											})
										: t("showingPluginsCount", {
												filtered:
													filteredPlugins.length,
												total: marketPlugins.length,
											})}
								</span>
								<span aria-hidden="true">·</span>
								<span>
									{t("installedPluginsCount", {
										count: installedPluginsCount,
									})}
								</span>
							</div>
							<div className="flex items-center">
								<Button
									variant="secondary"
									size="sm"
									onPress={handleClose}
								>
									{t("menu.close")}
								</Button>
							</div>
						</div>
					</div>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
