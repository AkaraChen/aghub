import { FolderIcon } from "@heroicons/react/24/solid";
import { useQuery } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "wouter";
import { CreateMcpPanel } from "../../components/create-mcp-panel";
import { EditMcpPanel } from "../../components/edit-mcp-panel";
import { InstallSkillDialog } from "../../components/install-skill-dialog";
import { McpDetail } from "../../components/mcp-detail";
import { SkillDetail } from "../../components/skill-detail";
import { UnifiedResourceList } from "../../components/unified-resource-list";
import { useProjects } from "../../hooks/use-projects";
import { createApi } from "../../lib/api";
import type { McpResponse, SkillResponse } from "../../lib/api-types";
import { ConfigSource } from "../../lib/api-types";
import { getMcpMergeKey } from "../../lib/utils";
import { useServer } from "../../providers/server";

export default function ProjectDetailPage() {
	const { t } = useTranslation();
	const { id } = useParams();
	const { data: projects = [] } = useProjects();
	const project = projects.find((p) => p.id === id);
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);

	const [panelMode, setPanelMode] = useState<
		"create-mcp" | "edit-mcp" | null
	>(null);
	const [isInstallSkillOpen, setIsInstallSkillOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedResource, setSelectedResource] = useQueryState("resource");
	const [resourceType, setResourceType] = useQueryState("type", {
		defaultValue: "",
	});

	// Fetch MCPs and Skills for this project
	const { data: mcps = [], refetch: refetchMcps } = useQuery({
		queryKey: ["project-mcps", project?.path],
		queryFn: () => api.mcps.listAll("all", project?.path),
		enabled: !!project?.path,
	});

	const { data: skills = [], refetch: refetchSkills } = useQuery({
		queryKey: ["project-skills", project?.path],
		queryFn: () => api.skills.listAll("all", project?.path),
		enabled: !!project?.path,
	});

	// Filter to project-scoped only
	const projectMcps = useMemo(
		() => mcps.filter((m) => m.source === ConfigSource.Project),
		[mcps],
	);
	const projectSkills = useMemo(
		() => skills.filter((s) => s.source === ConfigSource.Project),
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

	const handleSelect = (key: string, type: "mcp" | "skill") => {
		setSelectedResource(key);
		setResourceType(type);
		setPanelMode(null);
	};

	const handleRefresh = () => {
		refetchMcps();
		refetchSkills();
	};

	if (!project) {
		return (
			<div className="flex items-center justify-center h-full">
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
				selectedKey={selectedResource}
				selectedType={resourceType as "mcp" | "skill" | null}
				onSelect={handleSelect}
				onCreateMcp={() => setPanelMode("create-mcp")}
				onCreateSkill={() => setIsInstallSkillOpen(true)}
				onRefresh={handleRefresh}
				searchQuery={searchQuery}
				onSearchChange={setSearchQuery}
				projectPath={project.path}
			/>

			{/* Detail Panel */}
			<div className="flex-1 overflow-hidden">
				{!panelMode && selectedMcpGroup && (
					<McpDetail
						group={selectedMcpGroup}
						onEdit={() => setPanelMode("edit-mcp")}
						projectPath={project.path}
					/>
				)}
				{!panelMode && selectedSkillGroup && (
					<SkillDetail
						group={selectedSkillGroup}
						projectPath={project.path}
					/>
				)}
			{panelMode === "create-mcp" && (
				<CreateMcpPanel
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
				{(!panelMode && !selectedMcpGroup && !selectedSkillGroup) && (
					<div className="flex flex-col items-center justify-center h-full gap-3">
						<div className="flex items-center justify-center w-16 h-16 rounded-full bg-surface-secondary">
							<FolderIcon className="size-8 text-muted" />
						</div>
						<div className="text-center">
							<h3 className="text-lg font-semibold mb-1">
								{project.name}
							</h3>
							<p className="text-sm text-muted max-w-sm">
								{t("selectResourceToView")}
							</p>
						</div>
					</div>
				)}
			</div>

			<InstallSkillDialog
				isOpen={isInstallSkillOpen}
				onClose={() => setIsInstallSkillOpen(false)}
				projectPath={project?.path}
			/>
		</div>
	);
}
