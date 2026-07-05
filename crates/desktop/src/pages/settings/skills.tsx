import { DndContext, DragOverlay } from "@dnd-kit/core";
import {
	ArrowPathIcon,
	BookOpenIcon,
	CheckCircleIcon,
	PlusIcon,
	RectangleStackIcon,
} from "@heroicons/react/24/solid";
import { Button, Dropdown, Kbd, Menu, Tooltip } from "@heroui/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BulkActionsPanel } from "../../components/bulk-actions-panel";
import { BulkDeleteDialog } from "../../components/bulk-delete-dialog";
import { CreateSkillPanel } from "../../components/create-skill-panel";
import { ImportSkillPanel } from "../../components/import-skill-panel";
import { ManageSkillAgentsDialog } from "../../components/manage-skill-agents-dialog";
import { GroupNameDialog } from "../../components/resource-group-dialogs";
import { ResourcePageToolbar } from "../../components/resource-page-toolbar";
import { TransferDialog } from "../../components/transfer-dialog";
import { useAgentFilter } from "../../hooks/use-agent-filter";
import { ContextMenu, useContextMenu } from "../../components/context-menu";
import { DragPreview, DropBoard } from "../../components/drop-board";
import { PanelTransition } from "../../components/panel-transition";
import { useListDnd } from "../../hooks/use-list-dnd";
import { useListKeyboard } from "../../hooks/use-list-keyboard";
import { SkillDetail } from "../../components/skill-detail";
import { SkillList } from "../../components/skill-list";
import type { SkillResponse } from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import { useSkillGroups } from "../../hooks/use-resource-groups";
import { cn } from "../../lib/utils";
import {
	globalSkillLockQueryOptions,
	skillListQueryOptions,
} from "../../requests/skills";

const GITHUB_PREFIX_REGEX = /^github\//;

