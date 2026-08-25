import { DndContext, DragOverlay } from "@dnd-kit/core";
import {
	ArrowPathIcon,
	BookOpenIcon,
	PlusIcon,
} from "@heroicons/react/24/solid";
import { Button, Dropdown, Kbd, Menu } from "@heroui/react";
import {
	useQuery,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import {
	useCallback,
	useDeferredValue,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { matrixGroup } from "../../components/agent-coverage-matrix";
import { BulkActionsPanel } from "../../components/bulk-actions-panel";
import { BulkDeleteDialog } from "../../components/bulk-delete-dialog";
import { CreateSkillPanel } from "../../components/create-skill-panel";
import { LazyImportGithubSkillPanel } from "../../components/lazy-import-github-skill-panel";
import { ImportSkillPanel } from "../../components/import-skill-panel";
import { ManageSkillAgentsDialog } from "../../components/manage-skill-agents-dialog";
import { GroupNameDialog } from "../../components/resource-group-dialogs";
import { ResourcePageToolbar } from "../../components/resource-page-toolbar";
import { TransferDialog } from "../../components/transfer-dialog";
import { useAgentFilter } from "../../hooks/use-agent-filter";
import { ContextMenu, useContextMenu } from "../../components/context-menu";
import { MultiSelectToggle } from "../../components/multi-select-toggle";
import { DragPreview, DropBoard } from "../../components/drop-board";
import { PanelTransition } from "../../components/panel-transition";
import { useListDnd } from "../../hooks/use-list-dnd";
import { useListKeyboard } from "../../hooks/use-list-keyboard";
import { SkillDetail } from "../../components/skill-detail";
import { uniqueSkillSourcePaths } from "../../components/skill-detail-helpers";
import { SourceDetailPanel } from "../../components/source-detail-panel";
import {
	SkillList,
	type SkillCopyListStatus,
} from "../../components/skill-list";
import { useApi } from "../../hooks/use-api";
import { useAgentAvailability } from "../../hooks/use-agent-availability";
import { useSkillGroups } from "../../hooks/use-resource-groups";
import { useSkillPreferences } from "../../hooks/use-skill-preferences";
import { visibleEntryKeys } from "../../hooks/use-list-selection";
import { useSkillSections } from "../../hooks/use-skill-sections";
import { cn } from "../../lib/utils";
import {
	isUniversalSkillPath,
	skillSourceTargetId,
	skillTargetIds,
	UNIVERSAL_SKILL_TARGET_ID,
} from "../../lib/skill-targets";
import {
	globalSkillLockQueryOptions,
	invalidateSkillQueries,
	skillCopyStatusQueryOptions,
	skillListQueryOptions,
} from "../../requests/skills";

const GITHUB_PREFIX_REGEX = /^github\//;

export default function SkillsPage() {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const { allAgents } = useAgentAvailability();
	const { data: skills, isFetching } = useSuspenseQuery({
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
	const {
		createGroup,
		assignMembers,
		groups: customGroups,
		assignments: groupAssignments,
	} = useSkillGroups();
	const { data: globalLock } = useQuery({
		...globalSkillLockQueryOptions({ api, enabled: true }),
	});
	const { skillPreferences, skillPreferencesReady } = useSkillPreferences();
	const automaticallyCheckCopies =
		skillPreferencesReady &&
		skillPreferences.enabled &&
		skillPreferences.mode === "automatic" &&
		skillPreferences.warnOnConflicts;

	const [panelMode, setPanelMode] = useState<
		"create" | "import" | "update-source" | "import-github" | null
	>(null);

	// The library page: set when a source cluster row is clicked; any
	// selection change or blank-area escape drops back out of it.
	const [focusedSource, setFocusedSource] = useState<string | null>(null);
	const universalReaders = useMemo(
		() =>
			new Set(
				allAgents
					.filter((agent) =>
						agent.skills_paths.global_read.some(
							isUniversalSkillPath,
						),
					)
					.map((agent) => agent.id),
			),
		[allAgents],
	);
	const skillMatchesAgent = useCallback(
		(skill: (typeof skills)[number], agentId: string) => {
			const targets = skillTargetIds(skill);
			return (
				targets.has(agentId) ||
				(targets.has(UNIVERSAL_SKILL_TARGET_ID) &&
					universalReaders.has(agentId))
			);
		},
		[universalReaders],
	);

	const {
		agentId: agentFilter,
		setAgentId,
		filtered: filteredSkills,
	} = useAgentFilter(skills, skillMatchesAgent);

	// Selection is the single source of truth — it drives the list
	// highlight, the detail panel, and bulk actions. Seed it with the
	// deep-linked or first skill so a detail shows on load; an empty
	// selection then unambiguously means "cancelled" and shows the
	// placeholder.
	const [seedKey] = useState<string | null>(() => {
		// Pre-pipeline: dedup order matches the pipeline's grouping (first
		// occurrence), so names[0] is the first grouped skill.
		const names = filteredSkills.map((s) => s.name);
		const deepLinked = selectedName && names.includes(selectedName);
		return (deepLinked ? selectedName : names[0]) ?? null;
	});
	const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() =>
		seedKey ? new Set([seedKey]) : new Set<string>(),
	);

	// The list's derivation pipeline lives with the page so every consumer
	// of "what is visible" — the list itself, ⌘A, the blank-area menu's
	// Select All — reads the same answer.
	const sections = useSkillSections({
		skills: filteredSkills,
		searchQuery,
		selectedKeys,
	});
	const groupedSkills = sections.groupedByName;
	const allSkillGroups = useMemo(() => {
		const byName = new Map<string, typeof skills>();
		for (const skill of skills) {
			const existing = byName.get(skill.name) ?? [];
			byName.set(skill.name, [...existing, skill]);
		}
		return Array.from(byName.entries()).map(([name, items]) => ({
			name,
			items,
			description:
				items.find((item) => item.description)?.description ?? "",
		}));
	}, [skills]);
	const allSkillGroupsByName = useMemo(
		() => new Map(allSkillGroups.map((group) => [group.name, group])),
		[allSkillGroups],
	);
	const copyStatusRequest = useMemo(() => {
		const groups = allSkillGroups.flatMap((group) => {
			const sourcePaths = uniqueSkillSourcePaths(group.items);
			return sourcePaths.length > 1
				? [{ name: group.name, source_paths: sourcePaths }]
				: [];
		});
		return groups.length > 0
			? {
					groups,
					scope: "global",
					project_root: null,
				}
			: undefined;
	}, [allSkillGroups]);
	const { data: copyStatus, isError: isCopyStatusError } = useQuery(
		skillCopyStatusQueryOptions({
			api,
			request: copyStatusRequest,
			enabled: automaticallyCheckCopies,
		}),
	);
	const copyStatuses = useMemo(() => {
		const statuses = new Map<string, SkillCopyListStatus>();
		if (!automaticallyCheckCopies) return statuses;
		if (isCopyStatusError) {
			for (const group of copyStatusRequest?.groups ?? []) {
				statuses.set(group.name, "unknown");
			}
			return statuses;
		}
		for (const result of copyStatus?.results ?? []) {
			if (result.has_differences) {
				statuses.set(result.name, "conflict");
			} else if (result.unavailable > 0) {
				statuses.set(result.name, "unknown");
			}
		}
		return statuses;
	}, [
		automaticallyCheckCopies,
		copyStatus,
		copyStatusRequest,
		isCopyStatusError,
	]);
	const visibleKeys = useMemo(
		() => visibleEntryKeys(sections.orderedEntries),
		[sections.orderedEntries],
	);

	// An in-page navigation (global search) rewrites ?skill= without
	// remounting the page, so adopt it into the selection here. The mirror
	// write-back is skipped — the URL already holds the target.
	const [syncedName, setSyncedName] = useState(selectedName);
	if (selectedName !== syncedName) {
		setSyncedName(selectedName);
		if (
			selectedName &&
			groupedSkills.some((g) => g.name === selectedName) &&
			!(selectedKeys.size === 1 && selectedKeys.has(selectedName))
		) {
			setSelectedKeys(new Set([selectedName]));
			setFocusedSource(null);
			setPanelMode(null);
			setIsMultiSelectMode(false);
		}
	}

	// The right panel derives from a deferred copy of the selection: the
	// row highlight and the context menu commit at input priority, and the
	// heavier detail/bulk panel swap follows one non-blocking render later
	// — right-clicking an unselected row must not wait for a full detail
	// remount before the menu shows.
	const deferredSelectedKeys = useDeferredValue(selectedKeys);

	const activeGroup = useMemo(() => {
		if (deferredSelectedKeys.size !== 1) return null;
		const [key] = deferredSelectedKeys;
		const visibleGroup = groupedSkills.find((group) => group.name === key);
		const completeGroup = allSkillGroupsByName.get(key);
		if (!visibleGroup || !completeGroup) return visibleGroup ?? null;
		const visibleItems = new Set(visibleGroup.items);
		return {
			...visibleGroup,
			items: [
				...visibleGroup.items,
				...completeGroup.items.filter(
					(item) => !visibleItems.has(item),
				),
			],
		};
	}, [allSkillGroupsByName, deferredSelectedKeys, groupedSkills]);

	// 多选模式下被选中的所有 groups（用于批量删除）
	const selectedGroups = useMemo(() => {
		return groupedSkills.filter((g) => deferredSelectedKeys.has(g.name));
	}, [deferredSelectedKeys, groupedSkills]);

	const handleSelectionChange = (keys: Set<string>) => {
		setSelectedKeys(keys);
		setFocusedSource(null);
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

	// Route through handleSelectionChange so multi-select mode and the
	// library page reset with the selection; the panel opens after (same
	// batch, so its setPanelMode(null) is overwritten).
	const handleCreateSkill = () => {
		handleSelectionChange(new Set());
		setPanelMode("create");
	};

	const handleImportSkill = () => {
		handleSelectionChange(new Set());
		setPanelMode("import");
	};

	const handleImportGithub = () => {
		handleSelectionChange(new Set());
		setPanelMode("import-github");
	};

	const actionIntents = {
		onRequestDelete: () => setIsBulkDeleteDialogOpen(true),
		onRequestAddToAgent: () => setIsManageDialogOpen(true),
		onRequestTransfer: () => setIsTransferDialogOpen(true),
		onRequestCreateGroup: () => setCreateGroupKeys([...selectedKeys]),
	};

	const isBulkSelection = deferredSelectedKeys.size >= 2;

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
				record.names.size === deferredSelectedKeys.size &&
				[...deferredSelectedKeys].every((key) => record.names.has(key))
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
	}, [isBulkSelection, globalLock, groupedSkills, deferredSelectedKeys]);

	// Roster badge: where each skill came from
	const sourceByName = useMemo(() => {
		const map = new Map<string, string>();
		for (const entry of globalLock?.skills ?? []) {
			map.set(entry.name, entry.source);
		}
		return map;
	}, [globalLock]);

	// The roster groups by the list's own hierarchy: a custom group claims
	// its members before the source library does (use-skill-sections keeps
	// assigned members out of source clusters the same way). Only members
	// in neither are truly ungrouped.
	const customGroupNameByKey = useMemo(() => {
		const nameById = new Map(customGroups.map((g) => [g.id, g.name]));
		const map = new Map<string, string>();
		for (const [key, groupId] of Object.entries(groupAssignments)) {
			const name = nameById.get(groupId);
			if (name) map.set(key, name);
		}
		return map;
	}, [customGroups, groupAssignments]);

	const focusedSourceInfo = useMemo(() => {
		if (!focusedSource) return null;
		// groupedByName already matches the list's visibility (the pipeline
		// drops copies on disabled agents), so no member without a row.
		const byName = new Map(groupedSkills.map((g) => [g.name, g]));
		const members = (globalLock?.skills ?? [])
			.filter(
				(entry) =>
					entry.source === focusedSource && byName.has(entry.name),
			)
			.map((entry) => {
				const item = byName.get(entry.name)?.items[0];
				return {
					name: entry.name,
					description: item?.description ?? null,
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name));
		if (members.length === 0) return null;
		const entries = (globalLock?.skills ?? []).filter(
			(item) => item.source === focusedSource,
		);
		const entry = entries[0];
		const sourceType = entry?.sourceType ?? null;
		const url =
			entry?.sourceUrl ??
			(sourceType === "github"
				? `https://github.com/${focusedSource.replace(GITHUB_PREFIX_REGEX, "")}`
				: null);
		const installedAt = entries.map((e) => e.installedAt).sort()[0] ?? null;
		const updatedAt =
			entries
				.map((e) => e.updatedAt)
				.sort()
				.at(-1) ?? null;
		const matrixGroups = members.map((member) => {
			const items = byName.get(member.name)?.items ?? [];
			return matrixGroup(
				member.name,
				member.name,
				items[0] ? skillSourceTargetId(items[0]) : null,
				items.flatMap((item) => Array.from(skillTargetIds(item))),
			);
		});
		return {
			title: focusedSource,
			url,
			sourceType,
			members,
			installedAt,
			updatedAt,
			matrixGroups,
		};
	}, [focusedSource, globalLock, groupedSkills]);

	const { dndProps, draggedKeys, boardGroups, showBoardUngrouped } =
		useListDnd("skill", (keys) => setCreateGroupKeys(keys));

	// Shortcuts are scoped to the whole page (these pages hold a single
	// list), so Esc/Cmd+A work from the detail panel too — not only while
	// the pointer sits over the list column.
	const pageRef = useRef<HTMLDivElement>(null);
	useListKeyboard({
		containerRef: pageRef,
		// Visible keys only: ⌘A while a search or filter narrows the list
		// must not sweep in rows the user cannot see.
		allKeys: visibleKeys,
		selectedKeys,
		onSelectionChange: handleSelectionChange,
		onRequestDelete: actionIntents.onRequestDelete,
		onEscape: () => {
			if (!panelMode) return false;
			setPanelMode(null);
			return true;
		},
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
			(isBulkSelection
				? "bulk"
				: focusedSourceInfo
					? `source:${focusedSourceInfo.title}`
					: activeGroup
						? "detail"
						: "empty"));

	return (
		<DndContext {...dndProps}>
			<div ref={pageRef} className="flex h-full flex-col">
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
					<MultiSelectToggle
						isActive={isMultiSelectMode}
						onToggle={handleToggleMultiSelect}
					/>
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
									} else if (key === "import-github") {
										handleImportGithub();
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
									id="import-github"
									textValue={t("importFromGitRepository")}
								>
									{t("importFromGitRepository")}
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
						onPress={() => void invalidateSkillQueries(queryClient)}
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
						className={cn(
							"relative flex w-80 shrink-0 flex-col border-r border-border",
							// Mid-drag, rows must not react to the pointer: every
							// hover flip restyles the whole list. Drop targets
							// don't need hit-testing — collision is rect math.
							draggedKeys && "pointer-events-none",
						)}
						onClick={(event) => {
							if (isBlankTarget(event)) {
								if (panelMode) return;
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
							sections={sections}
							selectedKeys={selectedKeys}
							onSelectionChange={handleSelectionChange}
							isMultiSelectMode={isMultiSelectMode}
							showAuditStatus={true}
							intents={actionIntents}
							onSourceFocus={(source) => {
								// Focusing a library replaces whatever panel is
								// open — otherwise another library's update
								// panel (with its URL) would stay on screen.
								setFocusedSource(source);
								setPanelMode(null);
							}}
							seedKey={seedKey}
							copyStatuses={copyStatuses}
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
							) : panelMode === "import-github" ? (
								<LazyImportGithubSkillPanel
									onDone={() => setPanelMode(null)}
								/>
							) : panelMode === "update-source" ? (
								<LazyImportGithubSkillPanel
									initialUrl={
										focusedSourceInfo?.url ?? undefined
									}
									onDone={() => setPanelMode(null)}
								/>
							) : isBulkSelection ? (
								<BulkActionsPanel
									kind="skill"
									items={selectedGroups.map((g) => ({
										key: g.name,
										label: g.name,
										badge:
											customGroupNameByKey.get(g.name) ??
											sourceByName.get(g.name),
									}))}
									intents={actionIntents}
									sourceContext={sourceContext}
									matrixGroups={selectedGroups.map((g) => ({
										key: g.name,
										name: g.name,
										sourceAgent: skillSourceTargetId(
											g.items[0],
										),
										// Global-scope page
										sourceScope: "global" as const,
										installedAgents: Array.from(
											new Set(
												g.items.flatMap((item) =>
													Array.from(
														skillTargetIds(item),
													),
												),
											),
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
								/>
							) : focusedSourceInfo ? (
								<SourceDetailPanel
									title={focusedSourceInfo.title}
									url={focusedSourceInfo.url}
									sourceType={focusedSourceInfo.sourceType}
									members={focusedSourceInfo.members}
									installedAt={focusedSourceInfo.installedAt}
									updatedAt={focusedSourceInfo.updatedAt}
									matrixGroups={
										focusedSourceInfo.matrixGroups
									}
									onSelectAll={() =>
										handleSelectionChange(
											new Set(
												focusedSourceInfo.members.map(
													(m) => m.name,
												),
											),
										)
									}
									onSelectMember={(name) =>
										handleSelectionChange(new Set([name]))
									}
									onUpdate={() =>
										setPanelMode("update-source")
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
									handleSelectionChange(new Set(visibleKeys))
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
									onAction={() =>
										void invalidateSkillQueries(queryClient)
									}
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
								void invalidateSkillQueries(queryClient);
							}}
							resourceType="skill"
						/>
						<TransferDialog
							isOpen={isTransferDialogOpen}
							onClose={() => setIsTransferDialogOpen(false)}
							resourceType="skill"
							items={selectedGroups.map((g) => ({
								name: g.name,
								sourceAgent: skillSourceTargetId(g.items[0]),
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
