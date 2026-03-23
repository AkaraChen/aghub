import {
	ArrowPathIcon,
	CommandLineIcon,
	CubeIcon,
	WifiIcon,
} from "@heroicons/react/24/solid";
import { Button, Chip, Label, ListBox, SearchField } from "@heroui/react";
import type { Key } from "@heroui/react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { McpResponse, SkillResponse } from "../lib/api-types";
import { getMcpMergeKey } from "../lib/utils";
import { ResourceSectionHeader } from "./resource-section-header";

interface McpGroup {
	mergeKey: string;
	transport: McpResponse["transport"];
	items: McpResponse[];
}

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
}: UnifiedResourceListProps) {
	const { t } = useTranslation();

	// Filter by search query
	const filteredMcps = useMemo(
		() =>
			mcps.filter(
				(server) =>
					server.name
						.toLowerCase()
						.includes(searchQuery.toLowerCase()) ||
					(server.source ?? "")
						.toLowerCase()
						.includes(searchQuery.toLowerCase()) ||
					(server.agent ?? "")
						.toLowerCase()
						.includes(searchQuery.toLowerCase()),
			),
		[mcps, searchQuery],
	);

	const filteredSkills = useMemo(
		() =>
			skills.filter(
				(skill) =>
					skill.name
						.toLowerCase()
						.includes(searchQuery.toLowerCase()) ||
					(skill.description ?? "")
						.toLowerCase()
						.includes(searchQuery.toLowerCase()),
			),
		[skills, searchQuery],
	);

	// Merge logic (same as global pages)
	const groupedMcps = useMemo(() => {
		const map = new Map<string, McpResponse[]>();
		for (const mcp of filteredMcps) {
			const key = getMcpMergeKey(mcp.transport);
			const existing = map.get(key) ?? [];
			map.set(key, [...existing, mcp]);
		}
		return Array.from(map.entries()).map(([mergeKey, items]) => ({
			mergeKey,
			transport: items[0].transport,
			items,
		}));
	}, [filteredMcps]);

	const groupedSkills = useMemo(() => {
		const map = new Map<string, SkillResponse[]>();
		for (const skill of filteredSkills) {
			const existing = map.get(skill.name) ?? [];
			map.set(skill.name, [...existing, skill]);
		}
		return Array.from(map.entries()).map(([name, items]) => ({
			name,
			items,
		}));
	}, [filteredSkills]);

	const getTransportIcon = (transport: McpGroup["transport"]) => {
		if (transport.type === "stdio") {
			return <CommandLineIcon className="size-3.5 shrink-0" />;
		}
		return <WifiIcon className="size-3.5 shrink-0" />;
	};

	const handleSelectionChange = (keys: "all" | Set<Key>) => {
		if (keys === "all") return;
		const key = [...keys][0] as string;
		if (key) {
			// Determine type from key format
			const isMcp = groupedMcps.some((g) => g.mergeKey === key);
			const type = isMcp ? "mcp" : "skill";
			onSelect(key, type);
		}
	};

	const selectedKeys: "all" | Set<Key> = selectedKey ? new Set<Key>([selectedKey]) : new Set<Key>();

	const hasMcps = groupedMcps.length > 0;
	const hasSkills = groupedSkills.length > 0;
	const hasAny = hasMcps || hasSkills;

	return (
		<div className="w-80 shrink-0 border-r border-border flex flex-col">
			{/* Search Header */}
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
				<Button
					isIconOnly
					variant="ghost"
					size="sm"
					className="shrink-0"
					aria-label={t("addMcpServer")}
					onPress={onCreateMcp}
				>
					<CommandLineIcon className="size-4" />
				</Button>
				<Button
					isIconOnly
					variant="ghost"
					size="sm"
					className="shrink-0"
					aria-label={t("addSkill")}
					onPress={onCreateSkill}
				>
					<CubeIcon className="size-4" />
				</Button>
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

			{/* Unified List */}
			<div className="flex-1 overflow-y-auto">
				{/* MCP Servers Section */}
				{hasMcps && (
					<>
						<ResourceSectionHeader
							title={t("mcpServers")}
							count={groupedMcps.length}
							icon={<CommandLineIcon className="size-3.5" />}
						/>
						<ListBox
							aria-label="MCP Servers"
							selectionMode="single"
							selectedKeys={
								selectedType === "mcp" ? selectedKeys : new Set<Key>()
							}
							onSelectionChange={handleSelectionChange}
							className="p-2 pt-1"
						>
							{groupedMcps.map((group) => (
								<ListBox.Item
									key={group.mergeKey}
									id={group.mergeKey}
									textValue={group.items[0].name}
									className="data-[selected]:bg-accent/10"
								>
									<div className="flex items-center gap-2 w-full">
										{getTransportIcon(group.transport)}
										<Label className="truncate flex-1">
											{group.items[0].name}
										</Label>
										{group.items.length > 1 && (
											<Chip
												size="sm"
												variant="soft"
												color="accent"
											>
												{group.items.length}
											</Chip>
										)}
									</div>
								</ListBox.Item>
							))}
						</ListBox>
					</>
				)}

				{/* Skills Section */}
				{hasSkills && (
					<>
						<ResourceSectionHeader
							title={t("skills")}
							count={groupedSkills.length}
							icon={<CubeIcon className="size-3.5" />}
						/>
						<ListBox
							aria-label="Skills"
							selectionMode="single"
							selectedKeys={
								selectedType === "skill"
									? selectedKeys
									: new Set<Key>()
							}
							onSelectionChange={handleSelectionChange}
							className="p-2 pt-1"
						>
							{groupedSkills.map((group) => (
								<ListBox.Item
									key={group.name}
									id={group.name}
									textValue={group.name}
									className="data-[selected]:bg-accent/10"
								>
									<div className="flex items-center gap-2 w-full">
										<CubeIcon className="size-3.5 shrink-0 text-muted" />
										<Label className="truncate flex-1">
											{group.name}
										</Label>
										{group.items.length > 1 && (
											<Chip
												size="sm"
												variant="soft"
												color="accent"
											>
												{group.items.length}
											</Chip>
										)}
									</div>
								</ListBox.Item>
							))}
						</ListBox>
					</>
				)}

				{/* Empty State */}
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