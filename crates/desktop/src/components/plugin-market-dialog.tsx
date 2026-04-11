"use client";

import { ArrowPathIcon } from "@heroicons/react/24/solid";
import { Button, Modal, SearchField, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "../hooks/use-api";
import { cn } from "../lib/utils";
import {
	installPluginMutationOptions,
	pluginMarketQueryOptions,
	updateMarketplaceMutationOptions,
} from "../requests/plugins";
import { CategoryFilter } from "./plugin-market/category-filter";
import { PluginMarketTable } from "./plugin-market/market-table";
import { TooltipIconButton } from "./ui/tooltip-icon-button";

interface PluginMarketDialogProps {
	isOpen: boolean;
	onClose: () => void;
	installScope?: "user" | "project" | "local";
}

export function PluginMarketDialog({
	isOpen,
	onClose,
	installScope = "user",
}: PluginMarketDialogProps) {
	const { t, i18n } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedCategory, setSelectedCategory] = useState<string | null>(
		null,
	);

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

	const installMutation = useMutation({
		...installPluginMutationOptions({
			api,
			queryClient,
			onSuccess: async (_data, variables) => {
				toast.success(
					t("pluginInstalled", {
						id: variables.plugin_id,
					}),
				);
			},
		}),
		onError: (error) => {
			const message =
				error instanceof Error ? error.message : t("unknownError");
			toast.danger(message);
		},
	});

	const updateMarketplaceMutation = useMutation({
		...updateMarketplaceMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("marketplaceUpdated"));
			},
		}),
		onError: (error) => {
			const message =
				error instanceof Error ? error.message : t("unknownError");
			toast.danger(t("marketplaceUpdateFailed"), {
				description: message,
			});
		},
	});

	const getCategoryLabel = (category: string) =>
		t(`pluginCategories.${category.toLowerCase()}`, {
			defaultValue:
				category.charAt(0).toUpperCase() +
				category.slice(1).toLowerCase(),
		});

	const handleInstall = (pluginId: string) => {
		installMutation.mutate({ plugin_id: pluginId, scope: installScope });
	};

	const handleUpdateMarketplace = () => {
		updateMarketplaceMutation.mutate();
	};

	const installedPluginsCount = useMemo(() => {
		return plugins.filter((plugin) =>
			plugin.installed_scopes?.includes(installScope),
		).length;
	}, [plugins, installScope]);

	const marketPlugins = useMemo(() => {
		return plugins.filter(
			(plugin) => !plugin.installed_scopes?.includes(installScope),
		);
	}, [plugins, installScope]);

	// Get unique categories
	const categories = useMemo(() => {
		const cats = new Set<string>();
		for (const plugin of marketPlugins) {
			if (plugin.category) cats.add(plugin.category);
		}
		return Array.from(cats).sort();
	}, [marketPlugins]);

	// Filter and sort plugins
	const filteredPlugins = useMemo(() => {
		let filtered = marketPlugins;

		// Apply search filter
		if (searchQuery) {
			const query = searchQuery.toLowerCase();
			filtered = filtered.filter(
				(p) =>
					p.name.toLowerCase().includes(query) ||
					(p.description &&
						p.description.toLowerCase().includes(query)),
			);
		}

		// Apply category filter
		if (selectedCategory) {
			filtered = filtered.filter(
				(p) => (p.category || "other") === selectedCategory,
			);
		}

		// Sort by install count (descending)
		return [...filtered].sort((a, b) => b.installs - a.installs);
	}, [marketPlugins, searchQuery, selectedCategory]);

	const handleClose = () => {
		setSearchQuery("");
		setSelectedCategory(null);
		onClose();
	};

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={handleClose}>
			<Modal.Container>
				<Modal.Dialog className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-4xl bg-surface-secondary">
					<Modal.CloseTrigger />
					<Modal.Header className="items-start">
						<div className="space-y-1">
							<Modal.Heading>{t("pluginMarket")}</Modal.Heading>
							<p className="text-sm text-muted">
								{t("pluginMarketDescription")}
							</p>
						</div>
					</Modal.Header>

					<Modal.Body className="flex min-h-0 flex-col space-y-4 p-4 overflow-hidden">
						{/* Search and filter bar */}
						<div className="flex shrink-0 items-center gap-3">
							<SearchField
								className="flex-1"
								value={searchQuery}
								onChange={setSearchQuery}
								aria-label={t("searchPlugins")}
							>
								<SearchField.Group>
									<SearchField.SearchIcon />
									<SearchField.Input
										placeholder={t("searchPlugins")}
									/>
									<SearchField.ClearButton />
								</SearchField.Group>
							</SearchField>
							<TooltipIconButton
								variant="ghost"
								size="sm"
								onPress={handleUpdateMarketplace}
								isDisabled={updateMarketplaceMutation.isPending}
								label={t("updateMarketplace")}
								className="size-9 shrink-0 text-accent"
							>
								<ArrowPathIcon
									className={cn(
										"size-4",
										updateMarketplaceMutation.isPending &&
											"animate-spin",
									)}
								/>
							</TooltipIconButton>
						</div>

						<CategoryFilter
							categories={categories}
							selectedCategory={selectedCategory}
							onSelect={setSelectedCategory}
							getCategoryLabel={getCategoryLabel}
							allLabel={t("all")}
						/>

						<PluginMarketTable
							plugins={filteredPlugins}
							isLoading={isLoading}
							isError={isError}
							error={error}
							searchQuery={searchQuery}
							compactFormatter={compactFormatter}
							getCategoryLabel={getCategoryLabel}
							onRetry={refetch}
							onInstall={handleInstall}
							installingPluginId={
								installMutation.variables?.plugin_id ?? null
							}
						/>
					</Modal.Body>

					<Modal.Footer>
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
						<Button variant="secondary" onPress={handleClose}>
							{t("menu.close")}
						</Button>
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
