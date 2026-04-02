import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { MarketSkill } from "../../../generated/dto";
import { useAgentAvailability } from "../../../hooks/use-agent-availability";
import { useApi } from "../../../hooks/use-api";
import { useInstallTarget } from "../../../hooks/use-install-target";
import { supportsSkillMutation } from "../../../lib/agent-capabilities";
import {
	buildPendingResults,
	type InstallResult,
} from "../../../lib/install-utils";
import { installSkillMutationOptions } from "../../../requests/skills";

export function useSkillInstall() {
	const api = useApi();
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();
	const {
		projects,
		installToProject,
		setInstallToProject,
		selectedProjectId,
		selectedProject,
		canInstallToProject,
		setSelectedProjectId,
		resetInstallTarget,
	} = useInstallTarget();
	const installMutation = useMutation(
		installSkillMutationOptions({
			api,
			queryClient,
		}),
	);

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

	const skillAgents = availableAgents.filter(
		(a) =>
			a.isUsable &&
			supportsSkillMutation(a, installToProject ? "project" : "global"),
	);

	const handleInstallClick = (skill: MarketSkill) => {
		setSelectedSkill(skill);
		setSelectedAgents(new Set());
		setInstallResults([]);
		setInstallAll(false);
		resetInstallTarget();
		setInstallModalOpen(true);
	};

	const handleInstall = async () => {
		if (!selectedSkill) return;
		if (selectedAgents.size === 0) return;
		if (installToProject && !selectedProjectId) return;

		setIsInstalling(true);

		const pendingResults = buildPendingResults(
			selectedAgents,
			availableAgents,
		);
		setInstallResults(pendingResults);

		try {
			const response = await installMutation.mutateAsync({
				source: selectedSkill.source,
				agents: Array.from(selectedAgents),
				skills: installAll ? [] : [selectedSkill.name],
				scope: installToProject ? "project" : "global",
				project_path: selectedProject?.path ?? null,
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
	};

	const handleCloseInstallModal = () => {
		setInstallModalOpen(false);
		setSelectedSkill(null);
		setSelectedAgents(new Set());
		setInstallResults([]);
		setInstallAll(false);
		resetInstallTarget();
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
		canInstallToProject,
		selectedProjectId,
		setSelectedProjectId,
		projects,
		handleInstallClick,
		handleInstall,
		handleCloseInstallModal,
	};
}
