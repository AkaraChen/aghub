"use client";

import {
	BoltIcon,
	CpuChipIcon,
	PuzzlePieceIcon,
	WrenchIcon,
} from "@heroicons/react/24/solid";
import { Label, ListBox, Tooltip } from "@heroui/react";
import Fuse from "fuse.js";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { PluginResponse } from "../generated/dto";

interface PluginListProps {
	plugins: PluginResponse[];
	selectedKeys: Set<string>;
	searchQuery: string;
	onSelectionChange: (keys: Set<string>, clickedKey?: string) => void;
	emptyMessage?: string;
	selectionMode?: "none" | "single" | "multiple";
	isMultiSelectMode?: boolean;
}

function PluginCapabilityIcons({ plugin }: { plugin: PluginResponse }) {
	const icons = [];
	if (plugin.has_skills) {
		icons.push(
			<Tooltip key="skills" delay={0}>
				<div className="flex items-center justify-center rounded-full bg-surface-secondary p-1">
					<WrenchIcon className="size-3 text-muted" />
				</div>
				<Tooltip.Content>Skills</Tooltip.Content>
			</Tooltip>,
		);
	}
	if (plugin.has_hooks) {
		icons.push(
			<Tooltip key="hooks" delay={0}>
				<div className="flex items-center justify-center rounded-full bg-surface-secondary p-1">
					<BoltIcon className="size-3 text-muted" />
				</div>
				<Tooltip.Content>Hooks</Tooltip.Content>
			</Tooltip>,
		);
	}
	if (plugin.has_mcp) {
		icons.push(
			<Tooltip key="mcp" delay={0}>
				<div className="flex items-center justify-center rounded-full bg-surface-secondary p-1">
					<CpuChipIcon className="size-3 text-muted" />
				</div>
				<Tooltip.Content>MCP</Tooltip.Content>
			</Tooltip>,
		);
	}
	return <div className="flex items-center gap-1">{icons}</div>;
}

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
				className={`size-2 rounded-full ${enabled ? "bg-success" : "bg-muted"}`}
				title={enabled ? t("enabled") : t("disabled")}
			/>
		);
	};

	if (filteredPlugins.length === 0) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 p-6">
				<PuzzlePieceIcon className="size-12 text-muted/30" />
				<p className="text-sm text-muted">
					{emptyMessage ?? t("noPluginsInstalled")}
				</p>
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
						className="data-selected:bg-surface"
					>
						<div className="flex w-full items-center gap-2">
							{getStatusIndicator(plugin.enabled)}
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
							<PluginCapabilityIcons plugin={plugin} />
						</div>
					</ListBox.Item>
				))}
			</ListBox>
		</div>
	);
}
