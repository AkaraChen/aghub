import {
	BookOpenIcon,
	StarIcon as StarIconSolid,
} from "@heroicons/react/24/solid";
import { useDndContext } from "@dnd-kit/core";
import { Label, ListBox, Spinner } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import Fuse from "fuse.js";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SkillResponse } from "../generated/dto";
import { AgentIcons } from "./agent-icons";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { useFavorites } from "../hooks/use-favorites";
import type { SelectionEntry } from "../hooks/use-list-selection";
import { useListSelection } from "../hooks/use-list-selection";
import type { ResourceActionIntents } from "../hooks/use-resource-actions";
import { useResourceActions } from "../hooks/use-resource-actions";
import { useSkillGroups } from "../hooks/use-resource-groups";
import { dragSelectionPayload } from "../lib/drag-payload";
import type { ResourceGroup } from "../lib/store";
import { cn, filterItemsByAgentIds } from "../lib/utils";
import { viewTransitionName } from "../lib/view-transition";
import {
	globalSkillLockQueryOptions,
	projectSkillLockQueryOptions,
} from "../requests/skills";
import { ContextMenu, useContextMenu } from "./context-menu";
import { customGroupMenu, resourceItemsMenu } from "./resource-menu-items";
import { DraggableItemBody } from "./draggable-item-body";
import { groupDropId, UNGROUPED_DROP_ID } from "./list-dnd";
import { DeleteGroupDialog, GroupNameDialog } from "./resource-group-dialogs";
import {
	DropRegion,
	NewGroupDropZone,
	ResourceGroupSection,
} from "./resource-group-section";

interface SkillGroup {
	name: string;
	items: SkillResponse[];
	description: string;
}

interface SourceGroup {
	source: string;
	sourceType: string;
	sourceUrl: string | null;
	skills: SkillGroup[];
}

/** One entry in the loose list below custom groups: either an ungrouped
 * skill or a source cluster, sorted together as peers. */
type LooseEntry =
	| { kind: "source"; group: SourceGroup }
	| { kind: "skill"; skill: SkillGroup };

type MenuTarget =
	| { type: "items"; sourceUrl?: string | null }
	| { type: "custom-group"; group: ResourceGroup; memberKeys: string[] };

interface SkillListProps {
	skills: SkillResponse[];
	selectedKeys: Set<string>;
	searchQuery: string;
	onSelectionChange: (keys: Set<string>, clickedKey?: string) => void;
	emptyMessage?: string;
	groupBySource?: boolean;
	projectPath?: string;
	selectionMode?: "none" | "single" | "multiple";
	isMultiSelectMode?: boolean;
	/** Dialog intents owned by the page (delete/transfer/agents/new group) */
	intents: ResourceActionIntents;
}

