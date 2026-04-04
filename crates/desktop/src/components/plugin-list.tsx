"use client";

import { Label, ListBox } from "@heroui/react";
import Fuse from "fuse.js";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { PluginResponse } from "../generated/dto";
import { cn } from "../lib/utils";

interface PluginListProps {
	plugins: PluginResponse[];
	selectedKeys: Set<string>;
	searchQuery: string;
	onSelectionChange: (keys: Set<string>, clickedKey?: string) => void;
	emptyMessage?: string;
	selectionMode?: "none" | "single" | "multiple";
	isMultiSelectMode?: boolean;
}

// No longer rendering capability icons in list

export function PluginList({
	plugins,
	selectedKeys,
	searchQuery,
	onSelectionChange,
	emptyMessage,
	selectionMode = "single",
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

	const modifiersRef = useRef({
		shift: false,
		meta: false,
	});
	const lastClickedRef = useRef<string | null>(null);

	useEffect(() => {
		const handler = (e: PointerEvent) => {
			modifiersRef.current = {
				shift: e.shiftKey,
				meta: e.metaKey || e.ctrlKey,
			};
		};
		window.addEventListener("pointerdown", handler, true);
		return () => window.removeEventListener("pointerdown", handler, true);
	}, []);

	const handleSelectionChange = (keys: "all" | Set<React.Key>) => {
		if (keys === "all") return;
		const newKeys = new Set(Array.from(keys).map(String));
		const added = [...newKeys].find((k) => !selectedKeys.has(k));
		const removed = [...selectedKeys].find((k) => !newKeys.has(k));
		const clicked = added ?? removed;

		if (!clicked) {
			onSelectionChange(newKeys);
			return;
		}

		let finalKeys: Set<string>;

		if (modifiersRef.current.shift && lastClickedRef.current) {
			const allKeys = filteredPlugins.map((p) => p.id);
			const start = allKeys.indexOf(lastClickedRef.current);
			const end = allKeys.indexOf(clicked);
			if (start !== -1 && end !== -1) {
				const [from, to] = [Math.min(start, end), Math.max(start, end)];
				finalKeys = new Set(allKeys.slice(from, to + 1));
			} else {
				finalKeys = new Set([...selectedKeys, clicked]);
			}
		} else if (!isMultiSelectMode && !modifiersRef.current.meta) {
			finalKeys = new Set([clicked]);
		} else {
			finalKeys = new Set(selectedKeys);
			if (finalKeys.has(clicked)) {
				finalKeys.delete(clicked);
			} else {
				finalKeys.add(clicked);
			}
		}

		if (!modifiersRef.current.shift) {
			lastClickedRef.current = clicked;
		}

		onSelectionChange(finalKeys, clicked);
	};

	const getStatusIndicator = (enabled: boolean) => {
		return (
			<div
				className={cn(
					"size-2.5 rounded-full transition-colors duration-300",
					enabled ? "bg-success" : "bg-default-300 shadow-inner",
				)}
				title={enabled ? t("enabled") : t("disabled")}
			/>
		);
	};

	if (filteredPlugins.length === 0) {
		return (
			<div className="px-3 py-6 text-center">
				<p className="text-sm text-muted">
					{emptyMessage ??
						(searchQuery
							? t("noPluginsMatch")
							: t("noPluginsInstalled"))}
				</p>
				{searchQuery && (
					<p className="mt-1 text-xs text-muted">
						&ldquo;{searchQuery}&rdquo;
					</p>
				)}
			</div>
		);
	}

	return (
		<div className="flex-1 overflow-y-auto">
			<ListBox
				aria-label="Claude Code Plugins"
				selectionMode={selectionMode}
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
								<div className="flex items-center gap-2">
									<Label className="truncate font-medium">
										{plugin.name}
									</Label>
									<span className="text-xs text-muted shrink-0">
										v{plugin.version}
									</span>
								</div>
								<span className="truncate text-xs text-muted">
									{plugin.id}
								</span>
							</div>
							<div className="shrink-0 pl-1">
								{getStatusIndicator(plugin.enabled)}
							</div>
						</div>
					</ListBox.Item>
				))}
			</ListBox>
		</div>
	);
}
