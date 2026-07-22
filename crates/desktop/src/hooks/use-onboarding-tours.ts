import type { Driver } from "driver.js";
import "driver.js/dist/driver.css";
import {
	startTransition,
	useEffect,
	useEffectEvent,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import {
	availableTourSteps,
	createOnboardingDriver,
	productMapSteps,
	projectSetupSteps,
	projectWorkflowSteps,
	waitForTourElement,
} from "../lib/onboarding-tours";
import { updateOnboardingProgress } from "../lib/store";
import { useProjects } from "./use-projects";

export function useOnboardingTours(onTourStart: () => void) {
	const { t } = useTranslation();
	const [location, setLocation] = useLocation();
	const { data: projects = [] } = useProjects();
	const [pendingProjectTour, setPendingProjectTour] = useState(false);
	const activeDriverRef = useRef<Driver | null>(null);
	const previousProjectIdsRef = useRef<string[]>([]);

	const destroyActiveTour = () => {
		activeDriverRef.current?.destroy();
		activeDriverRef.current = null;
	};

	const clearActiveTour = () => {
		activeDriverRef.current = null;
	};

	const saveTourProgress = (
		updates: Parameters<typeof updateOnboardingProgress>[0],
	) => {
		void updateOnboardingProgress(updates).catch((error) => {
			console.error("Failed to save tour progress:", error);
		});
	};

	const ensureRoute = async (path: string, selector: string) => {
		if (location !== path) {
			startTransition(() => {
				setLocation(path);
			});
		}

		return waitForTourElement(selector);
	};

	async function startProjectWorkflowTour(projectId?: string) {
		const targetProjectId = projectId ?? projects[0]?.id;
		if (!targetProjectId) {
			await startProjectSetupGuide();
			return;
		}

		onTourStart();
		setPendingProjectTour(false);
		destroyActiveTour();

		const projectRoot = await ensureRoute(
			`/projects/${targetProjectId}`,
			'[data-tour="project-resources"]',
		);
		if (!projectRoot) return;

		const steps = projectWorkflowSteps(t, () => {
			saveTourProgress({
				hasSeenWelcome: true,
				completedTours: { projectWorkflow: true },
			});
		});
		const tour = createOnboardingDriver({
			t,
			steps,
			onDestroyed: clearActiveTour,
		});

		activeDriverRef.current = tour;
		tour.drive();
	}

	async function startProjectSetupGuide() {
		if (projects.length > 0) {
			await startProjectWorkflowTour(projects[0]?.id);
			return;
		}

		onTourStart();
		setPendingProjectTour(true);
		destroyActiveTour();

		const addProjectButton = await waitForTourElement(
			'[data-tour="project-add"]',
		);
		if (!addProjectButton) return;

		const tour = createOnboardingDriver({
			t,
			steps: projectSetupSteps(t),
			onDestroyed: clearActiveTour,
			progress: false,
		});

		activeDriverRef.current = tour;
		tour.drive();
	}

	async function startProductTour() {
		onTourStart();
		setPendingProjectTour(false);
		destroyActiveTour();

		const sidebar = await ensureRoute("/mcp", '[data-tour="sidebar"]');
		if (!sidebar) return;

		const steps = availableTourSteps(
			productMapSteps(t, () => {
				saveTourProgress({
					hasSeenWelcome: true,
					completedTours: { productMap: true },
				});

				if (projects.length > 0) {
					void startProjectWorkflowTour(projects[0]?.id);
				} else {
					void startProjectSetupGuide();
				}
			}),
		);
		const tour = createOnboardingDriver({
			t,
			steps,
			onDestroyed: clearActiveTour,
		});

		activeDriverRef.current = tour;
		tour.drive();
	}

	const continueWithNewProject = useEffectEvent((projectId: string) => {
		void startProjectWorkflowTour(projectId);
	});

	useEffect(() => {
		const previousProjectIds = previousProjectIdsRef.current;
		const newProject = projects.find(
			(project) => !previousProjectIds.includes(project.id),
		);

		if (pendingProjectTour && newProject) {
			continueWithNewProject(newProject.id);
		}

		previousProjectIdsRef.current = projects.map((project) => project.id);
	}, [pendingProjectTour, projects]);

	useEffect(
		() => () => {
			destroyActiveTour();
		},
		[],
	);

	return {
		destroyActiveTour,
		startProductTour,
		startProjectSetupGuide,
		startProjectWorkflowTour,
	};
}
