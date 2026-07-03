import {
	ArrowPathIcon,
	CheckCircleIcon,
	PlusIcon,
	RectangleStackIcon,
} from "@heroicons/react/24/solid";
import { Button, Dropdown, Tooltip } from "@heroui/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { useMemo, useState } from "react";
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
	const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
		() => new Set(),
	);
	// Set once the user clicks the selected item again to cancel: suppresses
	// the default fallback to the first skill so the empty placeholder shows.
	const [selectionCleared, setSelectionCleared] = useState(false);
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

	const activeGroup = useMemo(() => {
		if (selectedName) {
			return groupedSkills.find((g) => g.name === selectedName) ?? null;
		}
		if (selectionCleared) return null;
		return groupedSkills[0] ?? null;
	}, [selectedName, groupedSkills, selectionCleared]);

	// 多选模式下被选中的所有 groups（用于批量删除）
	const selectedGroups = useMemo(() => {
		return groupedSkills.filter((g) => selectedKeys.has(g.name));
	}, [selectedKeys, groupedSkills]);

	// ListBox 高亮用的 keys
	const effectiveSelectedKeys = useMemo(() => {
		if (selectedKeys.size > 0) return selectedKeys;
		if (activeGroup && !isMultiSelectMode) {
			return new Set([activeGroup.name]);
		}
		return new Set<string>();
	}, [selectedKeys, activeGroup, isMultiSelectMode]);

	const handleSelectionChange = (keys: Set<string>, clickedKey?: string) => {
		setSelectedKeys(keys);

		// A single selection always drives the detail panel, even when it
		// was reached by deselecting a multi-selection down to one item,
		// so the detail never lags behind the list highlight.
		if (keys.size === 1) {
			setSelectedName([...keys][0]);
			setSelectionCleared(false);
		} else if (keys.size === 0 && clickedKey) {
			// Clicking the selected item again cancels the selection: clear
			// the detail so the empty placeholder shows. Programmatic clears
			// (exiting multi-select, bulk deselect) carry no clickedKey and
			// keep the prior detail.
			setSelectedName(null);
			setSelectionCleared(true);
		} else if (clickedKey && !isMultiSelectMode) {
			setSelectedName(clickedKey);
			setSelectionCleared(false);
		}

		if (keys.size > 1 && !isMultiSelectMode) {
			setIsMultiSelectMode(true);
		}
		if (keys.size === 0 && isMultiSelectMode) {
			setIsMultiSelectMode(false);
		}
		setPanelMode(null);
	};

	const handleCreateSkill = () => {
		setSelectedKeys(new Set());
		setSelectedName(null);
		setSelectionCleared(false);
		setPanelMode("create");
	};

	const handleImportSkill = () => {
		setSelectedKeys(new Set());
		setSelectedName(null);
		setSelectionCleared(false);
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

	return (
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
						className={cn("size-4", isFetching && "animate-spin")}
					/>
				</Button>
			</ResourcePageToolbar>
			<div className="flex min-h-0 flex-1">
				{/* Skills List Panel */}
				<div className="relative flex w-80 shrink-0 flex-col border-r border-border">
					{/* Skills List */}
					<SkillList
						skills={filteredSkills}
						selectedKeys={effectiveSelectedKeys}
						committedKeys={selectedKeys}
						searchQuery={searchQuery}
						onSelectionChange={handleSelectionChange}
						selectionMode="multiple"
						isMultiSelectMode={isMultiSelectMode}
						groupBySource={true}
						intents={actionIntents}
						onDropCreateGroup={(keys) => setCreateGroupKeys(keys)}
					/>
				</div>

				<div className="flex-1 overflow-hidden relative">
					{panelMode === "create" ? (
						<CreateSkillPanel onDone={() => setPanelMode(null)} />
					) : panelMode === "import" ? (
						<ImportSkillPanel onDone={() => setPanelMode(null)} />
					) : isBulkSelection ? (
						<BulkActionsPanel
							kind="skill"
							items={selectedGroups.map((g) => ({
								key: g.name,
								label: g.name,
							}))}
							intents={actionIntents}
							sourceContext={sourceContext}
							onDeselectAll={() =>
								handleSelectionChange(new Set())
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
							</div>
						</div>
					)}

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
