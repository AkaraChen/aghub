import { useQuery } from "@tanstack/react-query";
import Fuse from "fuse.js";
import { useCallback, useMemo, useState } from "react";
import type { SkillResponse } from "../generated/dto";
import { filterItemsByAgentIds } from "../lib/utils";
import {
	globalSkillLockQueryOptions,
	projectSkillLockQueryOptions,
} from "../requests/skills";
import { useAgentAvailability } from "./use-agent-availability";
import { useApi } from "./use-api";
import { useFavorites } from "./use-favorites";
import type { SelectionEntry } from "./use-list-selection";
import { useSkillGroups } from "./use-resource-groups";

export interface SkillGroup {
	name: string;
	items: SkillResponse[];
	description: string;
}

export interface SourceGroup {
	source: string;
	sourceType: string;
	sourceUrl: string | null;
	skills: SkillGroup[];
}

/** One entry in the loose list below custom groups: either an ungrouped
 * skill or a source cluster, sorted together as peers. */
export type LooseEntry =
	| { kind: "source"; group: SourceGroup }
	| { kind: "skill"; skill: SkillGroup };

interface UseSkillSectionsOptions {
	skills: SkillResponse[];
	searchQuery: string;
	/** Drives which source cluster starts expanded (seed visibility) */
	selectedKeys: Set<string>;
	projectPath?: string;
}

/**
 * The skill list's derivation pipeline: agent-availability filtering,
 * lock-based source clustering, custom-group sectioning, the unified
 * loose order, and the display-order entries that shift ranges walk.
 * Expansion state lives here too, because collapsed sections fold into
 * single entries of that display order.
 */
