import {
	BookOpenIcon,
	ExclamationTriangleIcon,
	QuestionMarkCircleIcon,
	ShieldExclamationIcon,
	StarIcon as StarIconSolid,
} from "@heroicons/react/24/solid";
import { Label, ListBox, Spinner } from "@heroui/react";
import { useQueries } from "@tanstack/react-query";
import { memo, type ReactNode, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentIcons } from "./agent-icons";
import type { AuditReportDto, VerdictDto } from "../generated/dto";
import { useApi } from "../hooks/use-api";
import { useAuditAcknowledgements } from "../hooks/use-audit-acknowledgements";
import { useFavorites } from "../hooks/use-favorites";
import { useListSelection } from "../hooks/use-list-selection";
import { useSkillAuditPreference } from "../hooks/use-skill-audit-preference";
import type { ResourceActionIntents } from "../hooks/use-resource-actions";
import { useResourceActions } from "../hooks/use-resource-actions";
import { useSkillGroups } from "../hooks/use-resource-groups";
import type {
	SkillGroup,
	SkillSectionEntry,
	SkillSections,
} from "../hooks/use-skill-sections";
import { dragSelectionPayload } from "../lib/drag-payload";
import type { ResourceGroup } from "../lib/store";
import { cn } from "../lib/utils";
import { viewTransitionName } from "../lib/view-transition";
import { skillAuditQueryOptions } from "../requests/skills";
import { ContextMenu, useContextMenu } from "./context-menu";
import { customGroupMenu, resourceItemsMenu } from "./resource-menu-items";
import { DraggableItemBody } from "./draggable-item-body";
import { groupDropId, UNGROUPED_DROP_ID } from "./list-dnd";
import { DeleteGroupDialog, GroupNameDialog } from "./resource-group-dialogs";
import { getInstalledSkillAuditPaths } from "./skill-detail-helpers";
import {
	DropRegion,
	NewGroupDropZone,
	ResourceGroupSection,
} from "./resource-group-section";

type MenuTarget =
	| { type: "items"; sourceUrl?: string | null }
	| { type: "custom-group"; group: ResourceGroup; memberKeys: string[] };

interface SkillRowBodyProps {
	skillGroup: SkillGroup;
	starred: boolean;
	copyStatus?: SkillCopyListStatus;
	verdict?: VerdictDto;
	getDragKeys: (name: string) => string[];
	onShiftPress: (name: string) => string[] | undefined;
	onOpenMenu: (event: React.MouseEvent, name: string) => void;
}

/**
 * A row's content behind a memo boundary: its props are the row's own
 * data plus identity-stable callbacks, so a selection change re-renders
 * only the rows whose data actually changed — not all ~N of them. The
 * selection highlight itself is react-aria's, propagated by the ListBox.
 */
