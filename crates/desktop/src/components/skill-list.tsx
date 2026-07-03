import { StarIcon as StarIconOutline } from "@heroicons/react/24/outline";
import {
	BookOpenIcon,
	CodeBracketIcon,
	FolderIcon,
	FolderMinusIcon,
	FolderPlusIcon,
	PencilIcon,
	PlusIcon,
	StarIcon as StarIconSolid,
	TrashIcon,
} from "@heroicons/react/24/solid";
import { Header, Label, ListBox, Menu, Spinner } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import Fuse from "fuse.js";
import { useCallback, useMemo, useState } from "react";
import { DropZone, useDragAndDrop } from "react-aria-components";
import { useTranslation } from "react-i18next";
import type { SkillResponse } from "../generated/dto";
import { AgentIcons } from "./agent-icons";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { useFavorites } from "../hooks/use-favorites";
import { useListSelection } from "../hooks/use-list-selection";
import type { ResourceActionIntents } from "../hooks/use-resource-actions";
import { useResourceActions } from "../hooks/use-resource-actions";
import { useSkillGroups } from "../hooks/use-resource-groups";
import type { ResourceGroup } from "../lib/store";
import { cn, filterItemsByAgentIds } from "../lib/utils";
import {
	globalSkillLockQueryOptions,
	projectSkillLockQueryOptions,
} from "../requests/skills";
import { ContextMenu, useContextMenu } from "./context-menu";
import { DeleteGroupDialog, GroupNameDialog } from "./resource-group-dialogs";
import {
	NewGroupDropZone,
	readDraggedKeys,
	ResourceGroupSection,
} from "./resource-group-section";

export const SKILL_DRAG_TYPE = "aghub-skill-keys";

interface SkillGroup {
	name: string;
	items: SkillResponse[];
	description: string;
}

interface SourceGroup {
	source: string;
	sourceType: string;
	skills: SkillGroup[];
}