export function useSkillSections({
	skills,
	searchQuery,
	selectedKeys,
	projectPath,
}: UseSkillSectionsOptions) {
	const api = useApi();
	const { availableAgents } = useAgentAvailability();
	const effectiveScope = projectPath ? "project" : "global";
	const enabledAgentIds = useMemo(
		() =>
			new Set(
				availableAgents
					.filter((agent) => !agent.isDisabled)
					.map((agent) => agent.id),
			),
		[availableAgents],
	);
	const visibleSkills = useMemo(
		() => filterItemsByAgentIds(skills, enabledAgentIds),
		[skills, enabledAgentIds],
	);

	const { data: globalLock, isLoading: isLoadingGlobalLock } = useQuery({
		...globalSkillLockQueryOptions({
			api,
			enabled: effectiveScope === "global",
		}),
	});

	const { data: projectLock, isLoading: isLoadingProjectLock } = useQuery({
		...projectSkillLockQueryOptions({
			api,
			projectPath,
			enabled: effectiveScope === "project" && Boolean(projectPath),
		}),
	});

	const isGroupingLoading =
		(effectiveScope === "global" && isLoadingGlobalLock) ||
		(effectiveScope === "project" && isLoadingProjectLock);

	const groupedByName = useMemo(() => {
		const map = new Map<string, SkillResponse[]>();
		for (const skill of visibleSkills) {
			const existing = map.get(skill.name) ?? [];
			map.set(skill.name, [...existing, skill]);
		}
		return Array.from(map.entries()).map(([name, items]) => ({
			name,
			items,
			description: items.find((s) => s.description)?.description ?? "",
		}));
	}, [visibleSkills]);

	const fuse = useMemo(
		() =>
			new Fuse(groupedByName, {
				keys: [
					{ name: "name", weight: 2 },
					{ name: "description", weight: 1 },
				],
				threshold: 0.4,
				includeScore: true,
			}),
		[groupedByName],
	);

	// No ordering here: custom sections and the loose list each sort
	// their own members (starred-first, then name) downstream.
	const filteredByName = useMemo(() => {
		if (!searchQuery) return groupedByName;
		return fuse.search(searchQuery).map((result) => result.item);
	}, [fuse, groupedByName, searchQuery]);

	const { isSkillStarred } = useFavorites();
	const { groups, assignments } = useSkillGroups();

	const byStarredThenName = useCallback(
		(a: SkillGroup, b: SkillGroup) => {
			const aStarred = isSkillStarred(a.name);
			const bStarred = isSkillStarred(b.name);
			if (aStarred && !bStarred) return -1;
			if (!aStarred && bStarred) return 1;
			return a.name.localeCompare(b.name);
		},
		[isSkillStarred],
	);

	const { customSections, unassignedByName } = useMemo(() => {
		const members = new Map<string, SkillGroup[]>();
		const rest: SkillGroup[] = [];
		const groupIds = new Set(groups.map((g) => g.id));
		for (const item of filteredByName) {
			const groupId = assignments[item.name];
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
				skills: [...(members.get(group.id) ?? [])].sort(
					byStarredThenName,
				),
			}))
			.filter((section) => !searchQuery || section.skills.length > 0);
		return { customSections: sections, unassignedByName: rest };
	}, [filteredByName, groups, assignments, searchQuery, byStarredThenName]);

	const { sourceGroups, ungroupedGroups } = useMemo(() => {
		const findSkillSource = (
			skillName: string,
		): {
			source: string;
			sourceType: string;
			sourceUrl: string | null;
		} | null => {
			const relevantEntries =
				effectiveScope === "project"
					? projectLock?.skills
					: globalLock?.skills;
			const entry = relevantEntries?.find((e) => e.name === skillName);
			if (entry) {
				return {
					source: entry.source,
					sourceType: entry.sourceType,
					// The project lock entry has no url field
					sourceUrl:
						"sourceUrl" in entry ? (entry.sourceUrl ?? null) : null,
				};
			}
			return null;
		};

		const bySource = new Map<string, SourceGroup>();
		const singleItems: SkillGroup[] = [];
		const unknown: SkillGroup[] = [];

		for (const group of unassignedByName) {
			const sourceInfo = findSkillSource(group.name);
			if (sourceInfo) {
				const existing = bySource.get(sourceInfo.source);
				if (existing) {
					existing.skills.push(group);
				} else {
					bySource.set(sourceInfo.source, {
						source: sourceInfo.source,
						sourceType: sourceInfo.sourceType,
						sourceUrl: sourceInfo.sourceUrl,
						skills: [group],
					});
				}
			} else {
				unknown.push(group);
			}
		}

		const multiItemGroups: SourceGroup[] = [];
		for (const sg of bySource.values()) {
			if (sg.skills.length === 1) {
				singleItems.push(sg.skills[0]);
			} else {
				multiItemGroups.push(sg);
			}
		}

		// Members within a cluster sort starred-first; the cluster's own
		// position among the loose entries is decided in looseEntries below.
		const sourceClusters = multiItemGroups.map((sg) => ({
			...sg,
			skills: [...sg.skills].sort(byStarredThenName),
		}));

		const rest = [...singleItems, ...unknown];

		return {
			sourceGroups: sourceClusters,
			ungroupedGroups: rest,
		};
	}, [
		unassignedByName,
		globalLock,
		effectiveScope,
		projectLock,
		byStarredThenName,
	]);

	// The loose region — source clusters and ungrouped skills — is one level:
	// each entry sorts starred-first (a cluster counts as starred when any
	// member is), then by name (a cluster by its repo/skill name, the last
	// path segment). A source cluster is just a skill row with a dropdown.
	const looseEntries = useMemo<LooseEntry[]>(() => {
		const sourceName = (source: string) =>
			source.split("/").pop() ?? source;
		const entryStarred = (entry: LooseEntry) =>
			entry.kind === "source"
				? entry.group.skills.some((s) => isSkillStarred(s.name))
				: isSkillStarred(entry.skill.name);
		const entryName = (entry: LooseEntry) =>
			entry.kind === "source"
				? sourceName(entry.group.source)
				: entry.skill.name;
		const entries: LooseEntry[] = [
			...sourceGroups.map(
				(group) => ({ kind: "source", group }) as LooseEntry,
			),
			...ungroupedGroups.map(
				(skill) => ({ kind: "skill", skill }) as LooseEntry,
			),
		];
		return entries.sort((a, b) => {
			const aStarred = entryStarred(a);
			const bStarred = entryStarred(b);
			if (aStarred !== bStarred) return aStarred ? -1 : 1;
			return entryName(a).localeCompare(entryName(b));
		});
	}, [sourceGroups, ungroupedGroups, isSkillStarred]);

	// Custom groups stay open (collapsedIds is opt-out); source clusters
	// collapse by default (expandedSources is opt-in). The cluster holding
	// the current selection starts open so the seeded or deep-linked row
	// is visible. One-time init once the lock has loaded; render-phase
	// state, not an effect.
	const [collapsedIds, setCollapsedIds] = useState<Set<string>>(
		() => new Set(),
	);
	const [expandedSources, setExpandedSources] = useState<Set<string> | null>(
		null,
	);
	if (expandedSources === null && !isGroupingLoading) {
		setExpandedSources(
			new Set(
				sourceGroups
					.filter((sg) =>
						sg.skills.some((s) => selectedKeys.has(s.name)),
					)
					.map((sg) => sg.source),
			),
		);
	}

	// Display-order entries for shift ranges: an expanded section
	// contributes its member rows, a collapsed one is a single entry
	// carrying all members — a range crossing it selects the whole thing.
	const orderedEntries = useMemo<SelectionEntry[]>(() => {
		const expandedAll = Boolean(searchQuery);
		const entries: SelectionEntry[] = [];
		for (const section of customSections) {
			const memberKeys = section.skills.map((g) => g.name);
			if (expandedAll || !collapsedIds.has(`g:${section.group.id}`)) {
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
		for (const entry of looseEntries) {
			if (entry.kind === "skill") {
				entries.push({ kind: "item", key: entry.skill.name });
				continue;
			}
			const memberKeys = entry.group.skills.map((s) => s.name);
			if (
				expandedAll ||
				(expandedSources?.has(entry.group.source) ?? false)
			) {
				for (const key of memberKeys)
					entries.push({ kind: "item", key });
			} else {
				entries.push({
					kind: "cluster",
					id: `s:${entry.group.source}`,
					memberKeys,
				});
			}
		}
		return entries;
	}, [
		customSections,
		looseEntries,
		collapsedIds,
		expandedSources,
		searchQuery,
	]);

	const isSearching = Boolean(searchQuery);

	const toggleCollapsed = (id: string) => {
		if (isSearching) return;
		if (id.startsWith("s:")) {
			const source = id.slice(2);
			setExpandedSources((prev) => {
				const next = new Set(prev ?? []);
				if (next.has(source)) next.delete(source);
				else next.add(source);
				return next;
			});
			return;
		}
		setCollapsedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const isExpanded = (id: string) =>
		isSearching ||
		(id.startsWith("s:")
			? (expandedSources?.has(id.slice(2)) ?? false)
			: !collapsedIds.has(id));

	return {
		customSections,
		looseEntries,
		orderedEntries,
		isGroupingLoading,
		isSearching,
		toggleCollapsed,
		isExpanded,
	};
}
