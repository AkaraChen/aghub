import { useCallback, useMemo, useState } from "react";
import { useProjects } from "./use-projects";

export function useInstallTarget() {
	const { data: projects = [] } = useProjects();
	const [installToProject, setInstallToProject] = useState(false);
	const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
		null,
	);

	const selectedProject = useMemo(
		() =>
			projects.find((project) => project.id === selectedProjectId) ??
			null,
		[projects, selectedProjectId],
	);

	const canInstallToProject = projects.length > 0;
	const effectiveInstallToProject = installToProject && canInstallToProject;

	const handleInstallToProjectChange = useCallback(
		(value: boolean) => {
			if (!canInstallToProject) {
				setInstallToProject(false);
				setSelectedProjectId(null);
				return;
			}

			setInstallToProject(value);
			if (!value) {
				setSelectedProjectId(null);
			}
		},
		[canInstallToProject],
	);

	const resetInstallTarget = useCallback(() => {
		setInstallToProject(false);
		setSelectedProjectId(null);
	}, []);

	return {
		projects,
		installToProject: effectiveInstallToProject,
		selectedProjectId,
		selectedProject,
		canInstallToProject,
		setInstallToProject: handleInstallToProjectChange,
		setSelectedProjectId,
		resetInstallTarget,
	};
}
