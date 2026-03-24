import {
	CommandLineIcon,
	WifiIcon,
} from "@heroicons/react/24/solid";
import { Label, ListBox } from "@heroui/react";
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

	const filteredMcps = useMemo(
		() =>
			mcps.filter(
				(server) =>
					server.name
						.toLowerCase()
						.includes(searchQuery.toLowerCase()) ||
					(server.source ?? "")
						.toLowerCase()
						.includes(searchQuery.toLowerCase()) ||
					(server.agent ?? "")
						.toLowerCase()
						.includes(searchQuery.toLowerCase()),
			),
		[mcps, searchQuery],
	);

	const groupedMcps = useMemo(() => {
		const map = new Map<string, McpResponse[]>();
		for (const mcp of filteredMcps) {
			const key = getMcpMergeKey(mcp.transport);
			const existing = map.get(key) ?? [];
			map.set(key, [...existing, mcp]);
		}
		return Array.from(map.entries()).map(([mergeKey, items]) => ({
			mergeKey,
			transport: items[0].transport,
			items,
		}));
	}, [filteredMcps]);

	const getTransportIcon = (transport: McpGroup["transport"]) => {
		if (transport.type === "stdio") {
			return <CommandLineIcon className="size-4 shrink-0" />;
		}
		return <WifiIcon className="size-4 shrink-0" />;
	};

	if (groupedMcps.length === 0) {
		return (
			<p className="px-3 py-6 text-sm text-muted text-center">
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
			{groupedMcps.map((group) => (
				<ListBox.Item
					key={group.mergeKey}
					id={group.mergeKey}
					textValue={group.items[0].name}
					className="data-selected:bg-accent/10"
				>
					<div className="flex items-center gap-2 w-full">
						{getTransportIcon(group.transport)}
						<Label className="truncate flex-1">
							{group.items[0].name}
						</Label>
					</div>
				</ListBox.Item>
			))}
		</ListBox>
	);
}
