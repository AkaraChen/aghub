import {
	ArrowDownTrayIcon,
	ArrowPathIcon,
	BookOpenIcon,
	CheckCircleIcon,
	CommandLineIcon,
	PlusIcon,
	RectangleStackIcon,
	ServerIcon,
} from "@heroicons/react/24/solid";
import {
	Button,
	Dropdown,
	Header,
	Label,
	Separator,
	Skeleton,
	Tooltip,
} from "@heroui/react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { McpResponse, SkillResponse } from "../lib/api-types";
import { cn, getMcpMergeKey } from "../lib/utils";
import { ListSearchHeader } from "./list-search-header";
import { McpList } from "./mcp-list";
import { MultiSelectFloatingBar } from "./multi-select-floating-bar";
import { ResourceSectionHeader } from "./resource-section-header";
import { SkillList } from "./skill-list";

interface UnifiedResourceListProps {
	mcps: McpResponse[];
	skills: SkillResponse[];
	selectedMcpKeys: Set<string>;
	selectedSkillKeys: Set<string>;
	onSelectionChange: (keys: Set<string>, type: "mcp" | "skill") => void;
	onCreateMcp: (type: "manual" | "import") => void;
	onCreateSkill: (type: "local" | "import") => void;
	onRefresh: () => void;
	isRefreshing?: boolean;
	isLoading?: boolean;
	searchQuery: string;
	onSearchChange: (query: string) => void;
	projectPath?: string;
	isMultiSelectMode?: boolean;
	onMultiSelectModeChange?: (value: boolean) => void;
	onDeleteSelected?: () => void;
}

const RESOURCE_SKELETON_KEYS = ["resource-1", "resource-2", "resource-3"];
const SECONDARY_SKELETON_KEYS = ["secondary-1", "secondary-2"];

function ResourceListSkeleton() {
	return (
		<>
			<ResourceSectionHeader
				title=""
				count={0}
				icon={
					<Skeleton className="size-3.5 rounded bg-surface-secondary" />
				}
			/>
			<div className="p-2 space-y-1">
				{RESOURCE_SKELETON_KEYS.map((key) => (
					<div
						key={key}
						className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
					>
						<Skeleton className="size-4 rounded bg-surface-secondary" />
						<Skeleton className="h-3 flex-1 rounded bg-surface-secondary" />
					</div>
				))}
			</div>
			<ResourceSectionHeader
				title=""
				count={0}
				icon={
					<Skeleton className="size-3.5 rounded bg-surface-secondary" />
				}
			/>
			<div className="p-2 space-y-1">
				{SECONDARY_SKELETON_KEYS.map((key) => (
					<div
						key={key}
						className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
					>
						<Skeleton className="size-4 rounded bg-surface-secondary" />
						<Skeleton className="h-3 flex-1 rounded bg-surface-secondary" />
					</div>
				))}
			</div>
		</>
	);
}

