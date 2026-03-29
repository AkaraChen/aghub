import {
	BookOpenIcon,
	FolderIcon,
	ServerIcon,
	SquaresPlusIcon,
} from "@heroicons/react/24/solid";
import { Button, Card } from "@heroui/react";
import { type Driver, type DriveStep, driver } from "driver.js";
import "driver.js/dist/driver.css";
import {
	type ReactNode,
	startTransition,
	useEffect,
	useEffectEvent,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useProjects } from "../hooks/use-projects";
import { ONBOARDING_EVENT, type OnboardingCommand } from "../lib/onboarding";
import { getOnboardingProgress, updateOnboardingProgress } from "../lib/store";

type OverlayMode = "welcome" | "project-next-step" | null;

const TOUR_CLASS = "aghub-tour-popover";
const TOUR_WAIT_MS = 5000;

function waitForElement(selector: string, timeoutMs = TOUR_WAIT_MS) {
	return new Promise<HTMLElement | null>((resolve) => {
		const deadline = Date.now() + timeoutMs;

		const tick = () => {
			const element = document.querySelector<HTMLElement>(selector);
			if (element) {
				resolve(element);
				return;
			}

			if (Date.now() >= deadline) {
				resolve(null);
				return;
			}

			window.setTimeout(tick, 80);
		};

		tick();
	});
}

