import { useQuery } from "@tanstack/react-query";
import Fuse from "fuse.js";
import { useCallback, useMemo, useState } from "react";
import type { SkillResponse } from "../generated/dto";
import { filterItemsByAgentIds } from "../lib/utils";
import { UNIVERSAL_SKILL_TARGET_ID } from "../lib/skill-targets";
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
	displayName: string;
	items: SkillResponse[];
	description: string;
}

export interface SourceGroup {
	source: string;
	sourceType: string;
	sourceUrl: string | null;
	skills: SkillGroup[];
}

export type SkillSectionEntry =
	| { kind: "source"; id: string; group: SourceGroup }
	| { kind: "skill"; skill: SkillGroup };

type SourceEntry = Extract<SkillSectionEntry, { kind: "source" }>;

interface SkillSource {
	source: string;
	sourceType: string;
	sourceUrl: string | null;
}

function createSectionEntries(
	skills: SkillGroup[],
	sources: Map<string, SkillSource>,
	sortSkills: (a: SkillGroup, b: SkillGroup) => number,
	isSkillStarred: (name: string) => boolean,
	scopeId: string,
): SkillSectionEntry[] {
	const bySource = new Map<string, SourceGroup>();
	const entries: SkillSectionEntry[] = [];

	for (const skill of skills) {
		const source = sources.get(skill.name);
		if (!source) {
			entries.push({ kind: "skill", skill });
			continue;
		}
		const existing = bySource.get(source.source);
		if (existing) {
			existing.skills.push(skill);
		} else {
			bySource.set(source.source, { ...source, skills: [skill] });
		}
	}

	for (const group of bySource.values()) {
		if (group.skills.length === 1) {
			entries.push({ kind: "skill", skill: group.skills[0] });
		} else {
			entries.push({
				kind: "source",
				id: `s:${scopeId}:${group.source}`,
				group: {
					...group,
					skills: [...group.skills].sort(sortSkills),
				},
			});
		}
	}

	const entryName = (entry: SkillSectionEntry) =>
		entry.kind === "source"
			? (entry.group.source.split("/").pop() ?? entry.group.source)
			: entry.skill.displayName;
	const entryStarred = (entry: SkillSectionEntry) =>
		entry.kind === "source"
			? entry.group.skills.some((skill) => isSkillStarred(skill.name))
			: isSkillStarred(entry.skill.name);

	return entries.sort((a, b) => {
		const aStarred = entryStarred(a);
		const bStarred = entryStarred(b);
		if (aStarred !== bStarred) return aStarred ? -1 : 1;
		return entryName(a).localeCompare(entryName(b));
	});
}

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
	const enabledAgentIds = useMemo(() => {
		const ids = new Set(
			availableAgents
				.filter((agent) => !agent.isDisabled)
				.map((agent) => agent.id),
		);
		ids.add(UNIVERSAL_SKILL_TARGET_ID);
		return ids;
	}, [availableAgents]);
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
			displayName:
				items.find((skill) => skill.display_name?.trim())
					?.display_name ?? name,
			items,
			description: items.find((s) => s.description)?.description ?? "",
		}));
	}, [visibleSkills]);

	const fuse = useMemo(
		() =>
			new Fuse(groupedByName, {
				keys: [
					{ name: "displayName", weight: 2 },
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
			return a.displayName.localeCompare(b.displayName);
		},
		[isSkillStarred],
	);

	const { assignedSections, unassignedByName } = useMemo(() => {
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
		return { assignedSections: sections, unassignedByName: rest };
	}, [filteredByName, groups, assignments, searchQuery, byStarredThenName]);

	const sources = useMemo(() => {
		const relevantEntries =
			effectiveScope === "project"
				? projectLock?.skills
				: globalLock?.skills;
		return new Map<string, SkillSource>(
			(relevantEntries ?? []).map((entry) => [
				entry.name,
				{
					source: entry.source,
					sourceType: entry.sourceType,
					// The project lock entry has no url field.
					sourceUrl:
						"sourceUrl" in entry ? (entry.sourceUrl ?? null) : null,
				},
			]),
		);
	}, [effectiveScope, globalLock, projectLock]);

	const customSections = useMemo(
		() =>
			assignedSections.map((section) => ({
				...section,
				entries: createSectionEntries(
					section.skills,
					sources,
					byStarredThenName,
					isSkillStarred,
					`group:${section.group.id}`,
				),
			})),
		[assignedSections, sources, byStarredThenName, isSkillStarred],
	);

	const looseEntries = useMemo(
		() =>
			createSectionEntries(
				unassignedByName,
				sources,
				byStarredThenName,
				isSkillStarred,
				"loose",
			),
		[unassignedByName, sources, byStarredThenName, isSkillStarred],
	);

	const sourceEntries = useMemo(() => {
		const entries: SourceEntry[] = [];
		for (const section of customSections) {
			for (const entry of section.entries) {
				if (entry.kind === "source") entries.push(entry);
			}
		}
		for (const entry of looseEntries) {
			if (entry.kind === "source") entries.push(entry);
		}
		return entries;
	}, [customSections, looseEntries]);

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
				sourceEntries
					.filter((entry) =>
						entry.group.skills.some((skill) =>
							selectedKeys.has(skill.name),
						),
					)
					.map((entry) => entry.id),
			),
		);
	}

	// A single selection landing on a row hidden inside a collapsed
	// cluster (library page member click, global-search deep link) pops
	// that cluster open — the selected row must be visible. Bulk
	// selections leave collapse state alone. Render-phase state with a
	// prev-comparison, same pattern as the pages' URL adoption.
	const [prevSelectedKeys, setPrevSelectedKeys] = useState(selectedKeys);
	if (prevSelectedKeys !== selectedKeys) {
		setPrevSelectedKeys(selectedKeys);
		if (selectedKeys.size === 1 && expandedSources !== null) {
			const [only] = selectedKeys;
			const holder = sourceEntries.find((entry) =>
				entry.group.skills.some((skill) => skill.name === only),
			);
			if (holder && !expandedSources.has(holder.id)) {
				setExpandedSources(new Set([...expandedSources, holder.id]));
			}
		}
	}

	// Display-order entries for shift ranges: an expanded section
	// contributes its member rows, a collapsed one is a single entry
	// carrying all members — a range crossing it selects the whole thing.
	const orderedEntries = useMemo<SelectionEntry[]>(() => {
		const expandedAll = Boolean(searchQuery);
		const entries: SelectionEntry[] = [];
		const appendEntries = (sectionEntries: SkillSectionEntry[]) => {
			for (const entry of sectionEntries) {
				if (entry.kind === "skill") {
					entries.push({ kind: "item", key: entry.skill.name });
					continue;
				}
				const memberKeys = entry.group.skills.map(
					(skill) => skill.name,
				);
				if (expandedAll || expandedSources?.has(entry.id)) {
					for (const key of memberKeys)
						entries.push({ kind: "item", key });
				} else {
					entries.push({
						kind: "cluster",
						id: entry.id,
						memberKeys,
					});
				}
			}
		};
		for (const section of customSections) {
			const memberKeys = section.skills.map((g) => g.name);
			if (expandedAll || !collapsedIds.has(`g:${section.group.id}`)) {
				appendEntries(section.entries);
			} else {
				entries.push({
					kind: "cluster",
					id: `g:${section.group.id}`,
					memberKeys,
				});
			}
		}
		appendEntries(looseEntries);
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
			setExpandedSources((prev) => {
				const next = new Set(prev ?? []);
				if (next.has(id)) next.delete(id);
				else next.add(id);
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
			? (expandedSources?.has(id) ?? false)
			: !collapsedIds.has(id));

	return {
		/** Name-deduped skills before the search filter — the page's lookup
		 * table for seed, detail, and dialogs. */
		groupedByName,
		customSections,
		looseEntries,
		orderedEntries,
		isGroupingLoading,
		isSearching,
		toggleCollapsed,
		isExpanded,
	};
}

export type SkillSections = ReturnType<typeof useSkillSections>;
