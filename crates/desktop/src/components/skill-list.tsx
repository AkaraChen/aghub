import {
	BookOpenIcon,
	CheckCircleIcon,
	LinkIcon,
	PencilIcon,
	StarIcon as StarIconSolid,
	TrashIcon,
} from "@heroicons/react/24/solid";
import { useDndContext } from "@dnd-kit/core";
import { Header, Kbd, Label, ListBox, Menu, Spinner } from "@heroui/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useQuery } from "@tanstack/react-query";
import Fuse from "fuse.js";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SkillResponse } from "../generated/dto";
import { ACTION_ICONS } from "./action-icons";
import { AgentIcons } from "./agent-icons";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { useFavorites } from "../hooks/use-favorites";
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

		const sortedSourceGroups = multiItemGroups
			.map((sg) => ({
				...sg,
				skills: [...sg.skills].sort(byStarredThenName),
			}))
			.sort((a, b) => a.source.localeCompare(b.source));

		const rest = [...singleItems, ...unknown].sort(byStarredThenName);

		return {
			sourceGroups: sortedSourceGroups,
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

	const orderedKeys = useMemo(
		() => [
			...customSections.flatMap((s) => s.skills.map((g) => g.name)),
			...sourceGroups.flatMap((sg) => sg.skills.map((g) => g.name)),
			...ungroupedGroups.map((g) => g.name),
		],
		[customSections, sourceGroups, ungroupedGroups],
	);

	const { createSelectionHandler, selectGroup, ensureSelected } =
		useListSelection({
			orderedKeys,
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
		setCollapsedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const isExpanded = (id: string) => isSearching || !collapsedIds.has(id);

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
				viewTransitionName: viewTransitionName(
					"vts",
					skillGroup.name,
				),
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
	) => (
		<ListBox
			aria-label={label}
			selectionMode={selectionMode}
			selectionBehavior="toggle"
			selectedKeys={selectedKeys}
			onSelectionChange={createSelectionHandler(
				sectionSkills.map((s) => s.name),
			)}
			className="p-2 pl-6"
		>
			{sectionSkills.map(renderSkillItem)}
		</ListBox>
	);

	const itemsMenuNode = (sourceUrl?: string | null) => (
		<>
			{sourceUrl && (
				<Menu.Item
					id="open-in-browser"
					textValue={t("openInBrowser")}
					onAction={() => void openUrl(sourceUrl)}
				>
					<div className="flex items-center gap-2">
						<LinkIcon className="size-4" />
						<span>{t("openInBrowser")}</span>
					</div>
				</Menu.Item>
			)}
			<Menu.Item
				id="toggle-favorite"
				textValue={actions.allStarred ? t("unfavorite") : t("favorite")}
				onAction={() => void actions.toggleFavorite()}
			>
				<div className="flex items-center gap-2">
					{actions.allStarred ? (
						<ACTION_ICONS.unfavorite className="size-4" />
					) : (
						<ACTION_ICONS.favorite className="size-4 text-warning" />
					)}
					<span>
						{actions.allStarred ? t("unfavorite") : t("favorite")}
					</span>
				</div>
			</Menu.Item>
			<Menu.Item
				id="add-to-agent"
				textValue={t("addToAgent")}
				onAction={actions.requestAddToAgent}
			>
				<div className="flex items-center gap-2">
					<ACTION_ICONS.addToAgent className="size-4" />
					<span>{t("addToAgent")}</span>
				</div>
			</Menu.Item>
			<Menu.Item
				id="transfer"
				textValue={t("transfer")}
				onAction={actions.requestTransfer}
			>
				<div className="flex items-center gap-2">
					<ACTION_ICONS.transfer className="size-4" />
					<span>{t("transfer")}</span>
				</div>
			</Menu.Item>
			{actions.groups.length > 0 ? (
				<Menu.Section>
					<Header className="px-2 py-1 text-xs font-medium text-muted">
						{t("moveToGroup")}
					</Header>
					{actions.groups.map((group) => (
						<Menu.Item
							key={group.id}
							id={`group:${group.id}`}
							textValue={group.name}
							onAction={() => void actions.moveToGroup(group.id)}
						>
							<div className="flex items-center gap-2">
								<ACTION_ICONS.moveToGroup
									className={cn(
										"size-4",
										actions.commonGroupId === group.id
											? "text-accent"
											: "text-muted",
									)}
								/>
								<span className="truncate">{group.name}</span>
							</div>
						</Menu.Item>
					))}
					<Menu.Item
						id="create-group"
						textValue={t("createGroup")}
						onAction={actions.requestCreateGroup}
					>
						<div className="flex items-center gap-2">
							<ACTION_ICONS.createGroup className="size-4" />
							<span>{t("createGroup")}</span>
						</div>
					</Menu.Item>
					<Menu.Item
						id="remove-from-group"
						textValue={t("removeFromGroup")}
						isDisabled={!actions.canRemoveFromGroup}
						onAction={() => void actions.removeFromGroup()}
					>
						<div className="flex items-center gap-2">
							<ACTION_ICONS.removeFromGroup className="size-4" />
							<span>{t("removeFromGroup")}</span>
						</div>
					</Menu.Item>
				</Menu.Section>
			) : (
				<Menu.Item
					id="create-group"
					textValue={t("createGroup")}
					onAction={actions.requestCreateGroup}
				>
					<div className="flex items-center gap-2">
						<ACTION_ICONS.createGroup className="size-4" />
						<span>{t("createGroup")}</span>
					</div>
				</Menu.Item>
			)}
			<Menu.Section>
				<Menu.Item
					id="delete"
					textValue={t("delete")}
					onAction={actions.requestDelete}
				>
					<div className="flex w-full items-center gap-2 text-danger">
						<ACTION_ICONS.delete className="size-4" />
						<span className="flex-1">{t("delete")}</span>
						<Kbd>⌫</Kbd>
					</div>
				</Menu.Item>
			</Menu.Section>
		</>
	);

	const customGroupMenuNode = (group: ResourceGroup, memberKeys: string[]) => (
		<>
			<Menu.Item
				id="select-members"
				textValue={t("selectAllInGroup", { name: group.name })}
				onAction={() => onSelectionChange(new Set(memberKeys))}
			>
				<div className="flex items-center gap-2">
					<CheckCircleIcon className="size-4" />
					<span>{t("selectAllInGroup", { name: group.name })}</span>
				</div>
			</Menu.Item>
			<Menu.Item
				id="group-add-to-agent"
				textValue={t("addToAgent")}
				onAction={() => {
					onSelectionChange(new Set(memberKeys));
					intents.onRequestAddToAgent();
				}}
			>
				<div className="flex items-center gap-2">
					<ACTION_ICONS.addToAgent className="size-4" />
					<span>{t("addToAgent")}</span>
				</div>
			</Menu.Item>
			<Menu.Item
				id="group-favorite-all"
				textValue={t("favoriteAll")}
				onAction={() => void setSkillsStarred(memberKeys, true)}
			>
				<div className="flex items-center gap-2">
					<ACTION_ICONS.favorite className="size-4 text-warning" />
					<span>{t("favoriteAll")}</span>
				</div>
			</Menu.Item>
			<Menu.Section>
				<Menu.Item
					id="rename-group"
					textValue={t("renameGroup")}
					onAction={() => setRenameTarget(group)}
				>
					<div className="flex w-full items-center gap-2">
						<PencilIcon className="size-4" />
						<span className="flex-1">{t("renameGroup")}</span>
						<Kbd>F2</Kbd>
					</div>
				</Menu.Item>
				<Menu.Item
					id="delete-group"
					textValue={t("deleteGroup")}
					onAction={() => setDeleteTarget(group)}
				>
					<div className="flex items-center gap-2 text-danger">
						<TrashIcon className="size-4" />
						<span>{t("deleteGroup")}</span>
					</div>
				</Menu.Item>
			</Menu.Section>
		</>
	);

	const overlaysNode = (
		<>
			<ContextMenu
				position={contextMenu.state?.position ?? null}
				onClose={contextMenu.close}
				aria-label={t("resourceActions")}
			>
				{contextMenu.state?.context.type === "custom-group"
					? customGroupMenuNode(
							contextMenu.state.context.group,
							contextMenu.state.context.memberKeys,
						)
					: itemsMenuNode(contextMenu.state?.context.sourceUrl)}
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
						onSelectAll={() => selectGroup(memberKeys)}
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

			{sourceGroups.map((sg) => {
				const memberKeys = sg.skills.map((s) => s.name);
				return (
					<ResourceGroupSection
						key={sg.source}
						title={sg.source}
						count={sg.skills.length}
						isExpanded={isExpanded(`s:${sg.source}`)}
						isSelected={isGroupSelected(memberKeys)}
						onToggleExpanded={() =>
							toggleCollapsed(`s:${sg.source}`)
						}
						onSelectAll={() => selectGroup(memberKeys)}
						onContextMenu={(event) =>
							openSourceMenu(event, memberKeys, sg.sourceUrl)
						}
						dragId={`header:${sg.source}`}
						dragKeys={memberKeys}
					>
						{renderSectionListBox(sg.source, sg.skills)}
					</ResourceGroupSection>
				);
			})}

			{ungroupedGroups.length > 0 && (
				<DropRegion id={UNGROUPED_DROP_ID}>
					{(customSections.length > 0 || sourceGroups.length > 0) && (
						<p className="px-4 pt-3 pb-1 text-xs font-medium tracking-wider text-muted uppercase">
							{t("ungrouped")}
						</p>
					)}
					<ListBox
						aria-label="Skills"
						selectionMode={selectionMode}
						selectionBehavior="toggle"
						selectedKeys={selectedKeys}
						onSelectionChange={createSelectionHandler(
							ungroupedGroups.map((s) => s.name),
						)}
						className="p-2"
					>
						{ungroupedGroups.map(renderSkillItem)}
					</ListBox>
				</DropRegion>
			)}

			{isDragging && <NewGroupDropZone />}

			{overlaysNode}
		</div>
	);
}
