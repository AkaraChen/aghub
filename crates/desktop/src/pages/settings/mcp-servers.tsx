import {
	ArrowPathIcon,
	CheckCircleIcon,
	PlusIcon,
	RectangleStackIcon,
} from "@heroicons/react/24/solid";
import { Button, Dropdown, Tooltip } from "@heroui/react";
import { useQueryState } from "nuqs";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BulkDeleteDialog } from "../../components/bulk-delete-dialog";
import { CreateMcpPanel } from "../../components/create-mcp-panel";
import { EditMcpPanel } from "../../components/edit-mcp-panel";
import { ImportMcpPanel } from "../../components/import-mcp-panel";
import { ListSearchHeader } from "../../components/list-search-header";
import type { McpGroup } from "../../components/mcp-detail";
import { McpDetail } from "../../components/mcp-detail";
import { McpList } from "../../components/mcp-list";
import { MultiSelectFloatingBar } from "../../components/multi-select-floating-bar";
import { useAgentAvailability } from "../../hooks/use-agent-availability";
import { useMcps } from "../../hooks/use-mcps";
import { supportsMcp } from "../../lib/agent-capabilities";
import { cn, getMcpMergeKey } from "../../lib/utils";

type RightPanel =
	| { type: "detail"; selectedKey: string }
	| { type: "create" }
	| { type: "import" }
	| { type: "edit"; selectedKey: string }
	| { type: "empty" };

export default function MCPServersPage() {
	const { t } = useTranslation();
	const { data: mcps, refetch, isFetching } = useMcps();
	const { availableAgents } = useAgentAvailability();
	const [searchQuery, setSearchQuery] = useState("");
	const [panel, setPanel] = useState<RightPanel>({ type: "empty" });
	const [selectedKey, setSelectedKey] = useQueryState("server");
	const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
		() => new Set(),
	);
	const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
	const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);

	const hasMcpCapableAgents = useMemo(
		() =>
			availableAgents.some(
				(agent) => agent.isUsable && supportsMcp(agent),
			),
		[availableAgents],
	);

	const groupedMcps = useMemo(() => {
		const map = new Map<string, McpGroup>();

		for (const mcp of mcps) {
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
	}, [mcps]);

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

		if (clickedKey && !isMultiSelectMode) {
			setSelectedKey(clickedKey);
			setPanel({
				type: "detail",
				selectedKey: clickedKey,
			});
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
		setPanel({ type: "detail", selectedKey: mergeKey });
	};

	const showDetail =
		panel.type !== "create" &&
		panel.type !== "import" &&
		panel.type !== "edit";

	return (
		<div className="flex h-full">
			{/* Servers List Panel */}
			<div className="relative flex w-80 shrink-0 flex-col border-r border-border">
				<ListSearchHeader
					searchValue={searchQuery}
					onSearchChange={setSearchQuery}
					placeholder={t("searchServers")}
					ariaLabel={t("searchServers")}
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
				</ListSearchHeader>

				{/* Servers List */}
				<McpList
					mcps={mcps}
					selectedKeys={effectiveSelectedKeys}
					searchQuery={searchQuery}
					onSelectionChange={handleSelectionChange}
					selectionMode="multiple"
					isMultiSelectMode={isMultiSelectMode}
				/>

				{isMultiSelectMode && selectedKeys.size > 0 && (
					<MultiSelectFloatingBar
						selectedCount={selectedKeys.size}
						totalCount={groupedMcps.length}
						onDelete={() => setIsBulkDeleteDialogOpen(true)}
					/>
				)}
			</div>

			{/* Server Detail Panel */}
			<div className="flex-1 overflow-hidden relative">
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
						onDone={() => handleEditDone(activeGroup.mergeKey)}
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
			</div>
		</div>
	);
}
