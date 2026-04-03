import { FolderIcon } from "@heroicons/react/24/solid";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "wouter";
import { BulkDeleteDialog } from "../../components/bulk-delete-dialog";
import { CreateMcpPanel } from "../../components/create-mcp-panel";
import { CreateSkillPanel } from "../../components/create-skill-panel";
import { CreateSubAgentPanel } from "../../components/create-sub-agent-panel";
import { EditMcpPanel } from "../../components/edit-mcp-panel";
import { ImportGithubSkillPanel } from "../../components/import-github-skill-panel";
import { ImportMcpPanel } from "../../components/import-mcp-panel";
import { ImportSkillPanel } from "../../components/import-skill-panel";
import { McpDetail } from "../../components/mcp-detail";
import { SkillDetail } from "../../components/skill-detail";
import { SubAgentDetail } from "../../components/sub-agent-detail";
import { UnifiedResourceList } from "../../components/unified-resource-list";
import type { McpResponse, SkillResponse } from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import { useProjects } from "../../hooks/use-projects";
import { getMcpMergeKey, getSubAgentMergeKey } from "../../lib/utils";
import { mcpListQueryOptions } from "../../requests/mcps";
import { skillListQueryOptions } from "../../requests/skills";
import {
	invalidateSubAgentQueries,
	subAgentListQueryOptions,
} from "../../requests/sub-agents";

