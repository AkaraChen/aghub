import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAgentAvailability } from "../../../hooks/use-agent-availability";
import { useProjects } from "../../../hooks/use-projects";
import { useServer } from "../../../hooks/use-server";
import { createApi } from "../../../lib/api";
import type { MarketSkill } from "../../../lib/api-types";

export interface InstallResult {
	agentId: string;
	displayName: string;
	status: "pending" | "success" | "error";
	error?: string;
}

export function useSkillInstall() {
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();
	const { data: projects = [] } = useProjects();

	const [installModalOpen, setInstallModalOpen] = useState(false);
	const [selectedSkill, setSelectedSkill] = useState<MarketSkill | null>(
		null,
	);
	const [selectedAgents, setSelectedAgents] = useState<Set<string>>(
		() => new Set(),
	);
	const [installResults, setInstallResults] = useState<InstallResult[]>([]);
	const [isInstalling, setIsInstalling] = useState(false);
	const [installAll, setInstallAll] = useState(false);
	const [installToProject, setInstallToProject] = useState(false);
	const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
		null,
	);

	const skillAgents = availableAgents.filter(
		(a) => a.isUsable && a.capabilities.skills_mutable,
	);

	const handleInstallClick = (skill: MarketSkill) => {
		setSelectedSkill(skill);
		setSelectedAgents(new Set());
		setInstallResults([]);
		setInstallAll(false);
		setInstallToProject(false);
		setSelectedProjectId(null);
		setInstallModalOpen(true);
	};

	const handleInstall = async () => {
		if (!selectedSkill) return;
		if (selectedAgents.size === 0) return;
		if (installToProject && !selectedProjectId) return;

		setIsInstalling(true);

		const pendingResults: InstallResult[] = Array.from(
			selectedAgents,
			(agentId) => {
				const agent = availableAgents.find((a) => a.id === agentId);
				return {
					agentId,
					displayName: agent?.display_name ?? agentId,
					status: "pending" as const,
				};
			},
		);
		setInstallResults(pendingResults);

		const selectedProject = installToProject
			? projects.find((p) => p.id === selectedProjectId)
			: null;

		try {
			const response = await api.skills.install({
				source: selectedSkill.source,
				agents: Array.from(selectedAgents),
				skills: installAll ? [] : [selectedSkill.name],
				scope: installToProject ? "project" : "global",
				project_path: selectedProject?.path,
				install_all: installAll,
			});

			const updatedResults = pendingResults.map((result) => ({
				...result,
				status: (response.success ? "success" : "error") as
					| "success"
					| "error",
				error: response.success ? undefined : response.stderr,
			}));

			setInstallResults(updatedResults);
		} catch (err) {
			const updatedResults = pendingResults.map((result) => ({
				...result,
				status: "error" as const,
				error: err instanceof Error ? err.message : String(err),
			}));
			setInstallResults(updatedResults);
		}

		setIsInstalling(false);
		queryClient.invalidateQueries({ queryKey: ["skills"] });
	};

	const handleCloseInstallModal = () => {
		setInstallModalOpen(false);
		setSelectedSkill(null);
		setSelectedAgents(new Set());
		setInstallResults([]);
		setInstallAll(false);
		setInstallToProject(false);
		setSelectedProjectId(null);
	};

	return {
		installModalOpen,
		selectedSkill,
		selectedAgents,
		setSelectedAgents,
		installResults,
		isInstalling,
		skillAgents,
		installAll,
		setInstallAll,
		installToProject,
		setInstallToProject,
		selectedProjectId,
		setSelectedProjectId,
		projects,
		handleInstallClick,
		handleInstall,
		handleCloseInstallModal,
	};
}