export function SkillList({
	skills,
	selectedKeys,
	searchQuery,
	onSelectionChange,
	emptyMessage,
	groupBySource = false,
	projectPath,
	selectionMode = "single",
	isMultiSelectMode = false,
	intents,
}: SkillListProps) {
	const { t } = useTranslation();
	const api = useApi();
	const { availableAgents } = useAgentAvailability();
	const effectiveScope = groupBySource
		? projectPath
			? "project"
			: "global"
		: null;
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
		groupBySource &&
		((effectiveScope === "global" && isLoadingGlobalLock) ||
			(effectiveScope === "project" && isLoadingProjectLock));

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

	const { isSkillStarred, setSkillsStarred } = useFavorites();
	const { groups, assignments, renameGroup, deleteGroup } = useSkillGroups();

	const [collapsedIds, setCollapsedIds] = useState<Set<string>>(
		() => new Set(),
	);
	const [renameTarget, setRenameTarget] = useState<ResourceGroup | null>(
		null,
	);
	const [deleteTarget, setDeleteTarget] = useState<ResourceGroup | null>(
		null,
	);
	// The page owns the DndContext; the list reads its active drag to show
	// the new-group zone and gate selection while dragging.
	const { active: activeDrag } = useDndContext();
	const isDragging = activeDrag != null;

	const filteredByName = useMemo(() => {
		let items;
		if (!searchQuery) items = groupedByName;
		else items = fuse.search(searchQuery).map((result) => result.item);

		return [...items].sort((a, b) => {
			const aStarred = isSkillStarred(a.name);
			const bStarred = isSkillStarred(b.name);
			if (aStarred && !bStarred) return -1;
			if (!aStarred && bStarred) return 1;
			return 0;
		});
	}, [fuse, groupedByName, searchQuery, isSkillStarred]);

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
			const entry = relevantEntries?.find((s) => s.name === skillName);
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

		if (!groupBySource) {
			return {
				sourceGroups: [],
				ungroupedGroups: unassignedByName,
			};
		}

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
		groupBySource,
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

	// Order: custom groups (the user's intent) first, then the loose entries
	// in their unified display order (source clusters and skills interleaved).
	// Source clusters collapse by default (custom groups stay open). The
	// cluster holding the current selection starts open so the seeded or
	// deep-linked row is visible. One-time init once the lock has loaded;
	// render-phase state, not an effect.
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

	const {
		createSelectionHandler,
		selectGroup,
		ensureSelected,
		anchorCluster,
	} = useListSelection({
		orderedEntries,
		selectedKeys,
		onSelectionChange,
		isMultiSelectMode,
	});

	const contextMenu = useContextMenu<MenuTarget>();
	const actions = useResourceActions({
		kind: "skill",
		selectedKeys,
		intents,
	});

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

	// The header reflects its members: selected once every member is in
	// the selection, regardless of what else is selected elsewhere.
	const isGroupSelected = (memberKeys: string[]) =>
		memberKeys.length > 0 &&
		memberKeys.every((key) => selectedKeys.has(key));

	const openItemMenu = (event: React.MouseEvent, key: string) => {
		ensureSelected(key);
		contextMenu.open(event, { type: "items" });
	};

	const openGroupMenu = (
		event: React.MouseEvent,
		group: ResourceGroup,
		memberKeys: string[],
	) => {
		contextMenu.open(event, { type: "custom-group", group, memberKeys });
	};

	const openSourceMenu = (
		event: React.MouseEvent,
		memberKeys: string[],
		sourceUrl: string | null,
	) => {
		selectGroup(memberKeys);
		contextMenu.open(event, { type: "items", sourceUrl });
	};

	// Helper to render a skill item
	const renderSkillItem = (skillGroup: SkillGroup) => (
		<ListBox.Item
			key={skillGroup.name}
			id={skillGroup.name}
			textValue={skillGroup.name}
			className="data-selected:bg-surface transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]"
			style={{
				viewTransitionName: viewTransitionName("vts", skillGroup.name),
			}}
		>
			<DraggableItemBody
				dragId={`item:${skillGroup.name}`}
				keys={dragSelectionPayload([skillGroup.name], selectedKeys)}
				onContextMenu={(event) => openItemMenu(event, skillGroup.name)}
			>
				<div className="relative inline-flex size-4 shrink-0 items-center justify-center">
					<BookOpenIcon className="size-4 text-muted" />
					{isSkillStarred(skillGroup.name) && (
						<StarIconSolid className="absolute -bottom-1 -left-1 size-2.5 text-warning" />
					)}
				</div>
				<Label className="flex-1 truncate">{skillGroup.name}</Label>
				<AgentIcons items={skillGroup.items} overflowVariant="square" />
			</DraggableItemBody>
		</ListBox.Item>
	);

	const renderSectionListBox = (
		label: string,
		sectionSkills: SkillGroup[],
		dense = false,
	) => (
		<ListBox
			aria-label={label}
			selectionMode={selectionMode}
			selectionBehavior="toggle"
			selectedKeys={selectedKeys}
			onSelectionChange={createSelectionHandler(
				sectionSkills.map((s) => s.name),
			)}
			// dense: a source cluster's members share the loose list rhythm
			// (no extra top gap under the header row)
			className={cn(dense ? "px-2 pb-1 pl-6" : "p-2 pl-6")}
		>
			{sectionSkills.map(renderSkillItem)}
		</ListBox>
	);

	const overlaysNode = (
		<>
			<ContextMenu
				position={contextMenu.state?.position ?? null}
				onClose={contextMenu.close}
				aria-label={t("resourceActions")}
			>
				{contextMenu.state?.context.type === "custom-group"
					? customGroupMenu({
							t,
							group: contextMenu.state.context.group,
							memberKeys: contextMenu.state.context.memberKeys,
							onSelectMembers: (keys) =>
								onSelectionChange(new Set(keys)),
							onAddToAgent: intents.onRequestAddToAgent,
							onFavoriteAll: (keys) =>
								void setSkillsStarred(keys, true),
							onRename: setRenameTarget,
							onDelete: setDeleteTarget,
						})
					: resourceItemsMenu({
							t,
							actions,
							sourceUrl: contextMenu.state?.context.sourceUrl,
						})}
			</ContextMenu>
			<GroupNameDialog
				isOpen={renameTarget !== null}
				onClose={() => setRenameTarget(null)}
				title={t("renameGroup")}
				initialName={renameTarget?.name}
				onSubmit={async (name) => {
					if (renameTarget) await renameGroup(renameTarget.id, name);
				}}
			/>
			<DeleteGroupDialog
				group={deleteTarget}
				isOpen={deleteTarget !== null}
				onClose={() => setDeleteTarget(null)}
				onConfirm={async () => {
					if (deleteTarget) await deleteGroup(deleteTarget.id);
				}}
			/>
		</>
	);

	if (isGroupingLoading) {
		return (
			<div className="flex flex-1 items-center justify-center overflow-y-auto">
				<Spinner size="lg" />
			</div>
		);
	}

	const hasItems =
		customSections.length > 0 ||
		sourceGroups.length > 0 ||
		ungroupedGroups.length > 0;
	if (!hasItems) {
		return (
			<p className="px-3 py-6 text-center text-sm text-muted">
				{emptyMessage ?? t("noSkillsMatch")}
			</p>
		);
	}

	// Walk the unified loose list, batching consecutive skill rows into one
	// ListBox and rendering each source cluster as a subtle peer row.
	const looseNodes: ReactNode[] = [];
	let skillRun: SkillGroup[] = [];
	const flushSkillRun = () => {
		if (skillRun.length === 0) return;
		const runKeys = skillRun.map((s) => s.name);
		looseNodes.push(
			<ListBox
				key={`loose-${runKeys[0]}`}
				aria-label="Skills"
				selectionMode={selectionMode}
				selectionBehavior="toggle"
				selectedKeys={selectedKeys}
				onSelectionChange={createSelectionHandler(runKeys)}
				className="px-2 py-1"
			>
				{skillRun.map(renderSkillItem)}
			</ListBox>,
		);
		skillRun = [];
	};
	for (const entry of looseEntries) {
		if (entry.kind === "skill") {
			skillRun.push(entry.skill);
			continue;
		}
		flushSkillRun();
		const sg = entry.group;
		const memberKeys = sg.skills.map((s) => s.name);
		looseNodes.push(
			<ResourceGroupSection
				key={sg.source}
				subtle
				title={sg.source}
				count={sg.skills.length}
				isExpanded={isExpanded(`s:${sg.source}`)}
				isSelected={isGroupSelected(memberKeys)}
				onToggleExpanded={() => {
					// The toggle click also plants the shift-range anchor:
					// "start the next range at this cluster"
					anchorCluster(`s:${sg.source}`, memberKeys);
					toggleCollapsed(`s:${sg.source}`);
				}}
				onSelectAll={() => selectGroup(memberKeys, `s:${sg.source}`)}
				onContextMenu={(event) =>
					openSourceMenu(event, memberKeys, sg.sourceUrl)
				}
				dragId={`header:${sg.source}`}
				dragKeys={memberKeys}
			>
				{renderSectionListBox(sg.source, sg.skills, true)}
			</ResourceGroupSection>,
		);
	}
	flushSkillRun();

	return (
		<div className="flex-1 overflow-y-auto">
			{customSections.map((section) => {
				const memberKeys = section.skills.map((s) => s.name);
				return (
					<ResourceGroupSection
						key={section.group.id}
						title={section.group.name}
						count={section.skills.length}
						isExpanded={isExpanded(`g:${section.group.id}`)}
						isSelected={isGroupSelected(memberKeys)}
						onToggleExpanded={() =>
							toggleCollapsed(`g:${section.group.id}`)
						}
						onSelectAll={() =>
							selectGroup(memberKeys, `g:${section.group.id}`)
						}
						onContextMenu={(event) =>
							openGroupMenu(event, section.group, memberKeys)
						}
						dropId={groupDropId(section.group.id)}
						dragId={`header:${section.group.id}`}
						dragKeys={memberKeys}
						onRename={() => setRenameTarget(section.group)}
					>
						{section.skills.length > 0 &&
							renderSectionListBox(
								section.group.name,
								section.skills,
							)}
					</ResourceGroupSection>
				);
			})}

			{looseEntries.length > 0 && (
				<DropRegion id={UNGROUPED_DROP_ID}>{looseNodes}</DropRegion>
			)}

			{isDragging && <NewGroupDropZone />}

			{overlaysNode}
		</div>
	);
}