export function OnboardingController() {
	const { t } = useTranslation();
	const [location, setLocation] = useLocation();
	const { data: projects = [] } = useProjects();
	const [isReady, setIsReady] = useState(false);
	const [overlayMode, setOverlayMode] = useState<OverlayMode>(null);
	const [pendingProjectTour, setPendingProjectTour] = useState(false);
	const activeDriverRef = useRef<Driver | null>(null);
	const previousProjectIdsRef = useRef<string[]>([]);

	const destroyActiveDriver = () => {
		activeDriverRef.current?.destroy();
		activeDriverRef.current = null;
	};

	const saveProgress = async (updates: {
		hasSeenWelcome?: boolean;
		completedTours?: {
			productMap?: boolean;
			projectWorkflow?: boolean;
		};
	}) => {
		await updateOnboardingProgress(updates);
	};

	const ensureRoute = async (path: string, selector: string) => {
		if (location !== path) {
			startTransition(() => {
				setLocation(path);
			});
		}

		return waitForElement(selector);
	};

	const startProjectWorkflowTour = async (projectId?: string) => {
		const targetProjectId = projectId ?? projects[0]?.id;
		if (!targetProjectId) {
			setOverlayMode("project-next-step");
			return;
		}

		setOverlayMode(null);
		setPendingProjectTour(false);
		destroyActiveDriver();

		const projectRoot = await ensureRoute(
			`/projects/${targetProjectId}`,
			'[data-tour="project-resources"]',
		);

		if (!projectRoot) {
			return;
		}

		const finishProjectTour = () => {
			void saveProgress({
				hasSeenWelcome: true,
				completedTours: {
					projectWorkflow: true,
				},
			});
		};

		const steps: DriveStep[] = [
			{
				element: '[data-tour="project-resources"]',
				popover: {
					title: t("onboardingProjectResourcesTitle"),
					description: t("onboardingProjectResourcesDescription"),
					side: "right",
					align: "start",
				},
			},
			{
				element: '[data-tour="project-search"]',
				popover: {
					title: t("onboardingProjectSearchTitle"),
					description: t("onboardingProjectSearchDescription"),
					side: "right",
					align: "start",
				},
			},
			{
				element: '[data-tour="project-add-resource"]',
				popover: {
					title: t("onboardingProjectAddTitle"),
					description: t("onboardingProjectAddDescription"),
					side: "bottom",
					align: "end",
				},
			},
			{
				element: '[data-tour="project-detail-panel"]',
				popover: {
					title: t("onboardingProjectDetailTitle"),
					description: t("onboardingProjectDetailDescription"),
					side: "left",
					align: "start",
				},
			},
			{
				element: '[data-tour="project-multi-select"]',
				popover: {
					title: t("onboardingProjectBulkTitle"),
					description: t("onboardingProjectBulkDescription"),
					side: "bottom",
					align: "end",
					doneBtnText: t("onboardingFinish"),
					onNextClick: (_element, _step, opts) => {
						finishProjectTour();
						opts.driver.destroy();
					},
				},
			},
		];

		const driverObj = driver({
			animate: true,
			allowClose: true,
			allowKeyboardControl: true,
			overlayColor: "rgba(12, 18, 28, 0.54)",
			overlayOpacity: 0.54,
			popoverClass: TOUR_CLASS,
			showButtons: ["previous", "next", "close"],
			showProgress: true,
			progressText: t("onboardingProgressText"),
			nextBtnText: t("next"),
			prevBtnText: t("back"),
			doneBtnText: t("done"),
			stagePadding: 10,
			stageRadius: 14,
			onDestroyed: () => {
				activeDriverRef.current = null;
			},
			onCloseClick: (_element, _step, opts) => {
				opts.driver.destroy();
			},
			steps,
		});

		activeDriverRef.current = driverObj;
		driverObj.drive();
	};

	const startProjectSetupGuide = async () => {
		if (projects.length > 0) {
			await startProjectWorkflowTour(projects[0]?.id);
			return;
		}

		setOverlayMode(null);
		setPendingProjectTour(true);
		destroyActiveDriver();

		const addProjectButton = await waitForElement(
			'[data-tour="project-add"]',
		);

		if (!addProjectButton) {
			return;
		}

		const driverObj = driver({
			animate: true,
			allowClose: true,
			allowKeyboardControl: true,
			overlayColor: "rgba(12, 18, 28, 0.52)",
			overlayOpacity: 0.52,
			popoverClass: TOUR_CLASS,
			showButtons: ["next", "close"],
			nextBtnText: t("done"),
			doneBtnText: t("done"),
			stagePadding: 10,
			stageRadius: 14,
			onDestroyed: () => {
				activeDriverRef.current = null;
			},
			onCloseClick: (_element, _step, opts) => {
				opts.driver.destroy();
			},
			steps: [
				{
					element: '[data-tour="project-add"]',
					popover: {
						title: t("onboardingProjectSetupTitle"),
						description: t("onboardingProjectSetupDescription"),
						side: "right",
						align: "start",
						doneBtnText: t("done"),
						onNextClick: (_element, _step, opts) => {
							opts.driver.destroy();
						},
					},
				},
			],
		});

		activeDriverRef.current = driverObj;
		driverObj.drive();
	};

	const startProductTour = async () => {
		setOverlayMode(null);
		setPendingProjectTour(false);
		destroyActiveDriver();

		const sidebar = await ensureRoute("/mcp", '[data-tour="sidebar"]');
		if (!sidebar) {
			return;
		}

		const finishProductTour = () => {
			void saveProgress({
				hasSeenWelcome: true,
				completedTours: {
					productMap: true,
				},
			});

			if (projects.length > 0) {
				void startProjectWorkflowTour(projects[0]?.id);
				return;
			}

			setOverlayMode("project-next-step");
		};

		const steps: DriveStep[] = [
			{
				element: '[data-tour="sidebar"]',
				popover: {
					title: t("onboardingSidebarTitle"),
					description: t("onboardingSidebarDescription"),
					side: "right",
					align: "start",
				},
			},
			{
				element: '[data-tour="nav-mcp"]',
				popover: {
					title: t("onboardingMcpTitle"),
					description: t("onboardingMcpDescription"),
					side: "right",
					align: "center",
				},
			},
			{
				element: '[data-tour="mcp-add"]',
				popover: {
					title: t("onboardingMcpActionTitle"),
					description: t("onboardingMcpActionDescription"),
					side: "bottom",
					align: "end",
				},
			},
			{
				element: '[data-tour="nav-skills"]',
				popover: {
					title: t("onboardingSkillsTitle"),
					description: t("onboardingSkillsDescription"),
					side: "right",
					align: "center",
				},
			},
			{
				element: '[data-tour="nav-market"]',
				popover: {
					title: t("onboardingMarketTitle"),
					description: t("onboardingMarketDescription"),
					side: "right",
					align: "center",
				},
			},
			{
				element: '[data-tour="project-section"]',
				popover: {
					title: t("onboardingProjectsTitle"),
					description: t("onboardingProjectsDescription"),
					side: "right",
					align: "start",
				},
			},
			{
				element: '[data-tour="project-add"]',
				popover: {
					title: t("onboardingProjectAddShortcutTitle"),
					description: t("onboardingProjectAddShortcutDescription"),
					side: "right",
					align: "center",
				},
			},
			{
				element: '[data-tour="nav-settings"]',
				popover: {
					title: t("onboardingSettingsTitle"),
					description: t("onboardingSettingsDescription"),
					side: "right",
					align: "center",
					doneBtnText: t("onboardingContinue"),
					onNextClick: (_element, _step, opts) => {
						finishProductTour();
						opts.driver.destroy();
					},
				},
			},
		];

		const driverObj = driver({
			animate: true,
			allowClose: true,
			allowKeyboardControl: true,
			overlayColor: "rgba(12, 18, 28, 0.54)",
			overlayOpacity: 0.54,
			popoverClass: TOUR_CLASS,
			showButtons: ["previous", "next", "close"],
			showProgress: true,
			progressText: t("onboardingProgressText"),
			nextBtnText: t("next"),
			prevBtnText: t("back"),
			doneBtnText: t("done"),
			stagePadding: 10,
			stageRadius: 14,
			onDestroyed: () => {
				activeDriverRef.current = null;
			},
			onCloseClick: (_element, _step, opts) => {
				opts.driver.destroy();
			},
			steps,
		});

		activeDriverRef.current = driverObj;
		driverObj.drive();
	};

	const dismissWelcome = async () => {
		setOverlayMode(null);
		await saveProgress({
			hasSeenWelcome: true,
		});
	};

	const continueWithNewProject = useEffectEvent((projectId: string) => {
		void startProjectWorkflowTour(projectId);
	});

	const handleCommand = useEffectEvent((command: OnboardingCommand) => {
		if (command.type === "show-welcome") {
			destroyActiveDriver();
			setOverlayMode("welcome");
			return;
		}

		if (command.tour === "product-map") {
			void startProductTour();
			return;
		}

		if (command.tour === "project-workflow") {
			void startProjectWorkflowTour();
			return;
		}

		void startProjectSetupGuide();
	});

	useEffect(() => {
		let isMounted = true;

		void getOnboardingProgress().then((progress) => {
			if (!isMounted) {
				return;
			}

			setIsReady(true);
			if (!progress.hasSeenWelcome) {
				setOverlayMode("welcome");
			}
		});

		return () => {
			isMounted = false;
			activeDriverRef.current?.destroy();
			activeDriverRef.current = null;
		};
	}, []);

	useEffect(() => {
		const listener = (event: Event) => {
			handleCommand((event as CustomEvent<OnboardingCommand>).detail);
		};

		window.addEventListener(ONBOARDING_EVENT, listener);

		return () => {
			window.removeEventListener(ONBOARDING_EVENT, listener);
		};
	}, []);

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

	if (!isReady) {
		return null;
	}

	return (
		<>
			{overlayMode === "welcome" && (
				<div
					className="
						fixed inset-0 z-50 flex items-start justify-center bg-background/76
						p-6 backdrop-blur-sm
					"
				>
					<Card
						className="
							mt-12 w-full max-w-4xl border border-border bg-surface/96
							shadow-2xl shadow-foreground/6
						"
					>
						<Card.Content className="space-y-6 p-6">
							<div
								className="
									grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]
								"
							>
								<div className="space-y-5">
									<div className="space-y-3">
										<p
											className="
												text-[11px] font-semibold tracking-[0.18em]
												text-muted uppercase
											"
										>
											{t("onboardingEyebrow")}
										</p>
										<div className="space-y-2">
											<h2
												className="
													text-2xl font-semibold tracking-tight
													text-foreground
												"
											>
												{t("onboardingWelcomeTitle")}
											</h2>
											<p className="max-w-2xl text-sm leading-6 text-muted">
												{t(
													"onboardingWelcomeDescription",
												)}
											</p>
										</div>
									</div>

									<div className="grid gap-3 sm:grid-cols-3">
										<OnboardingValueCard
											icon={
												<ServerIcon className="size-4" />
											}
											title={t(
												"onboardingValueGlobalTitle",
											)}
											description={t(
												"onboardingValueGlobalDescription",
											)}
										/>
										<OnboardingValueCard
											icon={
												<BookOpenIcon className="size-4" />
											}
											title={t(
												"onboardingValueSkillsTitle",
											)}
											description={t(
												"onboardingValueSkillsDescription",
											)}
										/>
										<OnboardingValueCard
											icon={
												<FolderIcon className="size-4" />
											}
											title={t(
												"onboardingValueProjectTitle",
											)}
											description={t(
												"onboardingValueProjectDescription",
											)}
										/>
									</div>
								</div>

								<div
									className="
										rounded-2xl border border-border bg-surface-secondary/80
										p-4
									"
								>
									<div className="space-y-4">
										<div className="space-y-1.5">
											<h3 className="text-sm font-semibold text-foreground">
												{t("onboardingFlowTitle")}
											</h3>
											<p className="text-xs leading-5 text-muted">
												{t("onboardingFlowDescription")}
											</p>
										</div>

										<div className="space-y-3">
											<OnboardingFlowStep
												index="01"
												title={t(
													"onboardingFlowStepOneTitle",
												)}
												description={t(
													"onboardingFlowStepOneDescription",
												)}
											/>
											<OnboardingFlowStep
												index="02"
												title={t(
													"onboardingFlowStepTwoTitle",
												)}
												description={t(
													"onboardingFlowStepTwoDescription",
												)}
											/>
											<OnboardingFlowStep
												index="03"
												title={t(
													"onboardingFlowStepThreeTitle",
												)}
												description={t(
													"onboardingFlowStepThreeDescription",
												)}
											/>
										</div>
									</div>
								</div>
							</div>

							<div
								className="
									flex flex-col gap-4 border-t border-border pt-5
									sm:flex-row sm:items-center sm:justify-between
								"
							>
								<div className="space-y-1">
									<p className="text-sm font-medium text-foreground">
										{t("onboardingTimeEstimate")}
									</p>
									<p className="text-xs text-muted">
										{t("onboardingOptionalHint")}
									</p>
								</div>

								<div className="flex flex-wrap justify-end gap-2">
									<Button
										variant="tertiary"
										onPress={() => {
											void dismissWelcome();
										}}
									>
										{t("onboardingSkip")}
									</Button>
									<Button
										variant="secondary"
										onPress={() => {
											void dismissWelcome();
											void startProjectSetupGuide();
										}}
									>
										{projects.length > 0
											? t("onboardingOpenProject")
											: t("onboardingAddProject")}
									</Button>
									<Button
										variant="primary"
										onPress={() => {
											void dismissWelcome();
											void startProductTour();
										}}
									>
										{t("onboardingStart")}
									</Button>
								</div>
							</div>
						</Card.Content>
					</Card>
				</div>
			)}

			{overlayMode === "project-next-step" && (
				<div className="fixed bottom-6 right-6 z-40 w-full max-w-sm">
					<Card className="border border-border bg-surface/96">
						<Card.Content className="space-y-4 p-4">
							<div className="flex items-start gap-3">
								<div
									className="
										mt-0.5 flex size-8 shrink-0 items-center justify-center
										rounded-xl bg-surface-secondary text-foreground
									"
								>
									<SquaresPlusIcon className="size-4" />
								</div>
								<div className="space-y-1">
									<h3 className="text-sm font-semibold text-foreground">
										{t("onboardingProjectNextTitle")}
									</h3>
									<p className="text-xs leading-5 text-muted">
										{t("onboardingProjectNextDescription")}
									</p>
								</div>
							</div>

							<div className="flex justify-end gap-2">
								<Button
									variant="tertiary"
									onPress={() => setOverlayMode(null)}
								>
									{t("onboardingLater")}
								</Button>
								<Button
									variant="primary"
									onPress={() => {
										void startProjectSetupGuide();
									}}
								>
									{t("onboardingShowMe")}
								</Button>
							</div>
						</Card.Content>
					</Card>
				</div>
			)}
		</>
	);
}

function OnboardingValueCard({
	icon,
	title,
	description,
}: {
	icon: ReactNode;
	title: string;
	description: string;
}) {
	return (
		<div
			className="
				rounded-2xl border border-border bg-surface-secondary/70 p-4
				shadow-sm shadow-foreground/3
			"
		>
			<div className="mb-3 flex size-8 items-center justify-center rounded-xl bg-surface text-foreground">
				{icon}
			</div>
			<div className="space-y-1">
				<h3 className="text-sm font-semibold text-foreground">
					{title}
				</h3>
				<p className="text-xs leading-5 text-muted">{description}</p>
			</div>
		</div>
	);
}

function OnboardingFlowStep({
	index,
	title,
	description,
}: {
	index: string;
	title: string;
	description: string;
}) {
	return (
		<div className="flex gap-3">
			<div
				className="
					flex h-7 w-9 shrink-0 items-center justify-center rounded-full
					bg-surface text-[11px] font-semibold tracking-wide text-muted
				"
			>
				{index}
			</div>
			<div className="space-y-1">
				<p className="text-sm font-medium text-foreground">{title}</p>
				<p className="text-xs leading-5 text-muted">{description}</p>
			</div>
		</div>
	);
}