export function UnifiedResourceList({
	mcps,
	skills,
	selectedMcpKeys,
	selectedSkillKeys,
	onSelectionChange,
	onCreateMcp,
	onCreateSkill,
	onRefresh,
	isRefreshing = false,
	isLoading = false,
	searchQuery,
	onSearchChange,
	projectPath,
	isMultiSelectMode = false,
	onMultiSelectModeChange,
	onDeleteSelected,
}: UnifiedResourceListProps) {
	const { t } = useTranslation();

	const mergedMcpCount = useMemo(() => {
		const keys = new Set<string>();
		for (const mcp of mcps) {
			keys.add(getMcpMergeKey(mcp.transport));
		}
		return keys.size;
	}, [mcps]);

	const mergedSkillCount = useMemo(() => {
		const names = new Set<string>();
		for (const skill of skills) {
			names.add(skill.name);
		}
		return names.size;
	}, [skills]);

	const hasMcps = mcps.length > 0;
	const hasSkills = skills.length > 0;
	const hasAny = hasMcps || hasSkills;
	const totalCount = mergedMcpCount + mergedSkillCount;
	const selectedCount = selectedMcpKeys.size + selectedSkillKeys.size;

	const handleMcpSelectionChange = (keys: Set<string>) => {
		onSelectionChange(keys, "mcp");
	};

	const handleSkillSelectionChange = (keys: Set<string>) => {
		onSelectionChange(keys, "skill");
	};

	return (
		<div
			data-tour="project-resources"
			className="relative flex w-80 shrink-0 flex-col border-r border-border"
		>
			<div data-tour="project-search">
				<ListSearchHeader
					searchValue={searchQuery}
					onSearchChange={onSearchChange}
					placeholder={t("searchResources")}
					ariaLabel={t("searchResources")}
				>
					{onMultiSelectModeChange && (
						<Tooltip delay={0}>
							<Tooltip.Trigger>
								<div
									role="button"
									tabIndex={0}
									data-tour="project-multi-select"
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
										onMultiSelectModeChange(
											!isMultiSelectMode,
										);
									}}
									onKeyDown={(event) => {
										if (
											event.key !== "Enter" &&
											event.key !== " "
										) {
											return;
										}
										event.preventDefault();
										onMultiSelectModeChange(
											!isMultiSelectMode,
										);
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
					)}
					<Dropdown>
						<Button
							isIconOnly
							variant="ghost"
							size="sm"
							data-tour="project-add-resource"
							className="shrink-0"
							aria-label={t("add")}
						>
							<PlusIcon className="size-4" />
						</Button>
						<Dropdown.Popover placement="bottom end">
							<Dropdown.Menu
								onAction={(key) => {
									if (key === "mcp-manual")
										onCreateMcp("manual");
									else if (key === "mcp-import")
										onCreateMcp("import");
									else if (key === "skill-local")
										onCreateSkill("local");
									else if (key === "skill-import")
										onCreateSkill("import");
								}}
							>
								<Dropdown.Section>
									<Header>
										<div className="flex items-center gap-2 px-2 py-1.5">
											<ServerIcon className="size-4 text-muted" />
											<Label className="text-xs font-medium text-muted uppercase tracking-wider">
												{t("mcpServers")}
											</Label>
										</div>
									</Header>
									<Dropdown.Item
										id="mcp-manual"
										textValue={t("manualCreation")}
									>
										<div className="flex items-center gap-2 pl-6">
											<PlusIcon className="size-4" />
											<span>{t("manualCreation")}</span>
										</div>
									</Dropdown.Item>
									<Dropdown.Item
										id="mcp-import"
										textValue={t("importFromJson")}
									>
										<div className="flex items-center gap-2 pl-6">
											<ArrowDownTrayIcon className="size-4" />
											<span>{t("importFromJson")}</span>
										</div>
									</Dropdown.Item>
								</Dropdown.Section>

								<Separator />

								<Dropdown.Section>
									<Header>
										<div className="flex items-center gap-2 px-2 py-1.5">
											<BookOpenIcon className="size-4 text-muted" />
											<Label className="text-xs font-medium text-muted uppercase tracking-wider">
												{t("skills")}
											</Label>
										</div>
									</Header>
									<Dropdown.Item
										id="skill-local"
										textValue={t("createCustomSkill")}
									>
										<div className="flex items-center gap-2 pl-6">
											<CommandLineIcon className="size-4" />
											<span>
												{t("createCustomSkill")}
											</span>
										</div>
									</Dropdown.Item>
									<Dropdown.Item
										id="skill-import"
										textValue={t("importFromFile")}
									>
										<div className="flex items-center gap-2 pl-6">
											<ArrowDownTrayIcon className="size-4" />
											<span>{t("importFromFile")}</span>
										</div>
									</Dropdown.Item>
								</Dropdown.Section>
							</Dropdown.Menu>
						</Dropdown.Popover>
					</Dropdown>
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						className="shrink-0"
						aria-label={t("refreshResources")}
						onPress={onRefresh}
					>
						<ArrowPathIcon
							className={cn(
								"size-4",
								isRefreshing && "animate-spin",
							)}
						/>
					</Button>
				</ListSearchHeader>
			</div>

			<div className="flex-1 overflow-y-auto">
				{isLoading ? (
					<ResourceListSkeleton />
				) : (
					<>
						{hasMcps && (
							<>
								<ResourceSectionHeader
									title={t("mcpServers")}
									count={mergedMcpCount}
									icon={<ServerIcon className="size-3.5" />}
								/>
								<McpList
									mcps={mcps}
									selectedKeys={selectedMcpKeys}
									searchQuery={searchQuery}
									onSelectionChange={handleMcpSelectionChange}
									selectionMode="multiple"
									isMultiSelectMode={isMultiSelectMode}
								/>
							</>
						)}

						{hasSkills && (
							<>
								<ResourceSectionHeader
									title={t("skills")}
									count={mergedSkillCount}
									icon={<BookOpenIcon className="size-3.5" />}
								/>
								<SkillList
									skills={skills}
									selectedKeys={selectedSkillKeys}
									searchQuery={searchQuery}
									onSelectionChange={
										handleSkillSelectionChange
									}
									groupBySource={true}
									projectPath={projectPath}
									selectionMode="multiple"
									isMultiSelectMode={isMultiSelectMode}
								/>
							</>
						)}

						{!hasAny && (
							<div className="px-3 py-6 text-center">
								<p className="text-sm text-muted">
									{searchQuery
										? t("noResourcesMatch")
										: t("noProjectResources")}
								</p>
								{searchQuery && (
									<p className="mt-1 text-xs text-muted">
										&ldquo;{searchQuery}&rdquo;
									</p>
								)}
							</div>
						)}
					</>
				)}
			</div>

			{isMultiSelectMode && selectedCount > 0 && onDeleteSelected && (
				<MultiSelectFloatingBar
					selectedCount={selectedCount}
					totalCount={totalCount}
					onDelete={onDeleteSelected}
				/>
			)}
		</div>
	);
}