export default function ProjectDetailPage() {
	const { t } = useTranslation();
	const { id } = useParams();
	const { data: projects = [] } = useProjects();
	const project = projects.find((p) => p.id === id);
	const api = useApi();
	const queryClient = useQueryClient();

	const [panelMode, setPanelMode] = useState<
		| "create-mcp"
		| "import-mcp"
		| "edit-mcp"
		| "create-skill"
		| "import-skill"
		| "import-github-skill"
		| "create-sub-agent"
		| null
	>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedResource, setSelectedResource] = useQueryState("resource");
	const [resourceType, setResourceType] = useQueryState("type", {
		defaultValue: "",
	});
	const [selectedMcpKeys, setSelectedMcpKeys] = useState<Set<string>>(
		() => new Set(),
	);
	const [selectedSkillKeys, setSelectedSkillKeys] = useState<Set<string>>(
		() => new Set(),
	);
	const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
	const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);

	// Fetch MCPs and Skills for this project
	const {
		data: mcps = [],
		refetch: refetchMcps,
		isFetching: isFetchingMcps,
		isLoading: isLoadingMcps,
	} = useQuery({
		...mcpListQueryOptions({
			api,
			scope: "all",
			projectRoot: project?.path,
			enabled: !!project?.path,
		}),
	});

	const {
		data: skills = [],
		refetch: refetchSkills,
		isFetching: isFetchingSkills,
		isLoading: isLoadingSkills,
	} = useQuery({
		...skillListQueryOptions({
			api,
			scope: "all",
			projectRoot: project?.path,
			enabled: !!project?.path,
		}),
	});

	const isLoading = isLoadingMcps || isLoadingSkills;

	const {
		data: subAgents = [],
		refetch: refetchSubAgents,
		isFetching: isFetchingSubAgents,
	} = useQuery({
		...subAgentListQueryOptions({
			api,
			scope: "all",
			projectRoot: project?.path,
			enabled: !!project?.path,
		}),
	});

	const projectSubAgents = useMemo(
		() => subAgents.filter((a) => a.source === "project"),
		[subAgents],
	);

	// Filter to project-scoped only
	const projectMcps = useMemo(
		() => mcps.filter((m) => m.source === "project"),
		[mcps],
	);
	const projectSkills = useMemo(
		() => skills.filter((s) => s.source === "project"),
		[skills],
	);

	// Merge logic (same as global pages)
	const groupedMcps = useMemo(() => {
		const map = new Map<string, McpResponse[]>();
		for (const mcp of projectMcps) {
			const key = getMcpMergeKey(mcp.transport);
			const existing = map.get(key) ?? [];
			map.set(key, [...existing, mcp]);
		}
		return Array.from(map.entries()).map(([mergeKey, items]) => ({
			mergeKey,
			transport: items[0].transport,
			items,
		}));
	}, [projectMcps]);

	const groupedSkills = useMemo(() => {
		const map = new Map<string, SkillResponse[]>();
		for (const skill of projectSkills) {
			const existing = map.get(skill.name) ?? [];
			map.set(skill.name, [...existing, skill]);
		}
		return Array.from(map.entries()).map(([name, items]) => ({
			name,
			items,
		}));
	}, [projectSkills]);

	const groupedSubAgents = useMemo(() => {
		const map = new Map<string, typeof projectSubAgents>();
		for (const agent of projectSubAgents) {
			const key = getSubAgentMergeKey(agent);
			const existing = map.get(key) ?? [];
			map.set(key, [...existing, agent]);
		}
		return Array.from(map.entries()).map(([mergeKey, items]) => ({
			mergeKey,
			items,
		}));
	}, [projectSubAgents]);

	// Selected items
	const selectedMcpGroup =
		resourceType === "mcp" && selectedResource
			? groupedMcps.find((g) => g.mergeKey === selectedResource)
			: panelMode === "edit-mcp" && selectedResource
				? groupedMcps.find((g) => g.mergeKey === selectedResource)
				: null;

	const selectedSkillGroup =
		resourceType === "skill" && selectedResource
			? groupedSkills.find((g) => g.name === selectedResource)
			: null;

	const selectedSubAgentGroup =
		resourceType === "sub-agent" && selectedResource
			? groupedSubAgents.find((g) => g.mergeKey === selectedResource)
			: null;

	const handleSelectionChange = (
		keys: Set<string>,
		type: "mcp" | "skill",
	) => {
		const nextMcpKeys = type === "mcp" ? keys : selectedMcpKeys;
		const nextSkillKeys = type === "skill" ? keys : selectedSkillKeys;

		setSelectedMcpKeys(nextMcpKeys);
		setSelectedSkillKeys(nextSkillKeys);

		if (isMultiSelectMode) {
			if (nextMcpKeys.size + nextSkillKeys.size === 0) {
				setIsMultiSelectMode(false);
			}
			setPanelMode(null);
			return;
		}

		const key = keys.size === 1 ? [...keys][0] : null;
		setSelectedResource(key);
		setResourceType(key ? type : "");
		setPanelMode(null);
	};

	const handleSubAgentSelectionChange = (key: string) => {
		setSelectedResource(key);
		setResourceType("sub-agent");
		setSelectedMcpKeys(new Set());
		setSelectedSkillKeys(new Set());
		setPanelMode(null);
	};

	const handleMultiSelectModeChange = (value: boolean) => {
		setIsMultiSelectMode(value);
		if (!value) {
			setSelectedMcpKeys(new Set());
			setSelectedSkillKeys(new Set());
		} else {
			setPanelMode(null);
		}
	};

	const selectedGroups = useMemo(() => {
		const mcpGroups = groupedMcps
			.filter((group) => selectedMcpKeys.has(group.mergeKey))
			.map((group) => ({
				key: group.mergeKey,
				items: group.items,
				resourceType: "mcp" as const,
			}));
		const skillGroups = groupedSkills
			.filter((group) => selectedSkillKeys.has(group.name))
			.map((group) => ({
				key: group.name,
				items: group.items,
				resourceType: "skill" as const,
			}));

		return [...mcpGroups, ...skillGroups];
	}, [groupedMcps, groupedSkills, selectedMcpKeys, selectedSkillKeys]);

	const handleRefresh = () => {
		refetchMcps();
		refetchSkills();
		refetchSubAgents();
	};

	const isRefreshing =
		isFetchingMcps || isFetchingSkills || isFetchingSubAgents;

	// Sub-agent delete handler (removes all items in a group)
	const handleDeleteSubAgentGroup = async (group: {
		mergeKey: string;
		items: (typeof projectSubAgents)[number][];
	}) => {
		await Promise.all(
			group.items.map((item) => {
				if (!item.agent) return Promise.resolve(null);
				return api.subAgents.delete(
					item.name,
					item.agent,
					"project",
					project?.path,
				);
			}),
		);
		await invalidateSubAgentQueries(queryClient);
		setSelectedResource(null);
		setResourceType("");
	};

	if (!project) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-sm text-muted">{t("projectNotFound")}</p>
			</div>
		);
	}

	return (
		<div className="flex h-full">
			{/* List Panel */}
			<UnifiedResourceList
				mcps={projectMcps}
				skills={projectSkills}
				subAgents={projectSubAgents}
				selectedMcpKeys={
					isMultiSelectMode
						? selectedMcpKeys
						: resourceType === "mcp" && selectedResource
							? new Set([selectedResource])
							: new Set()
				}
				selectedSkillKeys={
					isMultiSelectMode
						? selectedSkillKeys
						: resourceType === "skill" && selectedResource
							? new Set([selectedResource])
							: new Set()
				}
				selectedSubAgentKeys={
					resourceType === "sub-agent" && selectedResource
						? new Set([selectedResource])
						: new Set()
				}
				onSelectionChange={handleSelectionChange}
				onSubAgentSelectionChange={handleSubAgentSelectionChange}
				onCreateMcp={(type) => {
					if (type === "manual") setPanelMode("create-mcp");
					else if (type === "import") setPanelMode("import-mcp");
				}}
				onCreateSkill={(type) => {
					if (type === "local") setPanelMode("create-skill");
					else if (type === "import") setPanelMode("import-skill");
					else if (type === "github")
						setPanelMode("import-github-skill");
				}}
				onCreateSubAgent={() => setPanelMode("create-sub-agent")}
				onRefresh={handleRefresh}
				isRefreshing={isRefreshing}
				isLoading={isLoading}
				searchQuery={searchQuery}
				onSearchChange={setSearchQuery}
				projectPath={project.path}
				isMultiSelectMode={isMultiSelectMode}
				onMultiSelectModeChange={handleMultiSelectModeChange}
				onDeleteSelected={() => setIsBulkDeleteDialogOpen(true)}
			/>

			{/* Detail Panel */}
			<div
				data-tour="project-detail-panel"
				className="flex-1 overflow-hidden"
			>
				{!panelMode && selectedMcpGroup && (
					<McpDetail
						key={`mcp-${selectedMcpGroup.mergeKey}`}
						group={selectedMcpGroup}
						onEdit={() => setPanelMode("edit-mcp")}
						projectPath={project.path}
					/>
				)}
				{!panelMode && selectedSkillGroup && (
					<SkillDetail
						key={`skill-${selectedSkillGroup.name}`}
						group={selectedSkillGroup}
						projectPath={project.path}
					/>
				)}
				{!panelMode && selectedSubAgentGroup && (
					<SubAgentDetail
						group={selectedSubAgentGroup}
						onEdit={() => {}}
						onDelete={() =>
							handleDeleteSubAgentGroup(selectedSubAgentGroup)
						}
						isDeleting={false}
						projectPath={project.path}
					/>
				)}
				{panelMode === "create-mcp" && (
					<CreateMcpPanel
						onDone={() => setPanelMode(null)}
						projectPath={project.path}
					/>
				)}
				{panelMode === "import-mcp" && (
					<ImportMcpPanel
						onDone={() => setPanelMode(null)}
						projectPath={project.path}
					/>
				)}
				{panelMode === "create-skill" && (
					<CreateSkillPanel
						onDone={() => setPanelMode(null)}
						projectPath={project.path}
					/>
				)}
				{panelMode === "import-skill" && (
					<ImportSkillPanel
						onDone={() => setPanelMode(null)}
						projectPath={project.path}
					/>
				)}
				{panelMode === "import-github-skill" && (
					<ImportGithubSkillPanel
						onDone={() => setPanelMode(null)}
						projectPath={project.path}
					/>
				)}
				{panelMode === "edit-mcp" && selectedMcpGroup && (
					<EditMcpPanel
						key={selectedMcpGroup.mergeKey}
						group={selectedMcpGroup}
						onDone={() => setPanelMode(null)}
						projectPath={project.path}
					/>
				)}
				{panelMode === "create-sub-agent" && (
					<CreateSubAgentPanel
						onDone={() => setPanelMode(null)}
						projectPath={project.path}
					/>
				)}
				{!panelMode &&
					!selectedMcpGroup &&
					!selectedSkillGroup &&
					!selectedSubAgentGroup && (
						<div className="flex h-full flex-col items-center justify-center gap-3">
							<div
								className="
         flex size-16 items-center justify-center rounded-full
         bg-surface-secondary
       "
							>
								<FolderIcon className="size-8 text-muted" />
							</div>
							<div className="text-center">
								<h3 className="mb-1 text-lg font-semibold">
									{project.name}
								</h3>
								<p className="max-w-sm text-sm text-muted">
									{t("selectResourceToView")}
								</p>
							</div>
						</div>
					)}

				<BulkDeleteDialog
					isOpen={isBulkDeleteDialogOpen}
					onClose={() => setIsBulkDeleteDialogOpen(false)}
					groups={selectedGroups}
					onSuccess={() => {
						setSelectedMcpKeys(new Set());
						setSelectedSkillKeys(new Set());
						setSelectedResource(null);
						setResourceType("");
						setIsMultiSelectMode(false);
					}}
					resourceType="mixed"
					projectPath={project.path}
				/>
			</div>
		</div>
	);
}
