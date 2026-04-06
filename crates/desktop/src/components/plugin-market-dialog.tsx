"use client";

import {
	ArrowPathIcon,
	CheckIcon,
	ExclamationCircleIcon,
	StarIcon,
	MagnifyingGlassIcon,
} from "@heroicons/react/24/solid";
import { Button, SearchField, Modal, Spinner, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TableComponents } from "react-virtuoso";
import { TableVirtuoso } from "react-virtuoso";
import type { MarketPluginResponse } from "../generated/dto";
import { useApi } from "../hooks/use-api";
import { cn } from "../lib/utils";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";

const ROW_HEIGHT = 56;

interface PluginMarketDialogProps {
	isOpen: boolean;
	onClose: () => void;
}

const tableComponents: TableComponents<MarketPluginResponse> = {
	Table: ({ style, ...props }) => (
		<table
			className="w-full table-fixed caption-bottom text-sm"
			style={style}
			{...props}
		/>
	),
	TableBody: (props) => <tbody {...props} />,
	TableRow: ({ style, ...props }) => (
		<tr
			className="border-b border-border transition-colors hover:bg-surface-secondary"
			style={{ height: ROW_HEIGHT, ...style }}
			{...props}
		/>
	),
};

export function PluginMarketDialog({
	isOpen,
	onClose,
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
		isFetching,
		refetch,
		isError,
		error,
	} = useQuery({
		queryKey: ["plugins-market"],
		queryFn: () => api.plugins.listMarket(),
		enabled: isOpen,
	});

	const installMutation = useMutation({
		mutationFn: (pluginId: string) =>
			api.plugins.install({ plugin_id: pluginId, scope: "user" }),
		onSuccess: (_, pluginId) => {
			toast.success(t("pluginInstalled", { id: pluginId }));
			queryClient.invalidateQueries({ queryKey: ["plugins"] });
			queryClient.invalidateQueries({ queryKey: ["plugins-market"] });
		},
		onError: (err) => {
			const message =
				err instanceof Error ? err.message : t("unknownError");
			toast.danger(message);
		},
	});

	const updateMarketplaceMutation = useMutation({
		mutationFn: () => api.plugins.updateMarketplace(),
		onSuccess: () => {
			toast.success(t("marketplaceUpdated"));
			queryClient.invalidateQueries({ queryKey: ["plugins-market"] });
		},
		onError: (err) => {
			const message =
				err instanceof Error ? err.message : t("unknownError");
			toast.danger(t("marketplaceUpdateFailed"), {
				description: message,
			});
		},
	});
	// Get unique categories
	const categories = useMemo(() => {
		const cats = new Set<string>();
		for (const plugin of plugins) {
			if (plugin.category) cats.add(plugin.category);
		}
		return Array.from(cats).sort();
	}, [plugins]);

	// Filter and sort plugins
	const filteredPlugins = useMemo(() => {
		let filtered = plugins;

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
	}, [plugins, searchQuery, selectedCategory]);

	const handleClose = () => {
		setSearchQuery("");
		setSelectedCategory(null);
		onClose();
	};

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={handleClose}>
			<Modal.Container>
				<Modal.Dialog className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-4xl">
					<Modal.CloseTrigger />
					<Modal.Header>
						<Modal.Heading>{t("pluginMarket")}</Modal.Heading>
					</Modal.Header>

					<Modal.Body className="flex min-h-0 flex-col space-y-4 p-4 overflow-hidden">
						{/* Search and filter bar */}
						<div className="flex shrink-0 gap-2">
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
							<Button
								isIconOnly
								variant="ghost"
								onPress={() => refetch()}
								isDisabled={isFetching}
								aria-label={t("refresh")}
							>
								<ArrowPathIcon
									className={cn(
										"size-4",
										isFetching && "animate-spin",
									)}
								/>
							</Button>
							<Button
								isIconOnly
								variant="ghost"
								onPress={() =>
									updateMarketplaceMutation.mutate()
								}
								isPending={updateMarketplaceMutation.isPending}
								aria-label={t("updateMarketplace")}
							>
								<ArrowPathIcon
									className={cn(
										"size-4",
										updateMarketplaceMutation.isPending &&
											"animate-spin",
									)}
								/>
							</Button>
						</div>

						{/* Category filter chips */}
						{categories.length > 0 && (
							<div className="flex shrink-0 flex-wrap gap-1.5">
								<button
									type="button"
									onClick={() => setSelectedCategory(null)}
									className={cn(
										"px-2.5 py-1 text-[11px] tracking-wider font-medium rounded-full transition-colors cursor-pointer",
										selectedCategory === null
											? "bg-success text-success-foreground"
											: "bg-surface-secondary hover:bg-surface-tertiary text-muted hover:text-foreground",
									)}
								>
									{t("all")}
								</button>
								{categories.map((cat) => (
									<button
										key={cat}
										type="button"
										onClick={() => setSelectedCategory(cat)}
										className={cn(
											"px-2.5 py-1 text-[11px] tracking-wider font-medium rounded-full transition-colors cursor-pointer",
											selectedCategory === cat
												? "bg-success text-success-foreground"
												: "bg-surface-secondary hover:bg-surface-tertiary text-muted hover:text-foreground",
										)}
									>
										{t(
											`pluginCategories.${cat.toLowerCase()}`,
											{
												defaultValue:
													cat
														.charAt(0)
														.toUpperCase() +
													cat.slice(1).toLowerCase(),
											},
										)}
									</button>
								))}
							</div>
						)}

						{/* Plugin list */}
						<div className="flex min-h-[50vh] flex-1 flex-col overflow-hidden rounded-lg border border-separator bg-surface">
							{isLoading ? (
								<div className="flex flex-1 items-center justify-center">
									<Spinner size="lg" />
								</div>
							) : isError ? (
								<div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
									<ExclamationCircleIcon className="mb-2 size-8 text-danger" />
									<p className="text-sm text-muted">
										{error instanceof Error
											? error.message
											: t("unknownError")}
									</p>
									<Button
										variant="ghost"
										size="sm"
										onPress={() => refetch()}
										className="mt-4"
									>
										{t("retry")}
									</Button>
								</div>
							) : filteredPlugins.length === 0 ? (
								<div className="flex flex-1 items-center justify-center">
									<Empty className="border-0">
										<EmptyHeader>
											<EmptyMedia>
												<MagnifyingGlassIcon className="size-8 text-muted" />
											</EmptyMedia>
											<EmptyTitle className="text-sm font-normal text-muted">
												{searchQuery
													? t("noPluginsFound")
													: t("noPluginsAvailable")}
											</EmptyTitle>
										</EmptyHeader>
									</Empty>
								</div>
							) : (
								<div className="flex-1 min-h-0 h-full">
									<TableVirtuoso
										data={filteredPlugins}
										fixedItemHeight={ROW_HEIGHT}
										style={{ height: "100%" }}
										components={tableComponents}
										itemContent={(_index, plugin) => (
											<>
												<td className="w-1/2 max-w-0 p-3 align-middle">
													<div className="flex flex-col gap-1">
														<div className="flex flex-wrap items-center gap-2">
															<span className="truncate font-medium text-foreground">
																{plugin.name}
															</span>
															<div className="flex items-center gap-1.5">
																{plugin.category && (
																	<span className="rounded-sm bg-surface-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted">
																		{t(
																			`pluginCategories.${plugin.category.toLowerCase()}`,
																			{
																				defaultValue:
																					plugin.category,
																			},
																		)}
																	</span>
																)}
																{plugin.has_mcp && (
																	<span className="rounded-sm bg-blue-500/10 dark:bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-400">
																		MCP
																	</span>
																)}
																{plugin.has_skills && (
																	<span className="rounded-sm bg-purple-500/10 dark:bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-purple-600 dark:text-purple-400">
																		SKILL
																	</span>
																)}
															</div>
														</div>
														<p className="truncate text-sm text-muted">
															{plugin.description ||
																t(
																	"noDescription",
																)}
														</p>
													</div>
												</td>
												<td className="w-1/6 p-3 align-middle">
													{plugin.installs > 0 ? (
														<div className="flex items-center gap-1 text-xs text-muted">
															<StarIcon className="size-3 text-warning" />
															<span>
																{compactFormatter.format(
																	plugin.installs,
																)}
															</span>
														</div>
													) : (
														<span className="text-xs text-muted">
															-
														</span>
													)}
												</td>
												<td className="w-1/6 p-3 align-middle">
													<div className="flex flex-col gap-0.5">
														<span className="truncate text-xs text-foreground">
															{plugin.author ||
																"-"}
														</span>
														<span className="text-[10px] text-muted">
															v{plugin.version}
														</span>
													</div>
												</td>
												<td className="w-[100px] p-3 text-right align-middle">
													{plugin.installed ? (
														<div className="flex min-w-[70px] items-center justify-end gap-1.5">
															<CheckIcon className="size-4 text-success" />
															<span className="text-sm font-medium text-success">
																{t("installed")}
															</span>
														</div>
													) : (
														<Button
															size="sm"
															variant="tertiary"
															className="min-w-[70px]"
															onPress={() =>
																installMutation.mutate(
																	plugin.id,
																)
															}
															isPending={
																installMutation.isPending &&
																installMutation.variables ===
																	plugin.id
															}
														>
															{t("install")}
														</Button>
													)}
												</td>
											</>
										)}
									/>
								</div>
							)}
						</div>
					</Modal.Body>

					<Modal.Footer>
						<div className="flex items-center gap-2 text-xs text-muted">
							<span>
								{filteredPlugins.length === plugins.length
									? t("discoverPlugins", {
											count: plugins.length,
										})
									: t("showingPluginsCount", {
											filtered: filteredPlugins.length,
											total: plugins.length,
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
