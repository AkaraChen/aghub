import { DndContext, DragOverlay } from "@dnd-kit/core";
import { ArrowPathIcon, PlusIcon, ServerIcon } from "@heroicons/react/24/solid";
import { Button, Dropdown, Kbd, Menu } from "@heroui/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { matrixGroup } from "../../components/agent-coverage-matrix";
import { BulkActionsPanel } from "../../components/bulk-actions-panel";
import { BulkDeleteDialog } from "../../components/bulk-delete-dialog";
import { CreateMcpPanel } from "../../components/create-mcp-panel";
import { ContextMenu, useContextMenu } from "../../components/context-menu";
import { MultiSelectToggle } from "../../components/multi-select-toggle";
import { DragPreview, DropBoard } from "../../components/drop-board";
import { PanelTransition } from "../../components/panel-transition";
import { EditMcpPanel } from "../../components/edit-mcp-panel";
import { ImportMcpPanel } from "../../components/import-mcp-panel";
import { ManageAgentsDialog } from "../../components/manage-agents-dialog";
import { GroupNameDialog } from "../../components/resource-group-dialogs";
import { ResourcePageToolbar } from "../../components/resource-page-toolbar";
import { TransferDialog } from "../../components/transfer-dialog";
import { useAgentFilter } from "../../hooks/use-agent-filter";
import { useListDnd } from "../../hooks/use-list-dnd";
import { useListKeyboard } from "../../hooks/use-list-keyboard";
import type { McpGroup } from "../../components/mcp-detail";
import { McpDetail } from "../../components/mcp-detail";
import { McpList } from "../../components/mcp-list";
import { useAgentAvailability } from "../../hooks/use-agent-availability";
import { useApi } from "../../hooks/use-api";
import { useMcpGroups } from "../../hooks/use-resource-groups";
import { supportsMcp } from "../../lib/agent-capabilities";
import { cn, getMcpMergeKey } from "../../lib/utils";
import { mcpListQueryOptions } from "../../requests/mcps";

type RightPanel =
	| { type: "detail" }
	| { type: "create" }
	| { type: "import" }
	| { type: "edit" }
	| { type: "empty" };

