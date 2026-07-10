import {
	CheckCircleIcon,
	CommandLineIcon,
	GlobeAltIcon,
	PencilIcon,
	StarIcon as StarIconSolid,
	TrashIcon,
} from "@heroicons/react/24/solid";
import { useDndContext } from "@dnd-kit/core";
import { Header, Kbd, Label, ListBox, Menu } from "@heroui/react";
import Fuse from "fuse.js";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { McpResponse } from "../generated/dto";
import { ACTION_ICONS } from "./action-icons";
import { AgentIcons } from "./agent-icons";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useFavorites } from "../hooks/use-favorites";
import { useListSelection } from "../hooks/use-list-selection";
import type { ResourceActionIntents } from "../hooks/use-resource-actions";
import { useResourceActions } from "../hooks/use-resource-actions";
import { useMcpGroups } from "../hooks/use-resource-groups";
import { dragSelectionPayload } from "../lib/drag-payload";
import type { ResourceGroup } from "../lib/store";
import { cn, filterItemsByAgentIds, getMcpMergeKey } from "../lib/utils";
import { viewTransitionName } from "../lib/view-transition";
import { ContextMenu, useContextMenu } from "./context-menu";
import { DraggableItemBody } from "./draggable-item-body";
import { groupDropId, UNGROUPED_DROP_ID } from "./list-dnd";
import { DeleteGroupDialog, GroupNameDialog } from "./resource-group-dialogs";
import {
	DropRegion,
	NewGroupDropZone,
	ResourceGroupSection,
} from "./resource-group-section";

interface McpGroup {
	mergeKey: string;
	transport: McpResponse["transport"];
	items: McpResponse[];
}

type MenuTarget =
	| { type: "items" }
	| { type: "custom-group"; group: ResourceGroup; memberKeys: string[] };

interface McpListProps {
	mcps: McpResponse[];
	selectedKeys: Set<string>;
	searchQuery: string;
	onSelectionChange: (keys: Set<string>, clickedKey?: string) => void;
	emptyMessage?: string;
	selectionMode?: "none" | "single" | "multiple";
	isMultiSelectMode?: boolean;
	/** Dialog intents owned by the page (delete/transfer/agents/new group) */
	intents: ResourceActionIntents;
}

export function McpList({
	mcps,
	selectedKeys,
	searchQuery,
	onSelectionChange,
	emptyMessage,
	selectionMode = "single",
	isMultiSelectMode = false,
	intents,
}: McpListProps) {
	const { t } = useTranslation();
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
		return Array.from(map.entries()).map(([mergeKey, items]) => ({
			mergeKey,
			transport: items[0].transport,
			items,
		}));
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

	const { isMcpStarred, setMcpsStarred } = useFavorites();
	const { groups, assignments, renameGroup, deleteGroup } = useMcpGroups();

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
		const members = new Map<string, McpGroup[]>();
		const rest: McpGroup[] = [];
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

	// Only VISIBLE rows — shift ranges must not sweep members of a
	// collapsed group.
	const orderedKeys = useMemo(
		() => [
			...customSections.flatMap((s) =>
				searchQuery || !collapsedIds.has(`g:${s.group.id}`)
					? s.mcps.map((g) => g.mergeKey)
					: [],
			),
			...unassignedGroups.map((g) => g.mergeKey),
		],
		[customSections, unassignedGroups, collapsedIds, searchQuery],
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
		kind: "mcp",
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

	// The header reflects its members: selected once every member is in
	// the selection, regardless of what else is selected elsewhere.
	const isGroupSelected = (memberKeys: string[]) =>
		memberKeys.length > 0 &&
		memberKeys.every((key) => selectedKeys.has(key));

	const openItemMenu = (event: React.MouseEvent, key: string) => {
		ensureSelected(key);
		contextMenu.open(event, { type: "items" });
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

	const renderMcpItem = (group: McpGroup) => {
		const isStarred = isMcpStarred(group.mergeKey);
		return (
			<ListBox.Item
				key={group.mergeKey}
				id={group.mergeKey}
				textValue={group.items[0].name}
				className="data-selected:bg-surface transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]"
				style={{
					viewTransitionName: viewTransitionName(
						"vtm",
						group.mergeKey,
					),
				}}
			>
				<DraggableItemBody
					dragId={`item:${group.mergeKey}`}
					keys={dragSelectionPayload([group.mergeKey], selectedKeys)}
					onContextMenu={(event) =>
						openItemMenu(event, group.mergeKey)
					}
				>
					{getTransportIcon(group.transport, isStarred)}
					<Label className="flex-1 truncate">
						{group.items[0].name}
					</Label>
					<AgentIcons items={group.items} />
				</DraggableItemBody>
			</ListBox.Item>
		);
	};

	const renderSectionListBox = (label: string, sectionMcps: McpGroup[]) => (
		<ListBox
			aria-label={label}
			selectionMode={selectionMode}
			selectionBehavior="toggle"
			selectedKeys={selectedKeys}
			onSelectionChange={createSelectionHandler(
				sectionMcps.map((g) => g.mergeKey),
			)}
			className="p-2 pl-6"
		>
			{sectionMcps.map(renderMcpItem)}
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

	const customGroupMenuNode = (
		group: ResourceGroup,
		memberKeys: string[],
	) => (
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
				onAction={() => void setMcpsStarred(memberKeys, true)}
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

	if (sortedGroups.length === 0 && customSections.length === 0) {
		return (
			<p className="px-3 py-6 text-center text-sm text-muted">
				{emptyMessage ?? t("noServersMatch")}
			</p>
		);
	}

	return (
		<div className="flex-1 overflow-y-auto">
			{customSections.map((section) => {
				const memberKeys = section.mcps.map((g) => g.mergeKey);
				return (
					<ResourceGroupSection
						key={section.group.id}
						title={section.group.name}
						count={section.mcps.length}
						isExpanded={
							isSearching ||
							!collapsedIds.has(`g:${section.group.id}`)
						}
						isSelected={isGroupSelected(memberKeys)}
						onToggleExpanded={() =>
							toggleCollapsed(`g:${section.group.id}`)
						}
						onSelectAll={() => selectGroup(memberKeys)}
						onContextMenu={(event) =>
							contextMenu.open(event, {
								type: "custom-group",
								group: section.group,
								memberKeys,
							})
						}
						dropId={groupDropId(section.group.id)}
						dragId={`header:${section.group.id}`}
						dragKeys={memberKeys}
						onRename={() => setRenameTarget(section.group)}
					>
						{section.mcps.length > 0 &&
							renderSectionListBox(
								section.group.name,
								section.mcps,
							)}
					</ResourceGroupSection>
				);
			})}

			{unassignedGroups.length > 0 && (
				<DropRegion id={UNGROUPED_DROP_ID}>
					{customSections.length > 0 && (
						<p className="px-4 pt-3 pb-1 text-xs font-medium tracking-wider text-muted uppercase">
							{t("ungrouped")}
						</p>
					)}
					<ListBox
						aria-label="MCP Servers"
						selectionMode={selectionMode}
						selectionBehavior="toggle"
						selectedKeys={selectedKeys}
						onSelectionChange={createSelectionHandler(
							unassignedGroups.map((g) => g.mergeKey),
						)}
						className="p-2"
					>
						{unassignedGroups.map(renderMcpItem)}
					</ListBox>
				</DropRegion>
			)}

			{isDragging && <NewGroupDropZone />}

			{overlaysNode}
		</div>
	);
}
