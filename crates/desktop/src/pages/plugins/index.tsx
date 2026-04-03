"use client";

import {
	ArrowPathIcon,
	CheckCircleIcon,
	PlusIcon,
	PuzzlePieceIcon,
	RectangleStackIcon,
} from "@heroicons/react/24/solid";
import { Button, Tooltip } from "@heroui/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListSearchHeader } from "../../components/list-search-header";
import { MultiSelectFloatingBar } from "../../components/multi-select-floating-bar";
import { PluginDetail } from "../../components/plugin-detail";
import { PluginList } from "../../components/plugin-list";
import { PluginMarketDialog } from "../../components/plugin-market-dialog";
import { ResourceSectionHeader } from "../../components/resource-section-header";

import { useApi } from "../../hooks/use-api";
import { cn } from "../../lib/utils";

export default function PluginsPage() {
	const { t } = useTranslation();
	const api = useApi();
	const { data, refetch, isFetching } = useSuspenseQuery({
		queryKey: ["plugins"],
		queryFn: () => api.plugins.list(),
	});

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

	const selectedPlugin = useMemo(() => {
		return plugins.find((p) => p.id === selectedPluginId) ?? null;
	}, [plugins, selectedPluginId]);

	const filteredPlugins = useMemo(() => {
		if (!searchQuery) return plugins;
		const query = searchQuery.toLowerCase();
		return plugins.filter(
			(p) =>
				p.name.toLowerCase().includes(query) ||
				p.id.toLowerCase().includes(query),
		);
	}, [plugins, searchQuery]);

	const effectiveSelectedKeys = useMemo(() => {
		if (selectedKeys.size > 0 && isMultiSelectMode) return selectedKeys;
		if (selectedPluginId) {
			return new Set([selectedPluginId]);
		}
		return new Set<string>();
	}, [selectedKeys, selectedPluginId, isMultiSelectMode]);

	const handleSelectionChange = (keys: Set<string>, clickedKey?: string) => {
		setSelectedKeys(keys);

		let nextSelectedId = selectedPluginId;

		if (clickedKey) {
			nextSelectedId = clickedKey;
		} else if (keys.size === 1) {
			nextSelectedId = [...keys][0];
		} else if (keys.size === 0 && !isMultiSelectMode) {
			nextSelectedId = null;
		}

		if (nextSelectedId !== selectedPluginId) {
			setSelectedPluginId(nextSelectedId);
		}

		if (keys.size > 1 && !isMultiSelectMode) {
			setIsMultiSelectMode(true);
		}
		if (keys.size === 0 && isMultiSelectMode) {
			setIsMultiSelectMode(false);
		}
	};

	const selectedPlugins = useMemo(() => {
		return plugins.filter((p) => selectedKeys.has(p.id));
	}, [selectedKeys, plugins]);

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
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						className="shrink-0"
						aria-label={t("refresh")}
						onPress={() => refetch()}
					>
						<ArrowPathIcon
							className={cn(
								"size-4",
								isFetching && "animate-spin",
							)}
						/>
					</Button>
				</ListSearchHeader>

				<div className="flex-1 overflow-y-auto">
					<ResourceSectionHeader
						title={t("plugins")}
						count={0}
						icon={<PuzzlePieceIcon className="size-3.5" />}
					/>
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
						onDelete={() => {}}
					/>
				)}
			</div>

			{/* Plugin Detail Panel */}
			<div className="flex-1 overflow-hidden">
				{selectedPlugin ? (
					<PluginDetail
						key={selectedPlugin.id}
						plugin={selectedPlugin}
						selectedCount={
							isMultiSelectMode ? selectedKeys.size : 0
						}
						selectedPlugins={selectedPlugins}
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
			/>
		</div>
	);
}
