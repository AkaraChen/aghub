import {
	CommandLineIcon,
	GlobeAltIcon,
	StarIcon as StarIconSolid,
} from "@heroicons/react/24/solid";
import { Label, ListBox } from "@heroui/react";
import { memo, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentIcons } from "./agent-icons";
import { useFavorites } from "../hooks/use-favorites";
import { useListSelection } from "../hooks/use-list-selection";
import type { McpSectionGroup, McpSections } from "../hooks/use-mcp-sections";
import type { ResourceActionIntents } from "../hooks/use-resource-actions";
import { useResourceActions } from "../hooks/use-resource-actions";
import { useMcpGroups } from "../hooks/use-resource-groups";
import { dragSelectionPayload } from "../lib/drag-payload";
import type { ResourceGroup } from "../lib/store";
import { viewTransitionName } from "../lib/view-transition";
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

type McpGroup = McpSectionGroup;

type MenuTarget =
	| { type: "items" }
	| { type: "custom-group"; group: ResourceGroup; memberKeys: string[] };

interface McpRowBodyProps {
	group: McpGroup;
	starred: boolean;
	getDragKeys: (key: string) => string[];
	onShiftPress: (key: string) => string[] | undefined;
	onOpenMenu: (event: React.MouseEvent, key: string) => void;
}

/**
 * A row's content behind a memo boundary — see SkillRowBody: stable
 * callbacks keep a selection change from rebuilding every row.
 */
const McpRowBody = memo(function McpRowBody({
	group,
	starred,
	getDragKeys,
	onShiftPress,
	onOpenMenu,
}: McpRowBodyProps) {
	const Icon =
		group.transport.type === "stdio" ? CommandLineIcon : GlobeAltIcon;
	return (
		<DraggableItemBody
			dragId={`item:${group.mergeKey}`}
			getKeys={() => getDragKeys(group.mergeKey)}
			onContextMenu={(event) => onOpenMenu(event, group.mergeKey)}
			onShiftPress={() => onShiftPress(group.mergeKey)}
		>
			<div className="relative inline-flex size-4 shrink-0 items-center justify-center">
				<Icon className="size-4" />
				{starred && (
					<StarIconSolid className="absolute -bottom-1 -left-1 size-2.5 text-warning" />
				)}
			</div>
			<Label className="flex-1 truncate">{group.items[0].name}</Label>
			<AgentIcons items={group.items} />
		</DraggableItemBody>
	);
});

interface McpListProps {
	/** The derivation pipeline's output — owned by the page (or wrapper)
	 * so select-all and the list agree on what is visible. */
	sections: McpSections;
	selectedKeys: Set<string>;
	onSelectionChange: (keys: Set<string>) => void;
	isMultiSelectMode?: boolean;
	/** Dialog intents owned by the page (delete/transfer/agents/new group) */
	intents: ResourceActionIntents;
	/** The auto-seeded initial selection (first click commits, not cancels) */
	seedKey?: string | null;
}

export function McpList({
	sections,
	selectedKeys,
	onSelectionChange,
	isMultiSelectMode = false,
	intents,
	seedKey,
}: McpListProps) {
	const { t } = useTranslation();
	const {
		customSections,
		unassignedGroups,
		orderedEntries,
		toggleCollapsed,
		isExpanded,
	} = sections;

	const { isMcpStarred, setMcpsStarred } = useFavorites();
	const { renameGroup, deleteGroup } = useMcpGroups();

	const [renameTarget, setRenameTarget] = useState<ResourceGroup | null>(
		null,
	);
	const [deleteTarget, setDeleteTarget] = useState<ResourceGroup | null>(
		null,
	);

	const {
		createSelectionHandler,
		selectGroup,
		ensureSelected,
		selectRangeTo,
	} = useListSelection({
		orderedEntries,
		selectedKeys,
		onSelectionChange,
		isMultiSelectMode,
		seedKey,
	});

	const contextMenu = useContextMenu<MenuTarget>();
	const actions = useResourceActions({
		kind: "mcp",
		selectedKeys,
		intents,
	});

	// The header reflects its members: selected once every member is in
	// the selection, regardless of what else is selected elsewhere.
	const isGroupSelected = (memberKeys: string[]) =>
		memberKeys.length > 0 &&
		memberKeys.every((key) => selectedKeys.has(key));

	// Ref bridge for the memoized rows — see SkillList.
	const rowContextRef = useRef({
		selectedKeys,
		selectRangeTo,
		ensureSelected,
		openMenu: contextMenu.open,
	});
	rowContextRef.current = {
		selectedKeys,
		selectRangeTo,
		ensureSelected,
		openMenu: contextMenu.open,
	};

	const getDragKeys = useCallback(
		(key: string) =>
			dragSelectionPayload([key], rowContextRef.current.selectedKeys),
		[],
	);

	const handleRowShiftPress = useCallback((key: string) => {
		const row = rowContextRef.current;
		if (!row.selectedKeys.has(key)) return undefined;
		const range = row.selectRangeTo(key);
		return range ? dragSelectionPayload([key], range) : undefined;
	}, []);

	const openItemMenu = useCallback((event: React.MouseEvent, key: string) => {
		const row = rowContextRef.current;
		row.ensureSelected(key);
		row.openMenu(event, { type: "items" });
	}, []);

	// Stable render function for the dynamic collection — see SkillList.
	const renderMcpItem = useCallback(
		(group: McpGroup) => (
			<ListBox.Item
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
				<McpRowBody
					group={group}
					starred={isMcpStarred(group.mergeKey)}
					getDragKeys={getDragKeys}
					onShiftPress={handleRowShiftPress}
					onOpenMenu={openItemMenu}
				/>
			</ListBox.Item>
		),
		[isMcpStarred, getDragKeys, handleRowShiftPress, openItemMenu],
	);

	const renderSectionListBox = (label: string, sectionMcps: McpGroup[]) => (
		<ListBox
			aria-label={label}
			items={sectionMcps}
			dependencies={[renderMcpItem]}
			selectionMode="multiple"
			selectionBehavior="toggle"
			selectedKeys={selectedKeys}
			onSelectionChange={createSelectionHandler(
				sectionMcps.map((g) => g.mergeKey),
			)}
			className="p-2 pl-6"
		>
			{renderMcpItem}
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
								void setMcpsStarred(keys, true),
							onRename: setRenameTarget,
							onDelete: setDeleteTarget,
						})
					: resourceItemsMenu({ t, actions })}
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

	if (unassignedGroups.length === 0 && customSections.length === 0) {
		return (
			<p className="px-3 py-6 text-center text-sm text-muted">
				{t("noServersMatch")}
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
						isExpanded={isExpanded(`g:${section.group.id}`)}
						isSelected={isGroupSelected(memberKeys)}
						onToggleExpanded={() =>
							toggleCollapsed(`g:${section.group.id}`)
						}
						onSelectAll={() =>
							selectGroup(memberKeys, `g:${section.group.id}`)
						}
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
						items={unassignedGroups}
						dependencies={[renderMcpItem]}
						selectionMode="multiple"
						selectionBehavior="toggle"
						selectedKeys={selectedKeys}
						onSelectionChange={createSelectionHandler(
							unassignedGroups.map((g) => g.mergeKey),
						)}
						className="p-2"
					>
						{renderMcpItem}
					</ListBox>
				</DropRegion>
			)}

			<NewGroupDropZone />

			{overlaysNode}
		</div>
	);
}