export default function SkillsPage() {
	const { t } = useTranslation();
	const api = useApi();
	const {
		data: skills,
		refetch,
		isFetching,
	} = useSuspenseQuery({
		...skillListQueryOptions({ api, scope: "global" }),
	});
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedName, setSelectedName] = useQueryState("skill");
	const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
	const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
	const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
	const [isManageDialogOpen, setIsManageDialogOpen] = useState(false);
	const [createGroupKeys, setCreateGroupKeys] = useState<string[] | null>(
		null,
	);
	const { createGroup, assignMembers } = useSkillGroups();
	const { data: globalLock } = useQuery({
		...globalSkillLockQueryOptions({ api, enabled: true }),
	});

	const [panelMode, setPanelMode] = useState<"create" | "import" | null>(
		null,
	);

	const {
		agentId: agentFilter,
		setAgentId,
		filtered: filteredSkills,
	} = useAgentFilter(skills);

	const groupedSkills = useMemo(() => {
		const map = new Map<string, SkillResponse[]>();
		for (const skill of filteredSkills) {
			const existing = map.get(skill.name) ?? [];
			map.set(skill.name, [...existing, skill]);
		}
		return Array.from(map.entries()).map(([name, items]) => ({
			name,
			items,
			description: items.find((s) => s.description)?.description ?? "",
		}));
	}, [filteredSkills]);

	// Selection is the single source of truth — it drives the list
	// highlight, the detail panel, and bulk actions. Seed it with the
	// deep-linked or first skill so a detail shows on load; an empty
	// selection then unambiguously means "cancelled" and shows the
	// placeholder.
	const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => {
		const deepLinked = groupedSkills.some((g) => g.name === selectedName);
		const seed = deepLinked ? selectedName : groupedSkills[0]?.name;
		return seed ? new Set([seed]) : new Set();
	});

	const activeGroup = useMemo(() => {
		if (selectedKeys.size !== 1) return null;
		const [key] = selectedKeys;
		return groupedSkills.find((g) => g.name === key) ?? null;
	}, [selectedKeys, groupedSkills]);

	// 多选模式下被选中的所有 groups（用于批量删除）
	const selectedGroups = useMemo(() => {
		return groupedSkills.filter((g) => selectedKeys.has(g.name));
	}, [selectedKeys, groupedSkills]);

	const handleSelectionChange = (keys: Set<string>) => {
		setSelectedKeys(keys);
		// Mirror a single selection to the URL for deep-linking.
		setSelectedName(keys.size === 1 ? [...keys][0] : null);

		if (keys.size > 1 && !isMultiSelectMode) {
			setIsMultiSelectMode(true);
		}
		if (keys.size === 0 && isMultiSelectMode) {
			setIsMultiSelectMode(false);
		}
		setPanelMode(null);
	};

	// Leaving multi-select collapses to a single selection so a detail
	// shows again instead of the bulk panel.
	const handleToggleMultiSelect = () => {
		setIsMultiSelectMode((prev) => !prev);
		if (isMultiSelectMode) {
			const [first] = selectedKeys;
			handleSelectionChange(first ? new Set([first]) : new Set());
		}
	};

	const handleCreateSkill = () => {
		setSelectedKeys(new Set());
		setSelectedName(null);
		setPanelMode("create");
	};

	const handleImportSkill = () => {
		setSelectedKeys(new Set());
		setSelectedName(null);
		setPanelMode("import");
	};

	const actionIntents = {
		onRequestDelete: () => setIsBulkDeleteDialogOpen(true),
		onRequestAddToAgent: () => setIsManageDialogOpen(true),
		onRequestTransfer: () => setIsTransferDialogOpen(true),
		onRequestCreateGroup: () => setCreateGroupKeys([...selectedKeys]),
	};

	const isBulkSelection = selectedKeys.size >= 2;

	// The selection is exactly one source group: the bulk panel doubles
	// as the library detail with the source header on top.
	const sourceContext = useMemo(() => {
		if (!isBulkSelection || !globalLock) return null;
		const visibleNames = new Set(groupedSkills.map((g) => g.name));
		const bySource = new Map<
			string,
			{
				names: Set<string>;
				sourceType: string;
				sourceUrl?: string | null;
			}
		>();
		for (const entry of globalLock.skills) {
			if (!visibleNames.has(entry.name)) continue;
			const record = bySource.get(entry.source) ?? {
				names: new Set<string>(),
				sourceType: entry.sourceType,
				sourceUrl: entry.sourceUrl,
			};
			record.names.add(entry.name);
			bySource.set(entry.source, record);
		}
		for (const [source, record] of bySource) {
			if (
				record.names.size === selectedKeys.size &&
				[...selectedKeys].every((key) => record.names.has(key))
			) {
				const url =
					record.sourceUrl ??
					(record.sourceType === "github"
						? `https://github.com/${source.replace(GITHUB_PREFIX_REGEX, "")}`
						: null);
				return { title: source, url };
			}
		}
		return null;
	}, [isBulkSelection, globalLock, groupedSkills, selectedKeys]);

	// Roster badge: where each skill came from
	const sourceByName = useMemo(() => {
		const map = new Map<string, string>();
		for (const entry of globalLock?.skills ?? []) {
			map.set(entry.name, entry.source);
		}
		return map;
	}, [globalLock]);

	const { dndProps, draggedKeys, boardGroups, showBoardUngrouped } =
		useListDnd("skill", (keys) => setCreateGroupKeys(keys));

	const listPanelRef = useRef<HTMLDivElement>(null);
	useListKeyboard({
		containerRef: listPanelRef,
		allKeys: groupedSkills.map((g) => g.name),
		selectedKeys,
		onSelectionChange: handleSelectionChange,
		onRequestDelete: actionIntents.onRequestDelete,
		disabled: draggedKeys !== null,
	});

	// Blank-area interactions on the list panel: a click clears the
	// selection, a right-click opens the page menu. Rows and headers own
	// their events (their handlers stop propagation for the menu; the
	// click check skips anything interactive).
	const pageMenu = useContextMenu<null>();
	const isBlankTarget = (event: React.MouseEvent) =>
		!(event.target as HTMLElement).closest(
			'[role="option"], [role="button"], [role="menu"], button, input',
		);
	const panelStateKey = draggedKeys
		? "board"
		: (panelMode ??
			(isBulkSelection ? "bulk" : activeGroup ? "detail" : "empty"));

	return (
		<DndContext {...dndProps}>
			<div className="flex h-full flex-col">
				<ResourcePageToolbar
					agentFilter={{
						agentId: agentFilter,
						onChange: setAgentId,
					}}
					searchValue={searchQuery}
					onSearchChange={setSearchQuery}
					searchPlaceholder={t("searchSkills")}
					searchAriaLabel={t("searchSkills")}
				>
					<Tooltip delay={0}>
						<Tooltip.Trigger>
							<div
								role="button"
								tabIndex={0}
								className={cn(
									"flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-default hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40",
									isMultiSelectMode &&
										"bg-accent/10 text-accent",
								)}
								aria-label={
									isMultiSelectMode
										? t("doneSelecting")
										: t("multiSelect")
								}
								onClick={handleToggleMultiSelect}
								onKeyDown={(event) => {
									if (
										event.key !== "Enter" &&
										event.key !== " "
									) {
										return;
									}
									event.preventDefault();
									handleToggleMultiSelect();
								}}
							>
								{isMultiSelectMode ? (
									<CheckCircleIcon className="size-4" />
								) : (
									<RectangleStackIcon className="size-4" />
								)}
							</div>
						</Tooltip.Trigger>
						<Tooltip.Content>
							{isMultiSelectMode
								? t("doneSelecting")
								: t("multiSelect")}
						</Tooltip.Content>
					</Tooltip>
					<Dropdown>
						<Button
							isIconOnly
							variant="ghost"
							size="sm"
							className="shrink-0"
							aria-label={t("addSkill")}
						>
							<PlusIcon className="size-4" />
						</Button>
						<Dropdown.Popover placement="bottom end">
							<Dropdown.Menu
								onAction={(key) => {
									if (key === "create") {
										handleCreateSkill();
									} else if (key === "import") {
										handleImportSkill();
									} else if (key === "create-group") {
										setCreateGroupKeys([]);
									}
								}}
							>
								<Dropdown.Item
									id="create"
									textValue={t("createCustomSkill")}
								>
									{t("createCustomSkill")}
								</Dropdown.Item>
								<Dropdown.Item
									id="import"
									textValue={t("importFromFile")}
								>
									{t("importFromFile")}
								</Dropdown.Item>
								<Dropdown.Item
									id="create-group"
									textValue={t("createGroup")}
								>
									{t("createGroup")}
								</Dropdown.Item>
							</Dropdown.Menu>
						</Dropdown.Popover>
					</Dropdown>
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						className="shrink-0"
						aria-label={t("refreshSkills")}
						onPress={() => refetch()}
					>
						<ArrowPathIcon
							className={cn(
								"size-4",
								isFetching && "animate-spin",
							)}
						/>
					</Button>
				</ResourcePageToolbar>
				<div className="flex min-h-0 flex-1">
					{/* Skills List Panel */}
					<div
						ref={listPanelRef}
						className="relative flex w-80 shrink-0 flex-col border-r border-border"
						onClick={(event) => {
							if (isBlankTarget(event)) {
								handleSelectionChange(new Set());
							}
						}}
						onContextMenu={(event) => {
							if (isBlankTarget(event)) {
								pageMenu.open(event, null);
							}
						}}
					>
						{/* Skills List */}
						<SkillList
							skills={filteredSkills}
							selectedKeys={selectedKeys}
							searchQuery={searchQuery}
							onSelectionChange={handleSelectionChange}
							selectionMode="multiple"
							isMultiSelectMode={isMultiSelectMode}
							groupBySource={true}
							intents={actionIntents}
						/>
					</div>

					<div className="flex-1 overflow-hidden relative">
						<PanelTransition stateKey={panelStateKey}>
						{draggedKeys ? (
							<DropBoard
								count={draggedKeys.length}
								groups={boardGroups}
								showUngrouped={showBoardUngrouped}
							/>
						) : panelMode === "create" ? (
							<CreateSkillPanel
								onDone={() => setPanelMode(null)}
							/>
						) : panelMode === "import" ? (
							<ImportSkillPanel
								onDone={() => setPanelMode(null)}
							/>
						) : isBulkSelection ? (
							<BulkActionsPanel
								kind="skill"
								items={selectedGroups.map((g) => ({
									key: g.name,
									label: g.name,
									badge: sourceByName.get(g.name),
								}))}
								intents={actionIntents}
								sourceContext={sourceContext}
								matrixGroups={selectedGroups.map((g) => ({
									key: g.name,
									name: g.name,
									sourceAgent: g.items[0].agent ?? "claude",
									sourceScope:
										g.items[0].source === "project"
											? ("project" as const)
											: ("global" as const),
									installedAgents: g.items
										.map((item) => item.agent)
										.filter(
											(agent): agent is string =>
												agent != null,
										),
								}))}
								onDeselectAll={() =>
									handleSelectionChange(new Set())
								}
								onRemoveItem={(key) =>
									handleSelectionChange(
										new Set(
											[...selectedKeys].filter(
												(k) => k !== key,
											),
										),
									)
								}
								onInvertSelection={() =>
									handleSelectionChange(
										new Set(
											groupedSkills
												.map((g) => g.name)
												.filter(
													(name) =>
														!selectedKeys.has(
															name,
														),
												),
										),
									)
								}
							/>
						) : activeGroup ? (
							<SkillDetail group={activeGroup} />
						) : (
							<div className="flex h-full flex-col items-center justify-center gap-4">
								<div className="text-center">
									<p className="mb-2 text-sm text-muted">
										{t("selectSkill")}
									</p>
									<p className="text-xs text-muted">
										{t("emptyShortcutHint")}
									</p>
								</div>
							</div>
						)}
						</PanelTransition>

						<ContextMenu
							position={pageMenu.state?.position ?? null}
							onClose={pageMenu.close}
							aria-label={t("resourceActions")}
						>
							<Menu.Item
								id="select-all"
								textValue={t("selectAll")}
								onAction={() =>
									handleSelectionChange(
										new Set(
											groupedSkills.map((g) => g.name),
										),
									)
								}
							>
								<div className="flex w-full items-center gap-2">
									<span className="flex-1">
										{t("selectAll")}
									</span>
									<Kbd>⌘A</Kbd>
								</div>
							</Menu.Item>
							<Menu.Section>
								<Menu.Item
									id="page-create"
									textValue={t("createCustomSkill")}
									onAction={handleCreateSkill}
								>
									{t("createCustomSkill")}
								</Menu.Item>
								<Menu.Item
									id="page-import"
									textValue={t("importFromFile")}
									onAction={handleImportSkill}
								>
									{t("importFromFile")}
								</Menu.Item>
								<Menu.Item
									id="page-create-group"
									textValue={t("createGroup")}
									onAction={() => setCreateGroupKeys([])}
								>
									{t("createGroup")}
								</Menu.Item>
								<Menu.Item
									id="page-refresh"
									textValue={t("refreshSkills")}
									onAction={() => void refetch()}
								>
									{t("refreshSkills")}
								</Menu.Item>
							</Menu.Section>
						</ContextMenu>

						<BulkDeleteDialog
							isOpen={isBulkDeleteDialogOpen}
							onClose={() => setIsBulkDeleteDialogOpen(false)}
							groups={selectedGroups.map((g) => ({
								key: g.name,
								items: g.items,
							}))}
							onSuccess={() => {
								handleSelectionChange(new Set());
								refetch();
							}}
							resourceType="skill"
						/>
						<TransferDialog
							isOpen={isTransferDialogOpen}
							onClose={() => setIsTransferDialogOpen(false)}
							resourceType="skill"
							items={selectedGroups.map((g) => ({
								name: g.name,
								sourceAgent: g.items[0].agent ?? "claude",
							}))}
							sourceScope="global"
						/>
						<ManageSkillAgentsDialog
							groups={selectedGroups}
							isOpen={isManageDialogOpen}
							onClose={() => setIsManageDialogOpen(false)}
						/>
						<GroupNameDialog
							isOpen={createGroupKeys !== null}
							onClose={() => setCreateGroupKeys(null)}
							title={t("createGroup")}
							onSubmit={async (name) => {
								const created = await createGroup(name);
								if (
									createGroupKeys &&
									createGroupKeys.length > 0
								) {
									await assignMembers(
										createGroupKeys,
										created.id,
									);
								}
							}}
						/>
					</div>
				</div>
			</div>
			<DragOverlay dropAnimation={null}>
				{draggedKeys ? (
					<DragPreview
						label={draggedKeys[0] ?? ""}
						count={draggedKeys.length}
						icon={BookOpenIcon}
					/>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}
