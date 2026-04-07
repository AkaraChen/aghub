"use client";

import {
	ArrowPathIcon,
	CheckIcon,
	ExclamationCircleIcon,
	MagnifyingGlassIcon,
	StarIcon,
} from "@heroicons/react/24/solid";
import {
	Button,
	Chip,
	Modal,
	SearchField,
	Spinner,
	toast,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "../hooks/use-api";
import { cn } from "../lib/utils";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";

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
	} = useQuery({
		queryKey: ["plugins-market"],
		queryFn: () => api.plugins.listMarket(),
		enabled: isOpen,
	});

	const installMutation = useMutation({
		mutationFn: (pluginId: string) =>
			api.plugins.install({ plugin_id: pluginId, scope: installScope }),
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

	const installedPluginsCount = useMemo(() => {
		return plugins.filter((plugin) => plugin.installed).length;
	}, [plugins]);

	const activeFilterKey = `${selectedCategory ?? "all"}:${searchQuery}`;

	const handleClose = () => {
		setSearchQuery("");
		setSelectedCategory(null);
		onClose();
	};

	const formatPluginVersion = (version: string) => {
		if (!version) {
			return t("unknown");
		}

		if (version === "latest" || version.startsWith("v")) {
			return version;
		}

		return `v${version}`;
	};

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={handleClose}>
			<Modal.Container>
				<Modal.Dialog className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-4xl">
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
							<Button
								variant="secondary"
								size="sm"
								onPress={() =>
									updateMarketplaceMutation.mutate()
								}
								isPending={updateMarketplaceMutation.isPending}
								aria-label={t("updateMarketplace")}
								className="shrink-0 gap-1.5"
							>
								<ArrowPathIcon
									className={cn(
										"size-4",
										updateMarketplaceMutation.isPending &&
											"animate-spin",
									)}
								/>
								<span className="text-xs">
									{t("updateMarketplace")}
								</span>
							</Button>
						</div>

						{/* Category filter chips */}
						{categories.length > 0 && (
							<div className="shrink-0 overflow-x-auto pb-1">
								<div className="flex min-w-max gap-1.5">
									<button
										type="button"
										onClick={() =>
											setSelectedCategory(null)
										}
										className={cn(
											"shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium tracking-wide transition-colors cursor-pointer",
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
											onClick={() =>
												setSelectedCategory(cat)
											}
											className={cn(
												"shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium tracking-wide transition-colors cursor-pointer",
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
														cat
															.slice(1)
															.toLowerCase(),
												},
											)}
										</button>
									))}
								</div>
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
								<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
									<div className="grid shrink-0 grid-cols-[minmax(0,1.9fr)_120px_160px_120px] gap-4 border-b border-separator px-4 py-3 text-[11px] font-medium tracking-wide text-muted uppercase">
										<span>{t("name")}</span>
										<span>{t("installs")}</span>
										<span>{t("author")}</span>
										<span className="text-right">
											{t("installation")}
										</span>
									</div>
									<div
										key={activeFilterKey}
										className="min-h-0 flex-1 overflow-y-auto"
									>
										{filteredPlugins.map((plugin) => (
											<div
												key={plugin.id}
												className="grid grid-cols-[minmax(0,1.9fr)_120px_160px_120px] gap-4 border-b border-separator px-4 py-4 transition-colors hover:bg-surface-secondary"
											>
												<div className="min-w-0 space-y-2">
													<div className="flex min-w-0 items-center gap-2">
														<span className="truncate text-base font-semibold text-foreground">
															{plugin.name}
														</span>
														<div className="flex shrink-0 items-center gap-1.5">
															{plugin.category && (
																<Chip
																	size="sm"
																	variant="secondary"
																	className="h-6 px-2 text-[10px] font-semibold uppercase"
																>
																	{t(
																		`pluginCategories.${plugin.category.toLowerCase()}`,
																		{
																			defaultValue:
																				plugin.category,
																		},
																	)}
																</Chip>
															)}
															{plugin.has_mcp && (
																<Chip
																	size="sm"
																	variant="secondary"
																	className="h-6 px-2 text-[10px] font-semibold text-blue-400"
																>
																	MCP
																</Chip>
															)}
															{plugin.has_skills && (
																<Chip
																	size="sm"
																	variant="secondary"
																	className="h-6 px-2 text-[10px] font-semibold text-violet-400"
																>
																	SKILL
																</Chip>
															)}
														</div>
													</div>
													{plugin.description && (
														<p className="line-clamp-1 text-sm text-muted">
															{plugin.description}
														</p>
													)}
												</div>

												<div className="flex items-center">
													{plugin.installs > 0 ? (
														<div className="flex items-center gap-1.5 text-sm text-muted">
															<StarIcon className="size-4 text-warning" />
															<span>
																{compactFormatter.format(
																	plugin.installs,
																)}
															</span>
														</div>
													) : (
														<span className="text-sm text-muted">
															—
														</span>
													)}
												</div>

												<div className="flex flex-col justify-center gap-1">
													<span className="truncate text-sm font-medium text-foreground">
														{plugin.author ||
															t("unknown")}
													</span>
													<span className="text-xs text-muted">
														{formatPluginVersion(
															plugin.version,
														)}
													</span>
												</div>

												<div className="flex items-center justify-end">
													{plugin.installed_scopes?.includes(
														installScope,
													) ? (
														<div className="flex min-w-[96px] items-center justify-center gap-1.5 rounded-full bg-success/10 px-3 py-2 text-sm font-medium text-success">
															<CheckIcon className="size-4" />
															<span>
																{t("installed")}
															</span>
														</div>
													) : (
														<Button
															size="sm"
															variant="tertiary"
															className="min-w-[96px]"
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
												</div>
											</div>
										))}
									</div>
								</div>
							)}
						</div>
					</Modal.Body>

					<Modal.Footer>
						<div className="flex items-center gap-2 text-xs text-muted">
							<span>
								{filteredPlugins.length === plugins.length
									? t("availablePluginsCount", {
											count: plugins.length,
										})
									: t("showingPluginsCount", {
											filtered: filteredPlugins.length,
											total: plugins.length,
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
