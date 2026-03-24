import { CommandLineIcon, GlobeAltIcon } from "@heroicons/react/24/solid";
import { Label, ListBox } from "@heroui/react";
import Fuse from "fuse.js";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { McpResponse } from "../lib/api-types";
import { getMcpMergeKey } from "../lib/utils";

interface McpGroup {
	mergeKey: string;
	transport: McpResponse["transport"];
	items: McpResponse[];
}

interface McpListProps {
	mcps: McpResponse[];
	selectedKey: string | null;
	searchQuery: string;
	onSelect: (key: string) => void;
	emptyMessage?: string;
}

export function McpList({
	mcps,
	selectedKey,
	searchQuery,
	onSelect,
	emptyMessage,
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

	const getTransportIcon = (transport: McpGroup["transport"]) => {
		if (transport.type === "stdio") {
			return <CommandLineIcon className="size-4 shrink-0" />;
		}
		return <GlobeAltIcon className="size-4 shrink-0" />;
	};

	if (filteredGroups.length === 0) {
		return (
			<p className="px-3 py-6 text-center text-sm text-muted">
				{emptyMessage ?? t("noServersMatch")}
			</p>
		);
	}

	return (
		<ListBox
			aria-label="MCP Servers"
			selectionMode="single"
			selectedKeys={selectedKey ? new Set([selectedKey]) : new Set()}
			onSelectionChange={(keys) => {
				if (keys === "all") return;
				const key = [...keys][0] as string;
				if (key) onSelect(key);
			}}
			className="p-2"
		>
			{filteredGroups.map((group) => (
				<ListBox.Item
					key={group.mergeKey}
					id={group.mergeKey}
					textValue={group.items[0].name}
					className="data-selected:bg-surface"
				>
					<div className="flex w-full items-center gap-2">
						{getTransportIcon(group.transport)}
						<Label className="flex-1 truncate">
							{group.items[0].name}
						</Label>
					</div>
				</ListBox.Item>
			))}
		</ListBox>
	);
}
