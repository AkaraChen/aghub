import {
	BookOpenIcon,
	StarIcon as StarIconSolid,
} from "@heroicons/react/24/solid";
import { useDndContext } from "@dnd-kit/core";
import { Label, ListBox, Spinner } from "@heroui/react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SkillResponse } from "../generated/dto";
import { AgentIcons } from "./agent-icons";
import { useFavorites } from "../hooks/use-favorites";
import { useListSelection } from "../hooks/use-list-selection";
import type { ResourceActionIntents } from "../hooks/use-resource-actions";
import { useResourceActions } from "../hooks/use-resource-actions";
import { useSkillGroups } from "../hooks/use-resource-groups";
import type { SkillGroup } from "../hooks/use-skill-sections";
import { useSkillSections } from "../hooks/use-skill-sections";
import { dragSelectionPayload } from "../lib/drag-payload";
import type { ResourceGroup } from "../lib/store";
import { cn } from "../lib/utils";
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

type MenuTarget =
	| { type: "items"; sourceUrl?: string | null }
	| { type: "custom-group"; group: ResourceGroup; memberKeys: string[] };

interface SkillListProps {
	skills: SkillResponse[];
	selectedKeys: Set<string>;
	searchQuery: string;
	onSelectionChange: (keys: Set<string>) => void;
	projectPath?: string;
	isMultiSelectMode?: boolean;
	/** Dialog intents owned by the page (delete/transfer/agents/new group) */
	intents: ResourceActionIntents;
	/** A source cluster row was clicked — the page shows its library page */
	onSourceFocus?: (source: string) => void;
	/** The auto-seeded initial selection (first click commits, not cancels) */
	seedKey?: string | null;
}

export function SkillList({
	skills,
	selectedKeys,
	searchQuery,
	onSelectionChange,
	projectPath,
	isMultiSelectMode = false,
	intents,
	onSourceFocus,
	seedKey,
}: SkillListProps) {
	const { t } = useTranslation();
	const {
		customSections,
		looseEntries,
		orderedEntries,
		isGroupingLoading,
		toggleCollapsed,
		isExpanded,
	} = useSkillSections({ skills, searchQuery, selectedKeys, projectPath });

	const { isSkillStarred, setSkillsStarred } = useFavorites();
	const { renameGroup, deleteGroup } = useSkillGroups();

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

	const {
		createSelectionHandler,
		selectGroup,
		ensureSelected,
		ensureGroupSelected,
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
		kind: "skill",
		selectedKeys,
		intents,
	});

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
		source: string,
		sourceUrl: string | null,
	) => {
		ensureGroupSelected(memberKeys, `s:${source}`);
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
				onShiftPress={() => {
					if (!selectedKeys.has(skillGroup.name)) return undefined;
					const range = selectRangeTo(skillGroup.name);
					return range
						? dragSelectionPayload([skillGroup.name], range)
						: undefined;
				}}
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
			selectionMode="multiple"
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

	const hasItems = customSections.length > 0 || looseEntries.length > 0;
	if (!hasItems) {
		return (
			<p className="px-3 py-6 text-center text-sm text-muted">
				{t("noSkillsMatch")}
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
				selectionMode="multiple"
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
					// In multi-select mode the row is a selection surface:
					// clicking it toggles the whole library in or out, same
					// as meta-click.
					if (isMultiSelectMode) {
						selectGroup(memberKeys, `s:${sg.source}`);
						return;
					}
					// Browsing, not selecting: the click focuses the library
					// (its detail shows on the right) and toggles the rows.
					onSourceFocus?.(sg.source);
					toggleCollapsed(`s:${sg.source}`);
				}}
				onSelectAll={() => selectGroup(memberKeys, `s:${sg.source}`)}
				onContextMenu={(event) =>
					openSourceMenu(event, memberKeys, sg.source, sg.sourceUrl)
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
