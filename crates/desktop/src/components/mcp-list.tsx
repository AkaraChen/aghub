import { CommandLineIcon, GlobeAltIcon } from "@heroicons/react/24/solid";
import { Label, ListBox, Tooltip } from "@heroui/react";
import Fuse from "fuse.js";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { AgentIcon, sortAgents } from "../lib/agent-icons";
import type { McpResponse } from "../lib/api-types";
import { getMcpMergeKey } from "../lib/utils";

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
				<div className="relative z-0 flex size-5 items-center justify-center rounded-full bg-default-100 text-[10px] font-medium text-default-600 ring-1 ring-surface">
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
						<McpAgentIcons items={group.items} />
					</div>
				</ListBox.Item>
			))}
		</ListBox>
	);
}
