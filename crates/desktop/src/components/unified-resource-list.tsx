import {
	ArrowDownTrayIcon,
	ArrowPathIcon,
	BookOpenIcon,
	CheckCircleIcon,
	CommandLineIcon,
	CpuChipIcon,
	PlusIcon,
	RectangleStackIcon,
	ServerIcon,
} from "@heroicons/react/24/solid";
import {
	Button,
	Dropdown,
	Header,
	Label,
	ListBox,
	Separator,
	Spinner,
	Tooltip,
} from "@heroui/react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { McpResponse, SkillResponse, SubAgentResponse } from "../generated/dto";
import { cn, getMcpMergeKey, getSubAgentMergeKey } from "../lib/utils";
import { ListSearchHeader } from "./list-search-header";
import { McpList } from "./mcp-list";
import { MultiSelectFloatingBar } from "./multi-select-floating-bar";
import { ResourceSectionHeader } from "./resource-section-header";
import { SkillList } from "./skill-list";

interface UnifiedResourceListProps {
	mcps: McpResponse[];
	skills: SkillResponse[];
	subAgents?: SubAgentResponse[];
	selectedMcpKeys: Set<string>;
	selectedSkillKeys: Set<string>;
	selectedSubAgentKeys?: Set<string>;
	onSelectionChange: (keys: Set<string>, type: "mcp" | "skill") => void;
	onSubAgentSelectionChange?: (key: string) => void;
	onCreateMcp: (type: "manual" | "import") => void;
	onCreateSkill: (type: "local" | "import" | "github") => void;
	onCreateSubAgent?: () => void;
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

export function UnifiedResourceList({
	mcps,
	skills,
	subAgents = [],
	selectedMcpKeys,
	selectedSkillKeys,
	selectedSubAgentKeys = new Set(),
	onSelectionChange,
	onSubAgentSelectionChange,
	onCreateMcp,
	onCreateSkill,
	onCreateSubAgent,
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

	const mergedSubAgentCount = useMemo(() => {
		const keys = new Set<string>();
		for (const agent of subAgents) {
			keys.add(getSubAgentMergeKey(agent));
		}
		return keys.size;
	}, [subAgents]);

	const groupedSubAgents = useMemo(() => {
		const map = new Map<string, SubAgentResponse[]>();
		for (const agent of subAgents) {
			const key = getSubAgentMergeKey(agent);
			const existing = map.get(key) ?? [];
			map.set(key, [...existing, agent]);
		}
		return Array.from(map.entries()).map(([mergeKey, items]) => ({
			mergeKey,
			items,
		}));
	}, [subAgents]);

	const filteredSubAgentGroups = useMemo(() => {
		if (!searchQuery) return groupedSubAgents;
		const q = searchQuery.toLowerCase();
		return groupedSubAgents.filter((g) =>
			g.items[0].name.toLowerCase().includes(q),
		);
	}, [groupedSubAgents, searchQuery]);

	const hasMcps = mcps.length > 0;
	const hasSkills = skills.length > 0;
	const hasSubAgents = subAgents.length > 0;
	const hasAny = hasMcps || hasSkills || hasSubAgents;
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
									else if (key === "skill-github")
										onCreateSkill("github");
									else if (key === "sub-agent-create")
										onCreateSubAgent?.();
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
									<Dropdown.Item
										id="skill-github"
										textValue={t("importRemoteSource")}
									>
										<div className="flex items-center gap-2 pl-6">
											<svg
												role="img"
												className="size-4"
												viewBox="0 0 24 24"
												fill="currentColor"
												aria-hidden="true"
											>
												<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
											</svg>
											<span>
												{t("importRemoteSource")}
											</span>
										</div>
									</Dropdown.Item>
								</Dropdown.Section>

								{onCreateSubAgent && (
									<>
										<Separator />
										<Dropdown.Section>
											<Header>
												<div className="flex items-center gap-2 px-2 py-1.5">
													<CpuChipIcon className="size-4 text-muted" />
													<Label className="text-xs font-medium text-muted uppercase tracking-wider">
														{t("subAgents")}
													</Label>
												</div>
											</Header>
											<Dropdown.Item
												id="sub-agent-create"
												textValue={t("createSubAgent")}
											>
												<div className="flex items-center gap-2 pl-6">
													<PlusIcon className="size-4" />
													<span>
														{t("createSubAgent")}
													</span>
												</div>
											</Dropdown.Item>
										</Dropdown.Section>
									</>
								)}
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
					<div className="flex h-full items-center justify-center">
						<Spinner size="lg" />
					</div>
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

						{hasSubAgents && (
							<>
								<ResourceSectionHeader
									title={t("subAgents")}
									count={mergedSubAgentCount}
									icon={
										<CpuChipIcon className="size-3.5" />
									}
								/>
								<ListBox
									aria-label={t("subAgents")}
									selectionMode="single"
									selectionBehavior="replace"
									selectedKeys={selectedSubAgentKeys}
									onSelectionChange={(keys) => {
										if (keys === "all") return;
										const key = [
											...keys,
										][0] as string | undefined;
										if (key)
											onSubAgentSelectionChange?.(key);
									}}
									className="p-2"
								>
									{filteredSubAgentGroups.map((group) => (
										<ListBox.Item
											key={group.mergeKey}
											id={group.mergeKey}
											textValue={group.items[0].name}
											className="data-selected:bg-surface"
										>
											<div className="flex w-full items-center gap-2">
												<CpuChipIcon className="size-4 shrink-0 text-muted" />
												<Label className="flex-1 truncate">
													{group.items[0].name}
												</Label>
											</div>
										</ListBox.Item>
									))}
								</ListBox>
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
