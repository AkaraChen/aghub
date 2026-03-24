import {
	ArrowPathIcon,
	BookOpenIcon,
	PlusIcon,
	ServerIcon,
} from "@heroicons/react/24/solid";
import { Button, Dropdown, SearchField } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { McpList } from "./mcp-list";
import { ResourceSectionHeader } from "./resource-section-header";
import { SkillList } from "./skill-list";
import type { McpResponse, SkillResponse } from "../lib/api-types";

interface UnifiedResourceListProps {
	mcps: McpResponse[];
	skills: SkillResponse[];
	selectedKey: string | null;
	selectedType: "mcp" | "skill" | null;
	onSelect: (key: string, type: "mcp" | "skill") => void;
	onCreateMcp: () => void;
	onCreateSkill: () => void;
	onRefresh: () => void;
	searchQuery: string;
	onSearchChange: (query: string) => void;
	projectPath?: string;
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
	searchQuery,
	onSearchChange,
	projectPath,
}: UnifiedResourceListProps) {
	const { t } = useTranslation();

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
		<div className="w-80 shrink-0 border-r border-border flex flex-col">
			<div className="flex items-center gap-2 p-3 border-b border-border">
				<SearchField
					value={searchQuery}
					onChange={onSearchChange}
					aria-label={t("searchResources")}
					variant="secondary"
					className="flex-1 min-w-0"
				>
					<SearchField.Group>
						<SearchField.SearchIcon />
						<SearchField.Input placeholder={t("searchResources")} />
						<SearchField.ClearButton />
					</SearchField.Group>
				</SearchField>
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
								else if (key === "skill") onCreateSkill();
							}}
						>
							<Dropdown.Item id="mcp" textValue={t("mcpServers")}>
								<div className="flex items-center gap-2">
									<ServerIcon className="size-4" />
									<span>{t("mcpServers")}</span>
								</div>
							</Dropdown.Item>
							<Dropdown.Item id="skill" textValue={t("skills")}>
								<div className="flex items-center gap-2">
									<BookOpenIcon className="size-4" />
									<span>{t("skills")}</span>
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
					<ArrowPathIcon className="size-4" />
				</Button>
			</div>

			<div className="flex-1 overflow-y-auto">
				{hasMcps && (
					<>
						<ResourceSectionHeader
							title={t("mcpServers")}
							count={mcps.length}
							icon={<ServerIcon className="size-3.5" />}
						/>
						<McpList
							mcps={mcps}
							selectedKey={
								selectedType === "mcp" ? selectedKey : null
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
							count={skills.length}
							icon={<BookOpenIcon className="size-3.5" />}
						/>
						<SkillList
							skills={skills}
							selectedKey={
								selectedType === "skill" ? selectedKey : null
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
							<p className="text-xs text-muted mt-1">
								&ldquo;{searchQuery}&rdquo;
							</p>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
