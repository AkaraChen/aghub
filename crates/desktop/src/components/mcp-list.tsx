import {
	CommandLineIcon,
	GlobeAltIcon,
	StarIcon as StarIconSolid,
} from "@heroicons/react/24/solid";
import { Label, ListBox, Tooltip } from "@heroui/react";
import Fuse from "fuse.js";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { McpResponse } from "../generated/dto";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useFavorites } from "../hooks/use-favorites";
import { AgentIcon } from "../lib/agent-icons";
import { getMcpMergeKey, sortAgents } from "../lib/utils";

function formatAgentName(agent: string): string {
	return agent.charAt(0).toUpperCase() + agent.slice(1).toLowerCase();
}

function McpAgentIcons({ items }: { items: McpResponse[] }) {
	const { allAgents } = useAgentAvailability();
	const agents = useMemo(() => {
		const set = new Set<string>();
		for (const item of items) {
			if (item.agent) set.add(item.agent);
		}
		return sortAgents(Array.from(set), allAgents);
	}, [items, allAgents]);

	if (agents.length === 0) {
		return null;
	}

	return (
		<div className="flex shrink-0 items-center -space-x-1">
			{agents.slice(0, 3).map((agentId, idx) => (
				<Tooltip key={agentId} delay={0}>
					<div
						className="relative rounded-full bg-surface ring-1 ring-surface transition-transform hover:scale-110"
						style={{ zIndex: 3 - idx }}
					>
						<AgentIcon
							id={agentId}
							name={formatAgentName(agentId)}
							size="xs"
							variant="ghost"
						/>
					</div>
					<Tooltip.Content>
						{formatAgentName(agentId)}
					</Tooltip.Content>
				</Tooltip>
			))}
			{agents.length > 3 && (
				<div className="relative z-0 flex size-5 items-center justify-center rounded-full bg-default text-[10px] font-medium text-muted ring-1 ring-surface">
					+{agents.length - 3}
				</div>
			)}
		</div>
	);
}

interface McpGroup {
	mergeKey: string;
	transport: McpResponse["transport"];
	items: McpResponse[];
}

interface McpListProps {
	mcps: McpResponse[];
	selectedKeys: Set<string>;
	searchQuery: string;
	onSelectionChange: (keys: Set<string>, clickedKey?: string) => void;
	emptyMessage?: string;
	selectionMode?: "none" | "single" | "multiple";
	isMultiSelectMode?: boolean;
}

export function McpList({
	mcps,
	selectedKeys,
	searchQuery,
	onSelectionChange,
	emptyMessage,
	selectionMode = "single",
	isMultiSelectMode = false,
}: McpListProps) {
	const { t } = useTranslation();

	const groupedMcps = useMemo(() => {
		const map = new Map<string, McpResponse[]>();
		for (const mcp of mcps) {
			const key = getMcpMergeKey(mcp.transport);
			const existing = map.get(key) ?? [];
			map.set(key, [...existing, mcp]);
		}
		return Array.from(map.entries()).map(([mergeKey, items]) => ({
			mergeKey,
			transport: items[0].transport,
			items,
		}));
	}, [mcps]);

	const fuse = useMemo(
		() =>
			new Fuse(groupedMcps, {
				keys: [
					{ name: "items.0.name", weight: 2 },
					{ name: "items.0.source", weight: 1 },
					{ name: "items.0.agent", weight: 1 },
				],
				threshold: 0.4,
				includeScore: true,
			}),
		[groupedMcps],
	);

	const filteredGroups = useMemo(() => {
		if (!searchQuery) return groupedMcps;
		return fuse.search(searchQuery).map((result) => result.item);
	}, [fuse, groupedMcps, searchQuery]);

	const { isMcpStarred } = useFavorites();

	const sortedGroups = useMemo(() => {
		const groups = [...filteredGroups];
		return groups.sort((a, b) => {
			const aStarred = isMcpStarred(a.mergeKey);
			const bStarred = isMcpStarred(b.mergeKey);
			if (aStarred && !bStarred) return -1;
			if (!aStarred && bStarred) return 1;
			return 0;
		});
	}, [filteredGroups, isMcpStarred]);

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
			const allKeys = sortedGroups.map((g) => g.mergeKey);
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

	const getTransportIcon = (
		transport: McpGroup["transport"],
		starred: boolean,
	) => {
		const Icon =
			transport.type === "stdio" ? CommandLineIcon : GlobeAltIcon;
		return (
			<div className="relative inline-flex size-4 shrink-0 items-center justify-center">
				<Icon className="size-4" />
				{starred && (
					<StarIconSolid className="absolute -bottom-1 -left-1 size-2.5 text-warning" />
				)}
			</div>
		);
	};

	if (sortedGroups.length === 0) {
		return (
			<p className="px-3 py-6 text-center text-sm text-muted">
				{emptyMessage ?? t("noServersMatch")}
			</p>
		);
	}

	return (
		<div className="flex-1 overflow-y-auto">
			<ListBox
				aria-label="MCP Servers"
				selectionMode={selectionMode}
				selectionBehavior="toggle"
				selectedKeys={selectedKeys}
				onSelectionChange={handleSelectionChange}
				className="p-2"
			>
				{sortedGroups.map((group) => {
					const isStarred = isMcpStarred(group.mergeKey);
					return (
						<ListBox.Item
							key={group.mergeKey}
							id={group.mergeKey}
							textValue={group.items[0].name}
							className="data-selected:bg-surface"
						>
							<div className="flex w-full items-center gap-2">
								{getTransportIcon(group.transport, isStarred)}
								<Label className="flex-1 truncate">
									{group.items[0].name}
								</Label>
								<McpAgentIcons items={group.items} />
							</div>
						</ListBox.Item>
					);
				})}
			</ListBox>
		</div>
	);
}
