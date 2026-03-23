import { FolderIcon } from "@heroicons/react/24/solid";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "wouter";
import { CreateMcpPanel } from "../../components/create-mcp-panel";
import { CreateSkillPanel } from "../../components/create-skill-panel";
import { EditMcpPanel } from "../../components/edit-mcp-panel";
import { McpDetail } from "../../components/mcp-detail";
import { SkillDetail } from "../../components/skill-detail";
import { UnifiedResourceList } from "../../components/unified-resource-list";
import { useProjects } from "../../hooks/use-projects";
import { createApi } from "../../lib/api";
import type { McpResponse, SkillResponse } from "../../lib/api-types";
import { ConfigSource } from "../../lib/api-types";
import { getMcpMergeKey } from "../../lib/utils";
import { useServer } from "../../providers/server";

type PanelState =
	| { type: "detail"; selectedKey: string; resourceType: "mcp" | "skill" }
	| { type: "create-mcp" }
	| { type: "create-skill" }
	| { type: "edit-mcp"; selectedKey: string }
	| { type: "empty" };

export default function ProjectDetailPage() {
	const { t } = useTranslation();
	const { id } = useParams();
	const { data: projects = [] } = useProjects();
	const project = projects.find((p) => p.id === id);
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);

	const [panel, setPanel] = useState<PanelState>({ type: "empty" });
	const [searchQuery, setSearchQuery] = useState("");

	// Fetch MCPs and Skills for this project
	const {
		data: mcps = [],
		refetch: refetchMcps,
	} = useQuery({
		queryKey: ["project-mcps", project?.path],
		queryFn: () => api.mcps.listAll("all", project?.path),
		enabled: !!project?.path,
	});

	const {
		data: skills = [],
		refetch: refetchSkills,
	} = useQuery({
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
		panel.type === "detail" && panel.resourceType === "mcp"
			? groupedMcps.find((g) => g.mergeKey === panel.selectedKey)
			: panel.type === "edit-mcp"
				? groupedMcps.find((g) => g.mergeKey === panel.selectedKey)
				: null;

	const selectedSkillGroup =
		panel.type === "detail" && panel.resourceType === "skill"
			? groupedSkills.find((g) => g.name === panel.selectedKey)
			: null;

	const handleSelect = (key: string, type: "mcp" | "skill") => {
		setPanel({ type: "detail", selectedKey: key, resourceType: type });
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
				selectedKey={
					panel.type === "detail" ? panel.selectedKey : null
				}
				selectedType={
					panel.type === "detail" ? panel.resourceType : null
				}
				onSelect={handleSelect}
				onCreateMcp={() => setPanel({ type: "create-mcp" })}
				onCreateSkill={() => setPanel({ type: "create-skill" })}
				onRefresh={handleRefresh}
				searchQuery={searchQuery}
				onSearchChange={setSearchQuery}
			/>

			{/* Detail Panel */}
			<div className="flex-1 overflow-hidden">
				{panel.type === "detail" && selectedMcpGroup && (
					<McpDetail
						group={selectedMcpGroup}
						onEdit={() =>
							setPanel({
								type: "edit-mcp",
								selectedKey: panel.selectedKey,
							})
						}
						projectPath={project.path}
					/>
				)}
				{panel.type === "detail" && selectedSkillGroup && (
					<SkillDetail
						group={selectedSkillGroup}
						projectPath={project.path}
					/>
				)}
				{panel.type === "create-mcp" && (
					<CreateMcpPanel
						onDone={() => setPanel({ type: "empty" })}
						projectPath={project.path}
					/>
				)}
				{panel.type === "create-skill" && (
					<CreateSkillPanel
						onDone={() => setPanel({ type: "empty" })}
						projectPath={project.path}
					/>
				)}
				{panel.type === "edit-mcp" && selectedMcpGroup && (
					<EditMcpPanel
						group={selectedMcpGroup}
						onDone={() =>
							setPanel({
								type: "detail",
								selectedKey: panel.selectedKey,
								resourceType: "mcp",
							})
						}
						projectPath={project.path}
					/>
				)}
				{(panel.type === "empty" ||
					(panel.type === "detail" && !selectedMcpGroup && !selectedSkillGroup)) && (
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
		</div>
	);
}