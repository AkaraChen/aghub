"use client";

import { ArrowPathIcon } from "@heroicons/react/24/solid";
import { Button, ListBox, SearchField, Select, toast } from "@heroui/react";
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

interface PluginMarketContentProps {
	installScope?: "global" | "project" | "local";
	/** Whether the underlying market query should run. */
	enabled?: boolean;
	/** Optional renderer for an extra footer slot (e.g. Close button in the dialog). */
	footerSlot?: React.ReactNode;
	/** Layout variant. Page expands to fill the available space; modal has a fixed cap controlled by the dialog wrapper. */
	variant?: "page" | "modal";
}

const OTHER_CATEGORY = "other";

/**
 * Discovery + install UI for Claude Code plugins. Used both inside the
 * <PluginMarketDialog> (modal chrome wraps this) and inline on the
 * Market page (no chrome).
 */
export function PluginMarketContent({
	installScope = "global",
	enabled = true,
	footerSlot,
	variant = "page",
}: PluginMarketContentProps) {
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
	} = useQuery(pluginMarketQueryOptions({ api, enabled }));

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

	const selectedCategoryKey = selectedCategory ?? "__all__";
	const isRefreshingMarketplace = updateMarketplaceMutation.isPending;

	const containerClass =
		variant === "modal"
			? "flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden"
			: "flex h-full min-h-0 flex-col gap-2.5 overflow-hidden p-4 sm:p-6";

	return (
		<div className={containerClass}>
			<div className="shrink-0">
				<div className="flex items-center gap-2">
					<SearchField
						variant="secondary"
						value={searchQuery}
						onChange={setSearchQuery}
						aria-label={t("searchPlugins")}
						className="min-w-0 flex-1"
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
								key === "__all__" ? null : (key as string),
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
								<ListBox.Item id="__all__" textValue={t("all")}>
									{t("all")}
								</ListBox.Item>
								{categories.map((category) => (
									<ListBox.Item
										key={category}
										id={category}
										textValue={getCategoryLabel(category)}
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
									isRefreshingMarketplace && "animate-spin",
								)}
							/>
							{t("updateMarketplace")}
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

			<div className="shrink-0 border-t border-separator/70 pt-2">
				<div className="flex items-center justify-between gap-3">
					<div className="flex items-center gap-2 text-xs text-muted">
						<span>
							{filteredPlugins.length === marketPlugins.length
								? t("availablePluginsCount", {
										count: marketPlugins.length,
									})
								: t("showingPluginsCount", {
										filtered: filteredPlugins.length,
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
					{footerSlot}
				</div>
			</div>
		</div>
	);
}
