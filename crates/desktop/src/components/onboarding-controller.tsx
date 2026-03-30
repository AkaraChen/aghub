import {
	ArrowsPointingOutIcon,
	BookOpenIcon,
	FolderIcon,
	ServerIcon,
} from "@heroicons/react/24/solid";
import { Button, Modal, Spinner } from "@heroui/react";
import { type Driver, type DriveStep, driver } from "driver.js";
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
import { useProjects } from "../hooks/use-projects";
import { ONBOARDING_EVENT, type OnboardingCommand } from "../lib/onboarding";
import { getOnboardingProgress, updateOnboardingProgress } from "../lib/store";
import { cn } from "../lib/utils";

type OverlayMode = "welcome" | null;

const TOUR_CLASS = "aghub-tour-popover";
const TOUR_WAIT_MS = 5000;

const WIZARD_STEPS = [
	{
		id: "mcp",
		icon: <ServerIcon className="size-5" />,
		titleKey: "onboardingStepMcpTitle",
		descriptionKey: "onboardingStepMcpDescription",
	},
	{
		id: "skills",
		icon: <BookOpenIcon className="size-5" />,
		titleKey: "onboardingStepSkillsTitle",
		descriptionKey: "onboardingStepSkillsDescription",
	},
	{
		id: "projects",
		icon: <FolderIcon className="size-5" />,
		titleKey: "onboardingStepProjectsTitle",
		descriptionKey: "onboardingStepProjectsDescription",
	},
] as const;

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
	const [currentStep, setCurrentStep] = useState(0);
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

	async function startProjectWorkflowTour(projectId?: string) {
		const targetProjectId = projectId ?? projects[0]?.id;
		if (!targetProjectId) {
			void startProjectSetupGuide();
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
					onNextClick: (_element: any, _step: any, opts: any) => {
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
			onCloseClick: (_element: any, _step: any, opts: any) => {
				opts.driver.destroy();
			},
			steps,
		});

		activeDriverRef.current = driverObj;
		driverObj.drive();
	}

	async function startProjectSetupGuide() {
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
			onCloseClick: (_element: any, _step: any, opts: any) => {
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
						onNextClick: (_element: any, _step: any, opts: any) => {
							opts.driver.destroy();
						},
					},
				},
			],
		});

		activeDriverRef.current = driverObj;
		driverObj.drive();
	}

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

			void startProjectSetupGuide();
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
				element: '[data-tour="nav-skills"]',
				popover: {
					title: t("onboardingSkillsTitle"),
					description: t("onboardingSkillsDescription"),
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
					onNextClick: (_element: any, _step: any, opts: any) => {
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
			onCloseClick: (_element: any, _step: any, opts: any) => {
				opts.driver.destroy();
			},
			steps,
		});

		activeDriverRef.current = driverObj;
		driverObj.drive();
	};

	const dismissWelcome = async () => {
		setOverlayMode(null);
		setCurrentStep(0);
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
			setCurrentStep(0);
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
		<Modal.Backdrop
			isOpen={overlayMode === "welcome"}
			onOpenChange={(isOpen) => {
				if (!isOpen) {
					void dismissWelcome();
				}
			}}
		>
			<Modal.Container>
				<Modal.Dialog className="w-[calc(100vw-3rem)] max-w-4xl">
					<Modal.CloseTrigger />
					<Modal.Header>
						<div className="space-y-1">
							<Modal.Heading>
								{t("onboardingWizardTitle")}
							</Modal.Heading>
							<p className="text-sm text-muted">
								{t("onboardingWizardSubtitle")}
							</p>
						</div>
					</Modal.Header>

					<Modal.Body className="space-y-5 px-6 pb-2 pt-0">
						{/* Two-column layout */}
						<div className="grid gap-5 sm:grid-cols-[2fr_3fr]">
							{/* Left: Feature list */}
							<div className="flex flex-col justify-center gap-1.5">
								{WIZARD_STEPS.map((step, index) => (
									<button
										key={step.id}
										type="button"
										className={cn(
											"flex gap-3 rounded-xl p-3 text-left transition-colors",
											index === currentStep
												? "bg-surface-secondary"
												: "bg-transparent hover:bg-surface-secondary/30",
										)}
										onClick={() => setCurrentStep(index)}
									>
										<div
											className={cn(
												"flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
												index === currentStep
													? "bg-foreground text-background"
													: "bg-surface/40 text-muted/30",
											)}
										>
											{step.icon}
										</div>
										<div className="min-w-0 space-y-1">
											<p
												className={cn(
													"text-sm font-semibold transition-colors",
													index === currentStep
														? "text-foreground"
														: "text-muted/40",
												)}
											>
												{t(step.titleKey)}
											</p>
											{index === currentStep && (
												<p className="text-xs leading-5 text-muted">
													{t(step.descriptionKey)}
												</p>
											)}
										</div>
									</button>
								))}
							</div>

							{/* Right: Illustration */}
							<WizardIllustration
								stepId={WIZARD_STEPS[currentStep].id}
							/>
						</div>
					</Modal.Body>

					<Modal.Footer>
						<Button
							variant="outline"
							className="flex-1"
							isDisabled={currentStep === 0}
							onPress={() =>
								setCurrentStep((s) => Math.max(0, s - 1))
							}
						>
							{t("onboardingBack")}
						</Button>

						{currentStep < WIZARD_STEPS.length - 1 ? (
							<Button
								variant="primary"
								className="flex-1"
								onPress={() => setCurrentStep((s) => s + 1)}
							>
								{t("onboardingNext")}
							</Button>
						) : (
							<Button
								variant="primary"
								className="flex-1"
								onPress={() => {
									void dismissWelcome();
									void startProductTour();
								}}
							>
								{t("onboardingGetStarted")}
							</Button>
						)}
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}

const WIZARD_VIDEOS: Record<string, string> = {
	mcp: "https://cdn.jsdelivr.net/gh/AkaraChen/aghub-docs@main/public/mcp.mp4",
	skills: "https://cdn.jsdelivr.net/gh/AkaraChen/aghub-docs@main/public/skills.mp4",
	projects:
		"https://cdn.jsdelivr.net/gh/AkaraChen/aghub-docs@main/public/project.mp4",
};

function WizardIllustration({ stepId }: { stepId: string }) {
	const videoSrc = WIZARD_VIDEOS[stepId];
	const [isLoading, setIsLoading] = useState(true);
	const videoRef = useRef<HTMLVideoElement>(null);

	const handleFullscreen = () => {
		const video = videoRef.current;
		if (!video) return;
		if (document.fullscreenElement) {
			void document.exitFullscreen();
		} else {
			void video.requestFullscreen();
		}
	};

	return (
		<div className="group relative flex min-h-80 items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface-secondary/60">
			{isLoading && (
				<div className="absolute inset-0 flex items-center justify-center">
					<Spinner size="lg" />
				</div>
			)}
			{videoSrc && (
				<video
					ref={videoRef}
					key={stepId}
					className={cn(
						"size-full object-cover transition-opacity",
						isLoading ? "opacity-0" : "opacity-100",
					)}
					src={videoSrc}
					autoPlay
					loop
					muted
					playsInline
					onCanPlay={() => setIsLoading(false)}
					onLoadStart={() => setIsLoading(true)}
				/>
			)}
			<button
				type="button"
				className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-lg bg-foreground/70 text-background opacity-0 backdrop-blur-sm transition-opacity hover:bg-foreground/90 group-hover:opacity-100"
				onClick={handleFullscreen}
			>
				<ArrowsPointingOutIcon className="size-4" />
			</button>
		</div>
	);
}
