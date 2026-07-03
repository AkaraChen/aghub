import {
	ArrowPathIcon,
	CheckCircleIcon,
	PlusIcon,
	RectangleStackIcon,
} from "@heroicons/react/24/solid";
import { Button, Dropdown, Tooltip } from "@heroui/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BulkActionsPanel } from "../../components/bulk-actions-panel";
import { BulkDeleteDialog } from "../../components/bulk-delete-dialog";
import { CreateMcpPanel } from "../../components/create-mcp-panel";
import { EditMcpPanel } from "../../components/edit-mcp-panel";
import { ImportMcpPanel } from "../../components/import-mcp-panel";
import { ManageAgentsDialog } from "../../components/manage-agents-dialog";
import { GroupNameDialog } from "../../components/resource-group-dialogs";
import { ResourcePageToolbar } from "../../components/resource-page-toolbar";
import { TransferDialog } from "../../components/transfer-dialog";
import { useAgentFilter } from "../../hooks/use-agent-filter";
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
	const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
		() => new Set(),
	);
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

	const activeGroup = useMemo(() => {
		if (selectedKey) {
			return groupedMcps.find((g) => g.mergeKey === selectedKey) ?? null;
		}
		return groupedMcps[0] ?? null;
	}, [selectedKey, groupedMcps]);

	// 多选模式下被选中的所有 groups（用于批量删除）
	const selectedGroups = useMemo(() => {
		return groupedMcps.filter((g) => selectedKeys.has(g.mergeKey));
	}, [selectedKeys, groupedMcps]);

	// ListBox 高亮用的 keys
	const effectiveSelectedKeys = useMemo(() => {
		if (selectedKeys.size > 0) return selectedKeys;
		if (activeGroup && !isMultiSelectMode) {
			return new Set([activeGroup.mergeKey]);
		}
		return new Set<string>();
	}, [selectedKeys, activeGroup, isMultiSelectMode]);

	const handleSelectionChange = (keys: Set<string>, clickedKey?: string) => {
		setSelectedKeys(keys);

		// A single selection always drives the detail panel, even when it
		// was reached by deselecting a multi-selection down to one item —
		// otherwise the detail would keep showing the previously selected
		// server while the list highlights a different one.
		if (keys.size === 1) {
			const only = [...keys][0];
			setSelectedKey(only);
			setPanel({ type: "detail", selectedKey: only });
		} else if (clickedKey && !isMultiSelectMode) {
			setSelectedKey(clickedKey);
			setPanel({ type: "detail", selectedKey: clickedKey });
		}

		if (keys.size > 1 && !isMultiSelectMode) {
			setIsMultiSelectMode(true);
		}
		if (keys.size === 0 && isMultiSelectMode) {
			setIsMultiSelectMode(false);
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
		setSelectedKey(mergeKey);
		setPanel({ type: "detail", selectedKey: mergeKey });
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

	return (
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
								isMultiSelectMode && "bg-accent/10 text-accent",
							)}
							aria-label={
								isMultiSelectMode
									? t("doneSelecting")
									: t("multiSelect")
							}
							onClick={() => {
								setIsMultiSelectMode((prev) => !prev);
								if (isMultiSelectMode) {
									handleSelectionChange(new Set());
								}
							}}
							onKeyDown={(event) => {
								if (
									event.key !== "Enter" &&
									event.key !== " "
								) {
									return;
								}
								event.preventDefault();
								setIsMultiSelectMode((prev) => !prev);
								if (isMultiSelectMode) {
									handleSelectionChange(new Set());
								}
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
						className={cn("size-4", isFetching && "animate-spin")}
					/>
				</Button>
			</ResourcePageToolbar>
			<div className="flex min-h-0 flex-1">
				{/* Servers List Panel */}
				<div className="relative flex w-80 shrink-0 flex-col border-r border-border">
					{/* Servers List */}
					<McpList
						mcps={filteredMcps}
						selectedKeys={effectiveSelectedKeys}
						searchQuery={searchQuery}
						onSelectionChange={handleSelectionChange}
						selectionMode="multiple"
						isMultiSelectMode={isMultiSelectMode}
						intents={actionIntents}
						onDropCreateGroup={(keys) => setCreateGroupKeys(keys)}
					/>
				</div>

				{/* Server Detail Panel */}
				<div className="flex-1 overflow-hidden relative">
					{isBulkSelection &&
						panel.type !== "create" &&
						panel.type !== "import" &&
						panel.type !== "edit" && (
							<BulkActionsPanel
								kind="mcp"
								items={selectedGroups.map((g) => ({
									key: g.mergeKey,
									label: g.items[0].name,
								}))}
								intents={actionIntents}
								onDeselectAll={() =>
									handleSelectionChange(new Set())
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
							if (createGroupKeys && createGroupKeys.length > 0) {
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
	);
}
