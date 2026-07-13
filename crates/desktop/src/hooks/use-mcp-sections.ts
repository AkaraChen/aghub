import Fuse from "fuse.js";
import { useMemo, useState } from "react";
import type { McpResponse } from "../generated/dto";
import { filterItemsByAgentIds, getMcpMergeKey } from "../lib/utils";
import { useAgentAvailability } from "./use-agent-availability";
import { useFavorites } from "./use-favorites";
import type { SelectionEntry } from "./use-list-selection";
import { useMcpGroups } from "./use-resource-groups";

export interface McpSectionGroup {
	mergeKey: string;
	transport: McpResponse["transport"];
	items: McpResponse[];
}

interface UseMcpSectionsOptions {
	mcps: McpResponse[];
	searchQuery: string;
}

/**
 * The MCP list's derivation pipeline — the server-side twin of
 * use-skill-sections: agent-availability filtering, mergeKey grouping,
 * search, starred-first ordering, custom-group sectioning, and the
 * display-order entries that shift ranges (and select-all) walk.
 * Collapse state lives here because collapsed sections fold into single
 * entries of that display order.
 */
export function useMcpSections({ mcps, searchQuery }: UseMcpSectionsOptions) {
	const { availableAgents } = useAgentAvailability();
	const enabledAgentIds = useMemo(
		() =>
			new Set(
				availableAgents
					.filter((agent) => !agent.isDisabled)
					.map((agent) => agent.id),
			),
		[availableAgents],
	);
	const visibleMcps = useMemo(
		() => filterItemsByAgentIds(mcps, enabledAgentIds),
		[mcps, enabledAgentIds],
	);

	const groupedMcps = useMemo(() => {
		const map = new Map<string, McpResponse[]>();
		for (const mcp of visibleMcps) {
			const key = getMcpMergeKey(mcp.transport);
			const existing = map.get(key) ?? [];
			map.set(key, [...existing, mcp]);
		}
		return Array.from(map.entries()).map(
			([mergeKey, items]): McpSectionGroup => ({
				mergeKey,
				transport: items[0].transport,
				items,
			}),
		);
	}, [visibleMcps]);

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
	const { groups, assignments } = useMcpGroups();

	const [collapsedIds, setCollapsedIds] = useState<Set<string>>(
		() => new Set(),
	);

	const sortedGroups = useMemo(() => {
		const list = [...filteredGroups];
		return list.sort((a, b) => {
			const aStarred = isMcpStarred(a.mergeKey);
			const bStarred = isMcpStarred(b.mergeKey);
			if (aStarred && !bStarred) return -1;
			if (!aStarred && bStarred) return 1;
			return 0;
		});
	}, [filteredGroups, isMcpStarred]);

	const { customSections, unassignedGroups } = useMemo(() => {
		const members = new Map<string, McpSectionGroup[]>();
		const rest: McpSectionGroup[] = [];
		const groupIds = new Set(groups.map((g) => g.id));
		for (const item of sortedGroups) {
			const groupId = assignments[item.mergeKey];
			if (groupId && groupIds.has(groupId)) {
				const existing = members.get(groupId) ?? [];
				existing.push(item);
				members.set(groupId, existing);
			} else {
				rest.push(item);
			}
		}
		const sections = groups
			.map((group) => ({
				group,
				mcps: members.get(group.id) ?? [],
			}))
			.filter((section) => !searchQuery || section.mcps.length > 0);
		return { customSections: sections, unassignedGroups: rest };
	}, [sortedGroups, groups, assignments, searchQuery]);

	// Display-order entries for shift ranges: an expanded group
	// contributes its member rows, a collapsed one is a single entry
	// carrying all members — a range crossing it selects the whole thing.
	const orderedEntries = useMemo<SelectionEntry[]>(() => {
		const entries: SelectionEntry[] = [];
		for (const section of customSections) {
			const memberKeys = section.mcps.map((g) => g.mergeKey);
			if (searchQuery || !collapsedIds.has(`g:${section.group.id}`)) {
				for (const key of memberKeys)
					entries.push({ kind: "item", key });
			} else {
				entries.push({
					kind: "cluster",
					id: `g:${section.group.id}`,
					memberKeys,
				});
			}
		}
		for (const group of unassignedGroups) {
			entries.push({ kind: "item", key: group.mergeKey });
		}
		return entries;
	}, [customSections, unassignedGroups, collapsedIds, searchQuery]);

	const isSearching = Boolean(searchQuery);

	const toggleCollapsed = (id: string) => {
		if (isSearching) return;
		setCollapsedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const isExpanded = (id: string) => isSearching || !collapsedIds.has(id);

	return {
		/** MergeKey-deduped servers before the search filter — the page's
		 * lookup table for seed, detail, and dialogs. */
		groupedMcps,
		customSections,
		unassignedGroups,
		orderedEntries,
		isSearching,
		toggleCollapsed,
		isExpanded,
	};
}

export type McpSections = ReturnType<typeof useMcpSections>;
