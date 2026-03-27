import {
	ArrowPathIcon,
	BookOpenIcon,
	CommandLineIcon,
	PlusIcon,
	ServerIcon,
} from "@heroicons/react/24/solid";
import { Button, Dropdown, Skeleton } from "@heroui/react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { McpResponse, SkillResponse } from "../lib/api-types";
import { cn, getMcpMergeKey } from "../lib/utils";
import { ListSearchHeader } from "./list-search-header";
import { McpList } from "./mcp-list";
import { ResourceSectionHeader } from "./resource-section-header";
import { SkillList } from "./skill-list";

interface UnifiedResourceListProps {
	mcps: McpResponse[];
	skills: SkillResponse[];
	selectedKey: string | null;
	selectedType: "mcp" | "skill" | null;
	onSelect: (key: string, type: "mcp" | "skill") => void;
	onCreateMcp: () => void;
	onCreateSkill: (type: "market" | "local" | "import") => void;
	onRefresh: () => void;
	isRefreshing?: boolean;
	isLoading?: boolean;
	searchQuery: string;
	onSearchChange: (query: string) => void;
	projectPath?: string;
}

function ResourceListSkeleton() {
	return (
		<>
			<ResourceSectionHeader
				title=""
				count={0}
				icon={<Skeleton className="size-3.5 rounded bg-default-200" />}
			/>
			<div className="p-2 space-y-1">
				{[1, 2, 3].map((i) => (
					<div
						key={i}
						className="flex items-center gap-2 px-2 py-1.5 rounded-medium"
					>
						<Skeleton className="size-4 rounded bg-default-200" />
						<Skeleton className="h-3 flex-1 rounded bg-default-200" />
					</div>
				))}
			</div>
			<ResourceSectionHeader
				title=""
				count={0}
				icon={<Skeleton className="size-3.5 rounded bg-default-200" />}
			/>
			<div className="p-2 space-y-1">
				{[1, 2].map((i) => (
					<div
						key={i}
						className="flex items-center gap-2 px-2 py-1.5 rounded-medium"
					>
						<Skeleton className="size-4 rounded bg-default-200" />
						<Skeleton className="h-3 flex-1 rounded bg-default-200" />
					</div>
				))}
			</div>
		</>
	);
}

export function UnifiedResourceList({
	mcps,
	skills,
	selectedKey,
	selectedType,
	onSelect,
	onCreateMcp,
	onCreateSkill,
	onRefresh,
	isRefreshing = false,
	isLoading = false,
	searchQuery,
	onSearchChange,
	projectPath,
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

	const handleSelectMcp = (key: string) => {
		onSelect(key, "mcp");
	};

	const handleSelectSkill = (key: string) => {
		onSelect(key, "skill");
	};

	return (
		<div className="flex w-80 shrink-0 flex-col border-r border-border">
			<ListSearchHeader
				searchValue={searchQuery}
				onSearchChange={onSearchChange}
				placeholder={t("searchResources")}
				ariaLabel={t("searchResources")}
			>
				<Dropdown>
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						className="shrink-0"
						aria-label={t("add")}
					>
						<PlusIcon className="size-4" />
					</Button>
					<Dropdown.Popover placement="bottom end">
						<Dropdown.Menu
							onAction={(key) => {
								if (key === "mcp") onCreateMcp();
								else if (key === "skill-market")
									onCreateSkill("market");
								else if (key === "skill-local")
									onCreateSkill("local");
								else if (key === "skill-import")
									onCreateSkill("import");
							}}
						>
							<Dropdown.Item id="mcp" textValue={t("mcpServers")}>
								<div className="flex items-center gap-2">
									<ServerIcon className="size-4" />
									<span>{t("mcpServers")}</span>
								</div>
							</Dropdown.Item>
							<Dropdown.Item
								id="skill-market"
								textValue={t("installFromMarket")}
							>
								<div className="flex items-center gap-2">
									<BookOpenIcon className="size-4" />
									<span>{t("installFromMarket")}</span>
								</div>
							</Dropdown.Item>
							<Dropdown.Item
								id="skill-import"
								textValue={t("importFromFile")}
							>
								<div className="flex items-center gap-2">
									<CommandLineIcon className="size-4" />
									<span>{t("importFromFile")}</span>
								</div>
							</Dropdown.Item>
							<Dropdown.Item
								id="skill-local"
								textValue={t("createCustomSkill")}
							>
								<div className="flex items-center gap-2">
									<CommandLineIcon className="size-4" />
									<span>{t("createCustomSkill")}</span>
								</div>
							</Dropdown.Item>
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
						className={cn("size-4", isRefreshing && "animate-spin")}
					/>
				</Button>
			</ListSearchHeader>

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
									selectedKey={
										selectedType === "mcp"
											? selectedKey
											: null
									}
									searchQuery={searchQuery}
									onSelect={handleSelectMcp}
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
									selectedKey={
										selectedType === "skill"
											? selectedKey
											: null
									}
									searchQuery={searchQuery}
									onSelect={handleSelectSkill}
									groupBySource={true}
									projectPath={projectPath}
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
		</div>
	);
}