const SkillRowBody = memo(function SkillRowBody({
	skillGroup,
	starred,
	copyStatus,
	verdict,
	getDragKeys,
	onShiftPress,
	onOpenMenu,
}: SkillRowBodyProps) {
	const { t } = useTranslation();
	return (
		<DraggableItemBody
			dragId={`item:${skillGroup.name}`}
			getKeys={() => getDragKeys(skillGroup.name)}
			onContextMenu={(event) => onOpenMenu(event, skillGroup.name)}
			onShiftPress={() => onShiftPress(skillGroup.name)}
		>
			<div className="relative inline-flex size-4 shrink-0 items-center justify-center">
				{verdict ? (
					<span
						role="img"
						className="inline-flex size-4 shrink-0"
						aria-label={t(
							verdict === "malicious"
								? "auditVerdictMalicious"
								: "auditVerdictSuspicious",
						)}
					>
						<ShieldExclamationIcon
							aria-hidden
							className={cn(
								"size-4",
								verdict === "malicious"
									? "text-danger"
									: "text-warning",
							)}
						/>
					</span>
				) : (
					<BookOpenIcon aria-hidden className="size-4 text-muted" />
				)}
				{starred && (
					<StarIconSolid
						aria-hidden
						className="absolute -bottom-1 -left-1 size-2.5 text-warning"
					/>
				)}
				{copyStatus === "conflict" && (
					<span
						role="img"
						aria-label={t("skillCopiesDiffer")}
						data-slot="skill-copy-conflict-indicator"
						className="absolute -right-1 -bottom-1 size-2.5 text-warning"
					>
						<ExclamationTriangleIcon
							aria-hidden
							className="size-full"
						/>
					</span>
				)}
				{copyStatus === "unknown" && (
					<span
						role="img"
						aria-label={t("skillCopyStatusUnknown")}
						data-slot="skill-copy-unknown-indicator"
						className="absolute -right-1 -bottom-1 size-2.5 text-muted"
					>
						<QuestionMarkCircleIcon
							aria-hidden
							className="size-full"
						/>
					</span>
				)}
			</div>
			<Label className="flex-1 truncate">{skillGroup.name}</Label>
			<AgentIcons items={skillGroup.items} overflowVariant="square" />
		</DraggableItemBody>
	);
});

export type SkillCopyListStatus = "conflict" | "unknown";

interface SkillListProps {
	/** The derivation pipeline's output — owned by the page (or wrapper)
	 * so select-all and the list agree on what is visible. */
	sections: SkillSections;
	selectedKeys: Set<string>;
	onSelectionChange: (keys: Set<string>) => void;
	isMultiSelectMode?: boolean;
	showAuditStatus?: boolean;
	/** Dialog intents owned by the page (delete/transfer/agents/new group) */
	intents: ResourceActionIntents;
	/** A source cluster row was clicked — the page shows its library page */
	onSourceFocus?: (source: string) => void;
	/** The auto-seeded initial selection (first click commits, not cancels) */
	seedKey?: string | null;
	/** Comparison state for skill names with more than one physical copy. */
	copyStatuses?: ReadonlyMap<string, SkillCopyListStatus>;
	/** Skill names that Codex owns and AGHub must not modify. */
	readOnlyKeys?: ReadonlySet<string>;
}

