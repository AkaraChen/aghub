import { DndContext, DragOverlay } from "@dnd-kit/core";
import {
	ArrowPathIcon,
	CheckCircleIcon,
	PlusIcon,
	RectangleStackIcon,
	ServerIcon,
} from "@heroicons/react/24/solid";
import { Button, Dropdown, Tooltip } from "@heroui/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BulkActionsPanel } from "../../components/bulk-actions-panel";
import { BulkDeleteDialog } from "../../components/bulk-delete-dialog";
import { CreateMcpPanel } from "../../components/create-mcp-panel";
import { DragPreview, DropBoard } from "../../components/drop-board";
import { EditMcpPanel } from "../../components/edit-mcp-panel";
import { ImportMcpPanel } from "../../components/import-mcp-panel";
import { ManageAgentsDialog } from "../../components/manage-agents-dialog";
import { GroupNameDialog } from "../../components/resource-group-dialogs";
import { ResourcePageToolbar } from "../../components/resource-page-toolbar";
import { TransferDialog } from "../../components/transfer-dialog";
import { useAgentFilter } from "../../hooks/use-agent-filter";
import { useListDnd } from "../../hooks/use-list-dnd";
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
	| { type: "detail"; selectedKey: string }
	| { type: "create" }
	| { type: "import" }
	| { type: "edit"; selectedKey: string }
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
	const { createGroup, assignMembers } = useMcpGroups();

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
	const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => {
		const deepLinked = groupedMcps.some((g) => g.mergeKey === selectedKey);
		const seed = deepLinked ? selectedKey : groupedMcps[0]?.mergeKey;
		return seed ? new Set([seed]) : new Set();
	});

	const activeGroup = useMemo(() => {
		if (selectedKeys.size !== 1) return null;
		const [key] = selectedKeys;
		return groupedMcps.find((g) => g.mergeKey === key) ?? null;
	}, [selectedKeys, groupedMcps]);

	// 多选模式下被选中的所有 groups（用于批量删除）
	const selectedGroups = useMemo(() => {
		return groupedMcps.filter((g) => selectedKeys.has(g.mergeKey));
	}, [selectedKeys, groupedMcps]);

	const handleSelectionChange = (keys: Set<string>) => {
		setSelectedKeys(keys);
		const only = keys.size === 1 ? [...keys][0] : null;
		// Mirror a single selection to the URL for deep-linking.
		setSelectedKey(only);
		setPanel(
			only ? { type: "detail", selectedKey: only } : { type: "empty" },
		);

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

	const handleCreate = () => {
		setSelectedKeys(new Set());
		setSelectedKey(null);
		setPanel({ type: "create" });
	};

	const handleImport = () => {
		setSelectedKeys(new Set());
		setSelectedKey(null);
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

	const isBulkSelection = selectedKeys.size >= 2;

	const showDetail =
		panel.type !== "create" &&
		panel.type !== "import" &&
		panel.type !== "edit" &&
		!isBulkSelection;

	const { dndProps, draggedKeys, boardGroups, showBoardUngrouped } =
		useListDnd("mcp", (keys) => setCreateGroupKeys(keys));
	const dragPreviewLabel = draggedKeys?.[0]
		? (groupedMcps.find((g) => g.mergeKey === draggedKeys[0])?.items[0]
				.name ?? "")
		: "";

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
					searchPlaceholder={t("searchServers")}
					searchAriaLabel={t("searchServers")}
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
					<div className="relative flex w-80 shrink-0 flex-col border-r border-border">
						{/* Servers List */}
						<McpList
							mcps={filteredMcps}
							selectedKeys={selectedKeys}
							searchQuery={searchQuery}
							onSelectionChange={handleSelectionChange}
							selectionMode="multiple"
							isMultiSelectMode={isMultiSelectMode}
							intents={actionIntents}
						/>
					</div>

					{/* Server Detail Panel */}
					<div className="flex-1 overflow-hidden relative">
						{draggedKeys && (
							<div className="absolute inset-0 z-10 bg-surface">
								<DropBoard
									count={draggedKeys.length}
									groups={boardGroups}
									showUngrouped={showBoardUngrouped}
								/>
							</div>
						)}
						{isBulkSelection &&
							panel.type !== "create" &&
							panel.type !== "import" &&
							panel.type !== "edit" && (
								<BulkActionsPanel
									kind="mcp"
									items={selectedGroups.map((g) => ({
										key: g.mergeKey,
										label: g.items[0].name,
										badge: g.transport.type,
									}))}
									intents={actionIntents}
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
												groupedMcps
													.map((g) => g.mergeKey)
													.filter(
														(key) =>
															!selectedKeys.has(
																key,
															),
													),
											),
										)
									}
								/>
							)}
						{panel.type === "create" && (
							<CreateMcpPanel onDone={handlePanelDone} />
						)}
						{panel.type === "import" && (
							<ImportMcpPanel onDone={handlePanelDone} />
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
									setPanel({
										type: "edit",
										selectedKey: activeGroup.mergeKey,
									})
								}
							/>
						)}
						{showDetail && !activeGroup && !hasMcpCapableAgents && (
							<div className="flex h-full flex-col items-center justify-center gap-3">
								<p className="text-sm text-muted">
									{t("noTargetAgents")}
								</p>
							</div>
						)}
						{showDetail && !activeGroup && hasMcpCapableAgents && (
							<div className="flex h-full flex-col items-center justify-center gap-4">
								<div className="text-center">
									<p className="mb-2 text-sm text-muted">
										{t("selectServer")}
									</p>
									<p className="text-xs text-muted">
										{t("orCreateNew")}
									</p>
								</div>
								<Button onPress={handleCreate}>
									<PlusIcon className="mr-2 size-4" />
									{t("addMcpServer")}
								</Button>
							</div>
						)}

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
