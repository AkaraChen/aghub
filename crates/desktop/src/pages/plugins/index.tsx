"use client";

import {
	ArrowPathIcon,
	CheckCircleIcon,
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
import type { PluginResponse } from "../../generated/dto";
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
	const [selectedPlugin, setSelectedPlugin] = useState<PluginResponse | null>(
		plugins[0] ?? null,
	);
	const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
		() => new Set(),
	);
	const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);

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
		if (selectedKeys.size > 0) return selectedKeys;
		if (selectedPlugin && !isMultiSelectMode) {
			return new Set([selectedPlugin.id]);
		}
		return new Set<string>();
	}, [selectedKeys, selectedPlugin, isMultiSelectMode]);

	const handleSelectionChange = (keys: Set<string>, clickedKey?: string) => {
		setSelectedKeys(keys);

		if (clickedKey && !isMultiSelectMode) {
			const plugin = plugins.find((p) => p.id === clickedKey);
			if (plugin) {
				setSelectedPlugin(plugin);
			}
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

				{/* Plugin List */}
				<PluginList
					plugins={filteredPlugins}
					selectedKeys={effectiveSelectedKeys}
					searchQuery={searchQuery}
					onSelectionChange={handleSelectionChange}
					selectionMode="multiple"
					isMultiSelectMode={isMultiSelectMode}
				/>

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
						plugin={selectedPlugin}
						selectedCount={
							isMultiSelectMode ? selectedKeys.size : 0
						}
						selectedPlugins={selectedPlugins}
					/>
				) : (
					<div className="flex h-full flex-col items-center justify-center gap-4">
						<div className="text-center">
							<PuzzlePieceIcon className="mx-auto size-12 text-muted/30 mb-3" />
							<p className="mb-2 text-sm text-muted">
								{t("selectPlugin")}
							</p>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