export const SkillList = memo(function SkillList({
	sections,
	selectedKeys,
	onSelectionChange,
	isMultiSelectMode = false,
	showAuditStatus = false,
	intents,
	onSourceFocus,
	seedKey,
	copyStatuses,
	readOnlyKeys = new Set(),
}: SkillListProps) {
	const { t } = useTranslation();
	const api = useApi();
	const { skillAuditEnabled, skillAuditReady } = useSkillAuditPreference();
	const {
		customSections,
		looseEntries,
		orderedEntries,
		isGroupingLoading,
		toggleCollapsed,
		isExpanded,
	} = sections;

	const { isSkillStarred, setSkillsStarred } = useFavorites();
	const { isAssessmentAcknowledged } = useAuditAcknowledgements();
	const { renameGroup, deleteGroup } = useSkillGroups();

	const [renameTarget, setRenameTarget] = useState<ResourceGroup | null>(
		null,
	);
	const [deleteTarget, setDeleteTarget] = useState<ResourceGroup | null>(
		null,
	);

	const auditPathsByName = new Map<string, Set<string>>();
	if (showAuditStatus && skillAuditReady && skillAuditEnabled) {
		const visibleGroups: SkillGroup[] = [];
		for (const section of customSections) {
			visibleGroups.push(...section.skills);
		}
		for (const entry of looseEntries) {
			if (entry.kind === "skill") {
				visibleGroups.push(entry.skill);
			} else {
				visibleGroups.push(...entry.group.skills);
			}
		}
		for (const group of visibleGroups) {
			const paths = getInstalledSkillAuditPaths(group.items);
			if (paths.length === 0) continue;
			const groupedPaths =
				auditPathsByName.get(group.name) ?? new Set<string>();
			for (const path of paths) {
				groupedPaths.add(path);
			}
			auditPathsByName.set(group.name, groupedPaths);
		}
	}
	const auditTargets = Array.from(auditPathsByName, ([name, paths]) => ({
		name,
		paths: [...paths].sort(),
	}));
	// Stable combine output prevents selection changes from updating every row.
	const auditByName = useQueries({
		queries: auditTargets.map((target) =>
			skillAuditQueryOptions({
				api,
				paths: target.paths,
				staleTime: 5 * 60_000,
			}),
		),
		combine: (results) => {
			const map: Record<string, AuditReportDto> = {};
			results.forEach((result, index) => {
				const report = result.data;
				if (report && report.verdict !== "benign") {
					map[auditTargets[index].name] = report;
				}
			});
			return map;
		},
	});

	const getRowVerdict = useCallback(
		(name: string): VerdictDto | undefined => {
			const report = auditByName[name];
			return report &&
				!isAssessmentAcknowledged(name, report.assessment_digest)
				? report.verdict
				: undefined;
		},
		[auditByName, isAssessmentAcknowledged],
	);

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
		canWrite: [...selectedKeys].every((key) => !readOnlyKeys.has(key)),
	});

	// The header reflects its members: selected once every member is in
	// the selection, regardless of what else is selected elsewhere.
	const isGroupSelected = (memberKeys: string[]) =>
		memberKeys.length > 0 &&
		memberKeys.every((key) => selectedKeys.has(key));

	// Rows sit behind SkillRowBody's memo boundary, so the callbacks they
	// receive must keep their identity across renders while still seeing
	// the live selection — a ref bridge, same pattern as the frozen drag
	// payload in DraggableItemBody.
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
		(name: string) =>
			dragSelectionPayload([name], rowContextRef.current.selectedKeys),
		[],
	);

	const handleRowShiftPress = useCallback((name: string) => {
		const row = rowContextRef.current;
		if (!row.selectedKeys.has(name)) return undefined;
		const range = row.selectRangeTo(name);
		return range ? dragSelectionPayload([name], range) : undefined;
	}, []);

	const openItemMenu = useCallback((event: React.MouseEvent, key: string) => {
		const row = rowContextRef.current;
		row.ensureSelected(key);
		row.openMenu(event, { type: "items" });
	}, []);

	const openGroupMenu = (
		event: React.MouseEvent,
		group: ResourceGroup,
		memberKeys: string[],
	) => {
		contextMenu.open(event, {
			type: "custom-group",
			group,
			memberKeys,
		});
	};

	const openSourceMenu = (
		event: React.MouseEvent,
		memberKeys: string[],
		sourceId: string,
		sourceUrl: string | null,
	) => {
		ensureGroupSelected(memberKeys, sourceId);
		contextMenu.open(event, { type: "items", sourceUrl });
	};

	// Stable render function: with `items`, react-aria caches each row's
	// element by item identity + this function, so a selection change
	// re-renders only the rows whose selected state flipped.
	const renderSkillItem = useCallback(
		(skillGroup: SkillGroup) => {
			const copyStatus = copyStatuses?.get(skillGroup.name);
			return (
				<ListBox.Item
					id={skillGroup.name}
					textValue={skillGroup.name}
					aria-label={skillGroup.name}
					className="data-selected:bg-surface transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]"
					style={{
						viewTransitionName: viewTransitionName(
							"vts",
							skillGroup.name,
						),
					}}
				>
					<SkillRowBody
						skillGroup={skillGroup}
						starred={isSkillStarred(skillGroup.name)}
						copyStatus={copyStatus}
						verdict={getRowVerdict(skillGroup.name)}
						getDragKeys={getDragKeys}
						onShiftPress={handleRowShiftPress}
						onOpenMenu={openItemMenu}
					/>
				</ListBox.Item>
			);
		},
		[
			isSkillStarred,
			copyStatuses,
			getRowVerdict,
			getDragKeys,
			handleRowShiftPress,
			openItemMenu,
		],
	);

	const renderSectionListBox = (
		label: string,
		sectionSkills: SkillGroup[],
		dense = false,
	) => (
		<ListBox
			aria-label={label}
			items={sectionSkills}
			dependencies={[renderSkillItem]}
			selectionMode="multiple"
			selectionBehavior="toggle"
			selectedKeys={selectedKeys}
			onSelectionChange={createSelectionHandler(
				sectionSkills.map((s) => s.name),
			)}
			className={cn(dense ? "px-2 pt-2 pb-0" : "p-2")}
		>
			{renderSkillItem}
		</ListBox>
	);

	const renderEntryNodes = (
		entries: SkillSectionEntry[],
		keyPrefix: string,
		listLabel: string,
		isNested: boolean,
	) => {
		const nodes: ReactNode[] = [];
		let skillRun: SkillGroup[] = [];
		const flushSkillRun = () => {
			if (skillRun.length === 0) return;
			const runKeys = skillRun.map((skill) => skill.name);
			nodes.push(
				<ListBox
					key={`${keyPrefix}:skills:${runKeys[0]}`}
					aria-label={listLabel}
					items={skillRun}
					dependencies={[renderSkillItem]}
					selectionMode="multiple"
					selectionBehavior="toggle"
					selectedKeys={selectedKeys}
					onSelectionChange={createSelectionHandler(runKeys)}
					className={isNested ? "px-2 pt-2 pb-0" : "px-2 py-1"}
				>
					{renderSkillItem}
				</ListBox>,
			);
			skillRun = [];
		};

		for (const entry of entries) {
			if (entry.kind === "skill") {
				skillRun.push(entry.skill);
				continue;
			}
			flushSkillRun();
			const sourceGroup = entry.group;
			const memberKeys = sourceGroup.skills.map((skill) => skill.name);
			const sourceSection = (
				<ResourceGroupSection
					key={entry.id}
					subtle
					title={sourceGroup.source}
					count={sourceGroup.skills.length}
					isExpanded={isExpanded(entry.id)}
					isSelected={isGroupSelected(memberKeys)}
					onToggleExpanded={() => toggleCollapsed(entry.id)}
					onRowClick={() => {
						if (isMultiSelectMode) {
							selectGroup(memberKeys, entry.id);
							return;
						}
						onSourceFocus?.(sourceGroup.source);
					}}
					onSelectAll={() => selectGroup(memberKeys, entry.id)}
					onContextMenu={(event) =>
						openSourceMenu(
							event,
							memberKeys,
							entry.id,
							sourceGroup.sourceUrl,
						)
					}
					dragId={`header:${entry.id}`}
					dragKeys={memberKeys}
					hasStarredMember={sourceGroup.skills.some((skill) =>
						isSkillStarred(skill.name),
					)}
				>
					{renderSectionListBox(
						sourceGroup.source,
						sourceGroup.skills,
						true,
					)}
				</ResourceGroupSection>
			);
			nodes.push(
				<div key={entry.id} className={isNested ? "pt-2" : undefined}>
					{sourceSection}
				</div>,
			);
		}
		flushSkillRun();
		return nodes;
	};

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
							canWrite:
								contextMenu.state.context.memberKeys.every(
									(key) => !readOnlyKeys.has(key),
								),
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

	const looseNodes = renderEntryNodes(looseEntries, "loose", "Skills", false);

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
						{renderEntryNodes(
							section.entries,
							`group:${section.group.id}`,
							section.group.name,
							true,
						)}
					</ResourceGroupSection>
				);
			})}

			{looseEntries.length > 0 && (
				<DropRegion id={UNGROUPED_DROP_ID}>{looseNodes}</DropRegion>
			)}

			<NewGroupDropZone />

			{overlaysNode}
		</div>
	);
});