type MenuTarget =
	{ type: "items" } | { type: "custom-group"; group: ResourceGroup };

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
	/** Dropping items on the new-group zone: page opens the naming dialog */
	onDropCreateGroup: (keys: string[]) => void;
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
	onDropCreateGroup,
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

	const { isSkillStarred } = useFavorites();
	const {
		groups,
		assignments,
		renameGroup,
		deleteGroup,
		assignMembers,
		unassignMembers,
	} = useSkillGroups();

	const [collapsedIds, setCollapsedIds] = useState<Set<string>>(
		() => new Set(),
	);
	const [renameTarget, setRenameTarget] = useState<ResourceGroup | null>(
		null,
	);
	const [deleteTarget, setDeleteTarget] = useState<ResourceGroup | null>(
		null,
	);
	const [isDraggingKeys, setIsDraggingKeys] = useState(false);

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
		): { source: string; sourceType: string } | null => {
			const relevantEntries =
				effectiveScope === "project"
					? projectLock?.skills
					: globalLock?.skills;
			const entry = relevantEntries?.find((s) => s.name === skillName);
			if (entry) {
				return {
					source: entry.source,
					sourceType: entry.sourceType,
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

	const { dragAndDropHooks } = useDragAndDrop({
		getItems: (keys) => [
			{
				[SKILL_DRAG_TYPE]: JSON.stringify(Array.from(keys).map(String)),
			},
		],
		onDragStart: () => setIsDraggingKeys(true),
		onDragEnd: () => setIsDraggingKeys(false),
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

	const isWholeSelection = (memberKeys: string[]) =>
		memberKeys.length > 0 &&
		memberKeys.length === selectedKeys.size &&
		memberKeys.every((key) => selectedKeys.has(key));

	const openItemMenu = (event: React.MouseEvent, key: string) => {
		ensureSelected(key);
		contextMenu.open(event, { type: "items" });
	};

	const openGroupMenu = (event: React.MouseEvent, group: ResourceGroup) => {
		contextMenu.open(event, { type: "custom-group", group });
	};

	const openSourceMenu = (event: React.MouseEvent, memberKeys: string[]) => {
		selectGroup(memberKeys);
		contextMenu.open(event, { type: "items" });
	};

	// Helper to render a skill item
	const renderSkillItem = (skillGroup: SkillGroup) => (
		<ListBox.Item
			key={skillGroup.name}
			id={skillGroup.name}
			textValue={skillGroup.name}
			className="data-selected:bg-surface"
		>
			<div
				className="flex w-full items-center gap-2"
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
			</div>
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
			dragAndDropHooks={dragAndDropHooks}
			className="p-2 pl-6"
		>
			{sectionSkills.map(renderSkillItem)}
		</ListBox>
	);

	const itemsMenuNode = (
		<>
			<Menu.Item
				id="toggle-favorite"
				textValue={actions.allStarred ? t("unfavorite") : t("favorite")}
				onAction={() => void actions.toggleFavorite()}
			>
				<div className="flex items-center gap-2">
					{actions.allStarred ? (
						<StarIconOutline className="size-4" />
					) : (
						<StarIconSolid className="size-4 text-warning" />
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
					<PlusIcon className="size-4" />
					<span>{t("addToAgent")}</span>
				</div>
			</Menu.Item>
			<Menu.Item
				id="transfer"
				textValue={t("transfer")}
				onAction={actions.requestTransfer}
			>
				<div className="flex items-center gap-2">
					<CodeBracketIcon className="size-4" />
					<span>{t("transfer")}</span>
				</div>
			</Menu.Item>
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
							<FolderIcon
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
						<FolderPlusIcon className="size-4" />
						<span>{t("createGroup")}</span>
					</div>
				</Menu.Item>
				{actions.canRemoveFromGroup && (
					<Menu.Item
						id="remove-from-group"
						textValue={t("removeFromGroup")}
						onAction={() => void actions.removeFromGroup()}
					>
						<div className="flex items-center gap-2">
							<FolderMinusIcon className="size-4" />
							<span>{t("removeFromGroup")}</span>
						</div>
					</Menu.Item>
				)}
			</Menu.Section>
			<Menu.Section>
				<Menu.Item
					id="delete"
					textValue={t("delete")}
					onAction={actions.requestDelete}
				>
					<div className="flex items-center gap-2 text-danger">
						<TrashIcon className="size-4" />
						<span>{t("delete")}</span>
					</div>
				</Menu.Item>
			</Menu.Section>
		</>
	);

	const customGroupMenuNode = (group: ResourceGroup) => (
		<>
			<Menu.Item
				id="rename-group"
				textValue={t("renameGroup")}
				onAction={() => setRenameTarget(group)}
			>
				<div className="flex items-center gap-2">
					<PencilIcon className="size-4" />
					<span>{t("renameGroup")}</span>
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
					? customGroupMenuNode(contextMenu.state.context.group)
					: itemsMenuNode}
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
						icon={
							<FolderIcon className="size-4 shrink-0 text-muted" />
						}
						isExpanded={isExpanded(`g:${section.group.id}`)}
						isSelected={isWholeSelection(memberKeys)}
						onToggleExpanded={() =>
							toggleCollapsed(`g:${section.group.id}`)
						}
						onSelectAll={() => selectGroup(memberKeys)}
						onContextMenu={(event) =>
							openGroupMenu(event, section.group)
						}
						dragType={SKILL_DRAG_TYPE}
						dragKeys={memberKeys}
						onDropKeys={(keys) =>
							void assignMembers(keys, section.group.id)
						}
						onHeaderDragChange={setIsDraggingKeys}
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
						isSelected={isWholeSelection(memberKeys)}
						onToggleExpanded={() =>
							toggleCollapsed(`s:${sg.source}`)
						}
						onSelectAll={() => selectGroup(memberKeys)}
						onContextMenu={(event) =>
							openSourceMenu(event, memberKeys)
						}
						dragType={SKILL_DRAG_TYPE}
						dragKeys={memberKeys}
						onHeaderDragChange={setIsDraggingKeys}
					>
						{renderSectionListBox(sg.source, sg.skills)}
					</ResourceGroupSection>
				);
			})}

			{ungroupedGroups.length > 0 && (
				<DropZone
					getDropOperation={(types) =>
						types.has(SKILL_DRAG_TYPE) ? "move" : "cancel"
					}
					onDrop={(e) => {
						void readDraggedKeys(e.items, SKILL_DRAG_TYPE).then(
							(keys) => {
								if (keys.length > 0) void unassignMembers(keys);
							},
						);
					}}
					className={({ isDropTarget }) =>
						cn(
							isDropTarget &&
								"bg-accent/10 ring-1 ring-inset ring-accent",
						)
					}
				>
					{(customSections.length > 0 || sourceGroups.length > 0) && (
						<p className="px-3 pt-3 pb-1 text-xs font-medium tracking-wider text-muted uppercase">
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
						dragAndDropHooks={dragAndDropHooks}
						className="p-2"
					>
						{ungroupedGroups.map(renderSkillItem)}
					</ListBox>
				</DropZone>
			)}

			{isDraggingKeys && (
				<NewGroupDropZone
					dragType={SKILL_DRAG_TYPE}
					onDropKeys={onDropCreateGroup}
				/>
			)}

			{overlaysNode}
		</div>
	);
}
