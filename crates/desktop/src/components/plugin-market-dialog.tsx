"use client";

import {
	ArrowPathIcon,
	ExclamationCircleIcon,
	MagnifyingGlassIcon,
} from "@heroicons/react/24/solid";
import {
	Button,
	Chip,
	Modal,
	SearchField,
	Spinner,
	Table,
	Tooltip,
	toast,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "../hooks/use-api";
import { cn } from "../lib/utils";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";

const SEMANTIC_VERSION_REGEX = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;

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

	const formatPluginVersion = (version: string) => {
		if (!version) {
			return t("unknown");
		}

		if (version === "latest") {
			return t("latest");
		}

		if (version.startsWith("v")) {
			return version;
		}

		if (SEMANTIC_VERSION_REGEX.test(version)) {
			return `v${version}`;
		}

		return version;
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
							<Tooltip delay={0}>
								<Button
									isIconOnly
									variant="ghost"
									size="sm"
									onPress={() =>
										updateMarketplaceMutation.mutate()
									}
									isDisabled={
										updateMarketplaceMutation.isPending
									}
									aria-label={t("updateMarketplace")}
									className="size-9 shrink-0 text-accent"
								>
									<ArrowPathIcon
										className={cn(
											"size-4",
											updateMarketplaceMutation.isPending &&
												"animate-spin",
										)}
									/>
								</Button>
								<Tooltip.Content>
									{t("updateMarketplace")}
								</Tooltip.Content>
							</Tooltip>
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
												? "bg-accent/10 text-accent"
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
													? "bg-accent/10 text-accent"
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
								<div className="min-h-0 flex-1 overflow-hidden">
									<Table className="h-full">
										<Table.ScrollContainer className="h-full [scrollbar-gutter:stable]">
											<Table.Content
												aria-label={t("pluginMarket")}
												className={cn(
													"table-fixed border-separate border-spacing-0",
													"[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-surface",
													"[&_thead_th]:h-11 [&_thead_th]:border-b [&_thead_th]:border-separator/70 [&_thead_th]:bg-surface-secondary/70 [&_thead_th]:px-4 [&_thead_th]:text-[11px] [&_thead_th]:font-semibold [&_thead_th]:tracking-[0.08em] [&_thead_th]:text-muted",
													"[&_tbody_td]:px-4 [&_tbody_td]:py-3 [&_tbody_td]:align-top",
													"[&_tbody_tr]:border-b [&_tbody_tr]:border-separator/60 [&_tbody_tr]:transition-colors",
													"[&_tbody_tr:hover]:bg-surface-secondary/30",
													"[&_tbody_tr:last-child]:border-b-0",
												)}
											>
												<Table.Header>
													<Table.Column
														isRowHeader
														className="w-[58%]"
													>
														{t("name")}
													</Table.Column>
													<Table.Column className="w-[120px] text-right">
														{t("installs")}
													</Table.Column>
													<Table.Column className="w-[180px]">
														{t("author")}
													</Table.Column>
													<Table.Column className="w-[140px] text-right">
														{t("installation")}
													</Table.Column>
												</Table.Header>
												<Table.Body
													items={filteredPlugins}
												>
													{(plugin) => (
														<Table.Row
															id={plugin.id}
															className="align-top"
														>
															<Table.Cell className="align-top">
																<div className="min-w-0 space-y-2 py-1.5">
																	<div className="flex min-w-0 items-center gap-2">
																		<span className="truncate text-base font-semibold text-foreground">
																			{
																				plugin.name
																			}
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
																		<p className="line-clamp-2 text-sm leading-6 text-muted">
																			{
																				plugin.description
																			}
																		</p>
																	)}
																</div>
															</Table.Cell>
															<Table.Cell className="align-top">
																<div className="flex justify-end py-1.5">
																	<span className="text-sm tabular-nums text-muted">
																		{plugin.installs >
																		0
																			? compactFormatter.format(
																					plugin.installs,
																				)
																			: "—"}
																	</span>
																</div>
															</Table.Cell>
															<Table.Cell className="align-top">
																<div className="flex flex-col gap-1 py-1.5">
																	<span
																		className={cn(
																			"truncate text-sm font-medium",
																			plugin.author
																				? "text-foreground"
																				: "text-muted",
																		)}
																	>
																		{plugin.author ||
																			t(
																				"unknown",
																			)}
																	</span>
																	<span className="text-xs text-muted">
																		{formatPluginVersion(
																			plugin.version,
																		)}
																	</span>
																</div>
															</Table.Cell>
															<Table.Cell className="align-top">
																<div className="flex justify-end py-1">
																	<Button
																		size="sm"
																		variant="tertiary"
																		className="min-w-[104px]"
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
																		{t(
																			"install",
																		)}
																	</Button>
																</div>
															</Table.Cell>
														</Table.Row>
													)}
												</Table.Body>
											</Table.Content>
										</Table.ScrollContainer>
									</Table>
								</div>
							)}
						</div>
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
