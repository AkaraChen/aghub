"use client";

import {
	ArrowPathIcon,
	CheckCircleIcon,
	PlusIcon,
	RectangleStackIcon,
} from "@heroicons/react/24/solid";
import { Button, Label, ListBox, Tooltip } from "@heroui/react";
import Fuse from "fuse.js";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { CCPluginResponse } from "../generated/dto";
import { cn } from "../lib/utils";
import { useMultiSelect } from "../hooks/use-multi-select";
import { ListSearchHeader } from "./list-search-header";
import { MultiSelectFloatingBar } from "./multi-select-floating-bar";

interface PluginListProps {
	plugins: CCPluginResponse[];
	selectedKeys: Set<string>;
	searchQuery: string;
	onSearchChange: (value: string) => void;
	onSelectionChange: (keys: Set<string>, clickedKey?: string) => void;
	onOpenMarket: () => void;
	onToggleMultiSelect: () => void;
	onRefresh: () => void;
	onDeleteSelection: () => void;
	selectedCount: number;
	totalCount: number;
	isRefreshing?: boolean;
	isMultiSelectMode?: boolean;
}

export function PluginList({
	plugins,
	selectedKeys,
	searchQuery,
	onSearchChange,
	onSelectionChange,
	onOpenMarket,
	onToggleMultiSelect,
	onRefresh,
	onDeleteSelection,
	selectedCount,
	totalCount,
	isRefreshing = false,
	isMultiSelectMode = false,
}: PluginListProps) {
	const { t } = useTranslation();

	const fuse = useMemo(
		() =>
			new Fuse(plugins, {
				keys: [
					{ name: "name", weight: 2 },
					{ name: "id", weight: 1 },
					{ name: "description", weight: 0.5 },
				],
				threshold: 0.4,
				includeScore: true,
			}),
		[plugins],
	);

	const filteredPlugins = useMemo(() => {
		if (!searchQuery) return plugins;
		return fuse.search(searchQuery).map((result) => result.item);
	}, [fuse, plugins, searchQuery]);

	const { createSelectionHandler } = useMultiSelect({
		selectedKeys,
		onSelectionChange,
		isMultiSelectMode,
	});
	const handleSelectionChange = createSelectionHandler(
		filteredPlugins.map((plugin) => plugin.id),
	);

	return (
		<div className="relative flex h-full flex-col">
			<ListSearchHeader
				searchValue={searchQuery}
				onSearchChange={onSearchChange}
				placeholder={t("searchPlugins")}
				ariaLabel={t("searchPlugins")}
			>
				<Tooltip delay={0}>
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						className="shrink-0"
						onPress={onOpenMarket}
						aria-label={t("installFromMarket")}
					>
						<PlusIcon className="size-4" />
					</Button>
					<Tooltip.Content>{t("installFromMarket")}</Tooltip.Content>
				</Tooltip>
				<Tooltip delay={0}>
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						className={cn(
							"shrink-0 text-muted",
							isMultiSelectMode && "bg-accent/10 text-accent",
						)}
						aria-label={
							isMultiSelectMode
								? t("doneSelecting")
								: t("multiSelect")
						}
						onPress={onToggleMultiSelect}
					>
						{isMultiSelectMode ? (
							<CheckCircleIcon className="size-4" />
						) : (
							<RectangleStackIcon className="size-4" />
						)}
					</Button>
					<Tooltip.Content>
						{isMultiSelectMode
							? t("doneSelecting")
							: t("multiSelect")}
					</Tooltip.Content>
				</Tooltip>
				<Tooltip delay={0}>
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						className="shrink-0"
						aria-label={t("refreshPlugins")}
						onPress={onRefresh}
						isDisabled={isRefreshing}
					>
						<ArrowPathIcon
							className={cn(
								"size-4",
								isRefreshing && "animate-spin",
							)}
						/>
					</Button>
					<Tooltip.Content>{t("refreshPlugins")}</Tooltip.Content>
				</Tooltip>
			</ListSearchHeader>
			{filteredPlugins.length === 0 ? (
				<div className="px-3 py-6 text-center">
					<p className="text-sm text-muted">
						{searchQuery
							? t("noPluginsMatch")
							: t("noPluginsInstalled")}
					</p>
					{searchQuery && (
						<p className="mt-1 text-xs text-muted">
							"{searchQuery}"
						</p>
					)}
				</div>
			) : (
				<div className="flex-1 overflow-y-auto">
					<ListBox
						aria-label="Claude Code Plugins"
						selectionMode="multiple"
						selectionBehavior="toggle"
						selectedKeys={selectedKeys}
						onSelectionChange={handleSelectionChange}
						className="p-2"
					>
						{filteredPlugins.map((plugin) => (
							<ListBox.Item
								key={plugin.id}
								id={plugin.id}
								textValue={plugin.name}
								className="transition-colors duration-200 data-selected:bg-surface"
							>
								<div className="flex w-full items-center gap-2">
									<div className="flex min-w-0 flex-1 flex-col">
										<Label className="truncate font-medium">
											{plugin.name}
										</Label>
									</div>
									<div className="shrink-0 pl-1">
										<div
											className={cn(
												"size-2.5 rounded-full transition-colors duration-300",
												plugin.enabled
													? "bg-success"
													: "bg-muted shadow-inner",
											)}
											title={
												plugin.enabled
													? t("enabled")
													: t("disabled")
											}
										/>
									</div>
								</div>
							</ListBox.Item>
						))}
					</ListBox>
				</div>
			)}

			{isMultiSelectMode && selectedCount > 0 && (
				<MultiSelectFloatingBar
					selectedCount={selectedCount}
					totalCount={totalCount}
					onDelete={onDeleteSelection}
				/>
			)}
		</div>
	);
}