export default function MCPServersPage() {
	const { t } = useTranslation();
	const api = useApi();
	const {
		data: mcps,
		refetch,
		isFetching,
	} = useSuspenseQuery({
		...mcpListQueryOptions({ api, scope: "global" }),
	});
	const { availableAgents } = useAgentAvailability();
	const [searchQuery, setSearchQuery] = useState("");
	const [panel, setPanel] = useState<RightPanel>({ type: "empty" });
	const [selectedKey, setSelectedKey] = useQueryState("server");
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
	} = useMcpGroups();

	// Roster badge — the custom group a server belongs to (servers have no
	// source library, so this is the only grouping dimension here).
	const customGroupNameByKey = useMemo(() => {
		const nameById = new Map(customGroups.map((g) => [g.id, g.name]));
		const map = new Map<string, string>();
		for (const [key, groupId] of Object.entries(groupAssignments)) {
			const name = nameById.get(groupId);
			if (name) map.set(key, name);
		}
		return map;
	}, [customGroups, groupAssignments]);

	const hasMcpCapableAgents = useMemo(
		() =>
			availableAgents.some(
				(agent) => agent.isUsable && supportsMcp(agent),
			),
		[availableAgents],
	);

	const {
		agentId: agentFilter,
		setAgentId,
		filtered: filteredMcps,
	} = useAgentFilter(mcps);

	const groupedMcps = useMemo(() => {
		const map = new Map<string, McpGroup>();

		for (const mcp of filteredMcps) {
			const key = getMcpMergeKey(mcp.transport);
			const existing = map.get(key);
			if (existing) {
				existing.items.push(mcp);
			} else {
				map.set(key, {
					mergeKey: key,
					transport: mcp.transport,
					items: [mcp],
				});
			}
		}

		return Array.from(map.values());
	}, [filteredMcps]);

	// Selection is the single source of truth — it drives the list
	// highlight, the detail panel, and bulk actions. Seed it with the
	// deep-linked or first server so a detail shows on load; an empty
	// selection then unambiguously means "cancelled" and shows the
	// placeholder.
	const [seedKey] = useState<string | null>(() => {
		const deepLinked = groupedMcps.some((g) => g.mergeKey === selectedKey);
		return (deepLinked ? selectedKey : groupedMcps[0]?.mergeKey) ?? null;
	});
	const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() =>
		seedKey ? new Set([seedKey]) : new Set<string>(),
	);

	// An in-page navigation (global search) rewrites ?server= without
	// remounting the page, so adopt it into the selection here. The mirror
	// write-back is skipped — the URL already holds the target.
	const [syncedKey, setSyncedKey] = useState(selectedKey);
	if (selectedKey !== syncedKey) {
		setSyncedKey(selectedKey);
		if (
			selectedKey &&
			groupedMcps.some((g) => g.mergeKey === selectedKey) &&
			!(selectedKeys.size === 1 && selectedKeys.has(selectedKey))
		) {
			setSelectedKeys(new Set([selectedKey]));
			setPanel({ type: "detail" });
			setIsMultiSelectMode(false);
		}
	}

	// Deferred copy for the right panel — see SkillsPage: the highlight
	// and menu commit at input priority, the panel swap follows.
	const deferredSelectedKeys = useDeferredValue(selectedKeys);

	const activeGroup = useMemo(() => {
		if (deferredSelectedKeys.size !== 1) return null;
		const [key] = deferredSelectedKeys;
		return groupedMcps.find((g) => g.mergeKey === key) ?? null;
	}, [deferredSelectedKeys, groupedMcps]);

	// 多选模式下被选中的所有 groups（用于批量删除）
	const selectedGroups = useMemo(() => {
		return groupedMcps.filter((g) => deferredSelectedKeys.has(g.mergeKey));
	}, [deferredSelectedKeys, groupedMcps]);

	const handleSelectionChange = (keys: Set<string>) => {
		setSelectedKeys(keys);
		const only = keys.size === 1 ? [...keys][0] : null;
		// Mirror a single selection to the URL for deep-linking.
		setSelectedKey(only);
		setPanel(only ? { type: "detail" } : { type: "empty" });

		if (keys.size > 1 && !isMultiSelectMode) {
			setIsMultiSelectMode(true);
		}
		if (keys.size === 0 && isMultiSelectMode) {
			setIsMultiSelectMode(false);
		}
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

	// Route through handleSelectionChange so multi-select mode resets
	// with the selection; the panel opens after (same batch, so its
	// setPanel is overwritten).
	const handleCreate = () => {
		handleSelectionChange(new Set());
		setPanel({ type: "create" });
	};

	const handleImport = () => {
		handleSelectionChange(new Set());
		setPanel({ type: "import" });
	};

	const handlePanelDone = () => {
		setPanel({ type: "empty" });
	};

	const handleEditDone = (mergeKey: string) => {
		// An edit can change the transport hash and thus the mergeKey, so
		// move the selection (the source of truth) to the new key — not just
		// the URL/panel — or the detail would resolve to a stale key.
		handleSelectionChange(new Set([mergeKey]));
	};

	const actionIntents = {
		onRequestDelete: () => setIsBulkDeleteDialogOpen(true),
		onRequestAddToAgent: () => setIsManageDialogOpen(true),
		onRequestTransfer: () => setIsTransferDialogOpen(true),
		onRequestCreateGroup: () => setCreateGroupKeys([...selectedKeys]),
	};

	const isBulkSelection = deferredSelectedKeys.size >= 2;

	const showDetail =
		panel.type !== "create" &&
		panel.type !== "import" &&
		panel.type !== "edit" &&
		!isBulkSelection;

	const { dndProps, draggedKeys, boardGroups, showBoardUngrouped } =
		useListDnd("mcp", (keys) => setCreateGroupKeys(keys));

	// Shortcuts are scoped to the whole page (these pages hold a single
	// list), so Esc/Cmd+A work from the detail panel too — not only while
	// the pointer sits over the list column.
	const pageRef = useRef<HTMLDivElement>(null);
	useListKeyboard({
		containerRef: pageRef,
		allKeys: groupedMcps.map((g) => g.mergeKey),
		selectedKeys,
		onSelectionChange: handleSelectionChange,
		onRequestDelete: actionIntents.onRequestDelete,
		onEscape: () => {
			if (
				panel.type !== "create" &&
				panel.type !== "import" &&
				panel.type !== "edit"
			)
				return false;
			const [only] = selectedKeys;
			setPanel(
				only && selectedKeys.size === 1
					? { type: "detail" }
					: { type: "empty" },
			);
			return true;
		},
		disabled: draggedKeys !== null,
	});

	// Blank-area interactions on the list panel: a click clears the
	// selection, a right-click opens the page menu.
	const pageMenu = useContextMenu<null>();
	const isBlankTarget = (event: React.MouseEvent) =>
		!(event.target as HTMLElement).closest(
			'[role="option"], [role="button"], [role="menu"], button, input',
		);
	const panelStateKey = draggedKeys
		? "board"
		: isBulkSelection
			? "bulk"
			: panel.type === "detail" || panel.type === "empty"
				? activeGroup
					? "detail"
					: "empty"
				: panel.type;
	const dragPreviewLabel = draggedKeys?.[0]
		? (groupedMcps.find((g) => g.mergeKey === draggedKeys[0])?.items[0]
				.name ?? "")
		: "";

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
					searchPlaceholder={t("searchServers")}
					searchAriaLabel={t("searchServers")}
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
							data-tour="mcp-add"
							className="shrink-0"
							aria-label={t("addMcpServer")}
							isDisabled={!hasMcpCapableAgents}
						>
							<PlusIcon className="size-4" />
						</Button>
						<Dropdown.Popover placement="bottom end">
							<Dropdown.Menu
								onAction={(key) => {
									if (key === "manual") {
										handleCreate();
									} else if (key === "import") {
										handleImport();
									} else if (key === "create-group") {
										setCreateGroupKeys([]);
									}
								}}
							>
								<Dropdown.Item
									id="manual"
									textValue={t("manualCreation")}
								>
									{t("manualCreation")}
								</Dropdown.Item>
								<Dropdown.Item
									id="import"
									textValue={t("importFromJson")}
								>
									{t("importFromJson")}
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
						aria-label={t("refreshServers")}
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
					{/* Servers List Panel */}
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
								if (
									panel.type === "create" ||
									panel.type === "import" ||
									panel.type === "edit"
								)
									return;
								handleSelectionChange(new Set());
							}
						}}
						onContextMenu={(event) => {
							if (isBlankTarget(event)) {
								pageMenu.open(event, null);
							}
						}}
					>
						{/* Servers List */}
						<McpList
							mcps={filteredMcps}
							selectedKeys={selectedKeys}
							searchQuery={searchQuery}
							onSelectionChange={handleSelectionChange}
							isMultiSelectMode={isMultiSelectMode}
							intents={actionIntents}
							seedKey={seedKey}
						/>
					</div>

					{/* Server Detail Panel */}
					<div className="flex-1 overflow-hidden relative">
						<PanelTransition stateKey={panelStateKey}>
							{draggedKeys ? (
								<DropBoard
									count={draggedKeys.length}
									groups={boardGroups}
									showUngrouped={showBoardUngrouped}
								/>
							) : (
								<>
									{isBulkSelection &&
										panel.type !== "create" &&
										panel.type !== "import" &&
										panel.type !== "edit" && (
											<BulkActionsPanel
												kind="mcp"
												items={selectedGroups.map(
													(g) => ({
														key: g.mergeKey,
														label: g.items[0].name,
														badge: customGroupNameByKey.get(
															g.mergeKey,
														),
													}),
												)}
												intents={actionIntents}
												matrixGroups={selectedGroups.map(
													(g) =>
														matrixGroup(
															g.mergeKey,
															g.items[0].name,
															g.items[0].agent,
															g.items.map(
																(item) =>
																	item.agent,
															),
														),
												)}
												onDeselectAll={() =>
													handleSelectionChange(
														new Set(),
													)
												}
												onRemoveItem={(key) =>
													handleSelectionChange(
														new Set(
															[
																...selectedKeys,
															].filter(
																(k) =>
																	k !== key,
															),
														),
													)
												}
											/>
										)}
									{panel.type === "create" && (
										<CreateMcpPanel
											onDone={handlePanelDone}
										/>
									)}
									{panel.type === "import" && (
										<ImportMcpPanel
											onDone={handlePanelDone}
										/>
									)}
									{panel.type === "edit" && activeGroup && (
										<EditMcpPanel
											key={activeGroup.mergeKey}
											group={activeGroup}
											onDone={handleEditDone}
										/>
									)}
									{showDetail && activeGroup && (
										<McpDetail
											group={activeGroup}
											onEdit={() =>
												setPanel({ type: "edit" })
											}
										/>
									)}
									{showDetail &&
										!activeGroup &&
										!hasMcpCapableAgents && (
											<div className="flex h-full flex-col items-center justify-center gap-3">
												<p className="text-sm text-muted">
													{t("noTargetAgents")}
												</p>
											</div>
										)}
									{showDetail &&
										!activeGroup &&
										hasMcpCapableAgents && (
											<div className="flex h-full flex-col items-center justify-center gap-4">
												<div className="text-center">
													<p className="mb-2 text-sm text-muted">
														{t("selectServer")}
													</p>
													<p className="mb-2 text-xs text-muted">
														{t("orCreateNew")}
													</p>
													<p className="text-xs text-muted">
														{t("emptyShortcutHint")}
													</p>
												</div>
												<Button onPress={handleCreate}>
													<PlusIcon className="mr-2 size-4" />
													{t("addMcpServer")}
												</Button>
											</div>
										)}
								</>
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
											groupedMcps.map((g) => g.mergeKey),
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
									textValue={t("manualCreation")}
									onAction={handleCreate}
								>
									{t("manualCreation")}
								</Menu.Item>
								<Menu.Item
									id="page-import"
									textValue={t("importFromJson")}
									onAction={handleImport}
								>
									{t("importFromJson")}
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
									textValue={t("refreshServers")}
									onAction={() => void refetch()}
								>
									{t("refreshServers")}
								</Menu.Item>
							</Menu.Section>
						</ContextMenu>

						<BulkDeleteDialog
							isOpen={isBulkDeleteDialogOpen}
							onClose={() => setIsBulkDeleteDialogOpen(false)}
							groups={selectedGroups.map((g) => ({
								key: g.mergeKey,
								items: g.items,
							}))}
							onSuccess={() => {
								handleSelectionChange(new Set());
								refetch();
							}}
							resourceType="mcp"
						/>
						<TransferDialog
							isOpen={isTransferDialogOpen}
							onClose={() => setIsTransferDialogOpen(false)}
							resourceType="mcp"
							items={selectedGroups.map((g) => ({
								name: g.items[0].name,
								sourceAgent: g.items[0].agent ?? "claude",
								transport: g.items[0].transport,
							}))}
							sourceScope="global"
						/>
						<ManageAgentsDialog
							groups={selectedGroups}
							isOpen={isManageDialogOpen}
							onClose={() => setIsManageDialogOpen(false)}
							requiredCapabilities={["mcp"]}
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
						label={dragPreviewLabel}
						count={draggedKeys.length}
						icon={ServerIcon}
					/>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}
