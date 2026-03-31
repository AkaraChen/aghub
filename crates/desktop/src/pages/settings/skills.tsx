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
import { CreateSkillPanel } from "../../components/create-skill-panel";
import { ImportSkillPanel } from "../../components/import-skill-panel";
import { ListSearchHeader } from "../../components/list-search-header";
import { MultiSelectFloatingBar } from "../../components/multi-select-floating-bar";
import { SkillDetail } from "../../components/skill-detail";
import { SkillList } from "../../components/skill-list";
import { useSkills } from "../../hooks/use-skills";
import type { SkillResponse } from "../../lib/api-types";
import { cn } from "../../lib/utils";

export default function SkillsPage() {
	const { t } = useTranslation();
	const { data: skills, refetch, isFetching } = useSkills();
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedName, setSelectedName] = useQueryState("skill");
	const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
		() => new Set(),
	);
	const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
	const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);

	const [panelMode, setPanelMode] = useState<"create" | "import" | null>(
		null,
	);

	const groupedSkills = useMemo(() => {
		const map = new Map<string, SkillResponse[]>();
		for (const skill of skills) {
			const existing = map.get(skill.name) ?? [];
			map.set(skill.name, [...existing, skill]);
		}
		return Array.from(map.entries()).map(([name, items]) => ({
			name,
			items,
			description: items.find((s) => s.description)?.description ?? "",
		}));
	}, [skills]);

	const activeGroup = useMemo(() => {
		if (selectedName) {
			return groupedSkills.find((g) => g.name === selectedName) ?? null;
		}
		return groupedSkills[0] ?? null;
	}, [selectedName, groupedSkills]);

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

		if (clickedKey && !isMultiSelectMode) {
			setSelectedName(clickedKey);
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
		setPanelMode("create");
	};

	const handleImportSkill = () => {
		setSelectedKeys(new Set());
		setSelectedName(null);
		setPanelMode("import");
	};

	return (
		<div className="flex h-full">
			{/* Skills List Panel */}
			<div className="relative flex w-80 shrink-0 flex-col border-r border-border">
				<ListSearchHeader
					searchValue={searchQuery}
					onSearchChange={setSearchQuery}
					placeholder={t("searchSkills")}
					ariaLabel={t("searchSkills")}
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
				</ListSearchHeader>

				{/* Skills List */}
				<SkillList
					skills={skills}
					selectedKeys={effectiveSelectedKeys}
					searchQuery={searchQuery}
					onSelectionChange={handleSelectionChange}
					selectionMode="multiple"
					isMultiSelectMode={isMultiSelectMode}
					groupBySource={true}
				/>

				{isMultiSelectMode && selectedKeys.size > 0 && (
					<MultiSelectFloatingBar
						selectedCount={selectedKeys.size}
						totalCount={groupedSkills.length}
						onDelete={() => setIsBulkDeleteDialogOpen(true)}
					/>
				)}
			</div>

			<div className="flex-1 overflow-hidden relative">
				{panelMode === "create" ? (
					<CreateSkillPanel onDone={() => setPanelMode(null)} />
				) : panelMode === "import" ? (
					<ImportSkillPanel onDone={() => setPanelMode(null)} />
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
			</div>
		</div>
	);
}
