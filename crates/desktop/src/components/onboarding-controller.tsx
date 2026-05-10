import {
	ArrowsPointingOutIcon,
	BookOpenIcon,
	FolderIcon,
	PuzzlePieceIcon,
	ServerIcon,
	ShieldCheckIcon,
	SparklesIcon,
} from "@heroicons/react/24/solid";
import { Button, Checkbox, Modal, Spinner } from "@heroui/react";
import { getVersion } from "@tauri-apps/api/app";
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
import { applyAnalyticsConsent, capture } from "../lib/analytics";
import { ONBOARDING_EVENT, type OnboardingCommand } from "../lib/onboarding";
import {
	getAnalyticsConsent,
	getConsentAcked,
	getLastSeenWhatsNewVersion,
	getOnboardingProgress,
	setAnalyticsConsent,
	setConsentAcked,
	setLastSeenWhatsNewVersion,
	updateOnboardingProgress,
} from "../lib/store";
import { cn } from "../lib/utils";
import {
	pendingWhatsNew,
	type WhatsNewEntry,
	type WhatsNewItem,
} from "../lib/whats-new";

type OverlayMode = "welcome" | null;

const TOUR_CLASS = "aghub-tour-popover";
const TOUR_WAIT_MS = 5000;

interface FeatureStep {
	type: "feature";
	id: string;
	icon: React.ReactNode;
	titleKey: string;
	descriptionKey: string;
}

interface WhatsNewStep {
	type: "whats-new";
	id: string;
	entry: WhatsNewEntry;
}

interface ConsentStep {
	type: "consent";
	id: string;
}

type WizardStep = FeatureStep | WhatsNewStep | ConsentStep;

const WIZARD_FEATURE_STEPS: FeatureStep[] = [
	{
		type: "feature",
		id: "mcp",
		icon: <ServerIcon className="size-5" />,
		titleKey: "onboardingStepMcpTitle",
		descriptionKey: "onboardingStepMcpDescription",
	},
	{
		type: "feature",
		id: "skills",
		icon: <BookOpenIcon className="size-5" />,
		titleKey: "onboardingStepSkillsTitle",
		descriptionKey: "onboardingStepSkillsDescription",
	},
	{
		type: "feature",
		id: "projects",
		icon: <FolderIcon className="size-5" />,
		titleKey: "onboardingStepProjectsTitle",
		descriptionKey: "onboardingStepProjectsDescription",
	},
];

const WHATS_NEW_ICONS = {
	sparkles: <SparklesIcon className="size-5" />,
	puzzle: <PuzzlePieceIcon className="size-5" />,
	shield: <ShieldCheckIcon className="size-5" />,
} as const;

interface WizardOpenContext {
	hasSeenWelcome: boolean;
	consentAcked: boolean;
	whatsNewEntries: WhatsNewEntry[];
}

/**
 * Compose the active wizard sequence for this launch. Brand-new
 * users get the feature wizard followed by the consent step;
 * existing users upgrading get just the unseen What's New entries
 * (and the consent step if they haven't already acked).
 */
function buildWizardSteps(ctx: WizardOpenContext): WizardStep[] {
	const steps: WizardStep[] = [];
	if (!ctx.hasSeenWelcome) {
		steps.push(...WIZARD_FEATURE_STEPS);
	}
	for (const entry of ctx.whatsNewEntries) {
		steps.push({
			type: "whats-new",
			id: `whats-new-${entry.version}`,
			entry,
		});
	}
	if (!ctx.consentAcked) {
		steps.push({ type: "consent", id: "consent" });
	}
	return steps;
}

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
	// Pre-checked: opt-in by default for first-time users. Persisted +
	// applied (Rust + posthog-js) when the user dismisses the dialog.
	const [analyticsOptIn, setAnalyticsOptIn] = useState(true);
	const [wizardSteps, setWizardSteps] = useState<WizardStep[]>([]);
	const [currentVersion, setCurrentVersion] = useState<string | null>(null);
	// Tracks whether the wizard sequence included a fresh-install
	// welcome run; if it did, we kick off the product tour after
	// dismiss. Otherwise (upgrade-only flow) we don't.
	const includedFeatureSteps = wizardSteps.some(
		(step) => step.type === "feature",
	);
	const includedConsentStep = wizardSteps.some(
		(step) => step.type === "consent",
	);
	const activeStep = wizardSteps[currentStep];
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
		const availableSteps = steps.filter((step) => {
			if (typeof step.element !== "string") {
				return true;
			}

			return document.querySelector(step.element) !== null;
		});

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
			steps: availableSteps,
		});

		activeDriverRef.current = driverObj;
		driverObj.drive();
	};

	const dismissWelcome = async () => {
		setOverlayMode(null);
		setCurrentStep(0);

		const consentStepWasShown = includedConsentStep;
		const latestWhatsNewVersion = wizardSteps
			.filter((step): step is WhatsNewStep => step.type === "whats-new")
			.map((step) => step.entry.version)
			.pop();

		try {
			// Only persist a consent decision if the user actually saw
			// the consent step. Skipping the dialog without ever seeing
			// the checkbox shouldn't silently flip their setting.
			if (consentStepWasShown) {
				const consent = analyticsOptIn ? "granted" : "denied";
				await setAnalyticsConsent(consent);
				await setConsentAcked(true);
				await applyAnalyticsConsent(analyticsOptIn);
			}

			// Mark What's New entries as seen, watermarking with the
			// highest version we displayed so the user doesn't see them
			// again on next launch.
			if (latestWhatsNewVersion) {
				await setLastSeenWhatsNewVersion(latestWhatsNewVersion);
			} else if (currentVersion) {
				// First-time user finishing the welcome wizard: stamp
				// the current version so they don't get a What's New
				// for it on next launch.
				await setLastSeenWhatsNewVersion(currentVersion);
			}
		} catch (error) {
			console.error("Failed to persist onboarding flags:", error);
		}

		capture("onboarding completed");
		await saveProgress({
			hasSeenWelcome: true,
		});

		// Reset the wizard's computed step list so re-opening it
		// (e.g. via Settings → Show Welcome) doesn't reuse stale data.
		setWizardSteps([]);
	};

	const continueWithNewProject = useEffectEvent((projectId: string) => {
		void startProjectWorkflowTour(projectId);
	});

	const handleCommand = useEffectEvent((command: OnboardingCommand) => {
		if (command.type === "show-welcome") {
			destroyActiveDriver();
			// Manual replay always shows the full feature wizard,
			// regardless of whether the user has seen it before.
			setWizardSteps([...WIZARD_FEATURE_STEPS]);
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

		void (async () => {
			const [progress, consentAcked, lastSeen, version] =
				await Promise.all([
					getOnboardingProgress(),
					getConsentAcked(),
					getLastSeenWhatsNewVersion(),
					getVersion(),
				]);
			if (!isMounted) return;

			const whatsNewEntries = pendingWhatsNew(lastSeen, version);
			const steps = buildWizardSteps({
				hasSeenWelcome: progress.hasSeenWelcome,
				consentAcked,
				whatsNewEntries,
			});

			// Sync current consent state into the checkbox so existing
			// users see their actual choice reflected.
			try {
				const consent = await getAnalyticsConsent();
				if (isMounted) {
					setAnalyticsOptIn(consent === "granted");
				}
			} catch {
				// keep the default true
			}

			if (!isMounted) return;

			setCurrentVersion(version);
			setIsReady(true);

			if (steps.length > 0) {
				setWizardSteps(steps);
				setCurrentStep(0);
				setOverlayMode("welcome");
			}
		})();

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
						{activeStep && (
							<WizardStepBody
								step={activeStep}
								steps={wizardSteps}
								currentStep={currentStep}
								onSelectStep={setCurrentStep}
								analyticsOptIn={analyticsOptIn}
								onAnalyticsOptInChange={setAnalyticsOptIn}
								t={t}
							/>
						)}
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

						{currentStep < wizardSteps.length - 1 ? (
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
									// Only kick off the product tour for
									// genuinely new users — existing users
									// hitting the upgrade wizard don't
									// need a redundant guided tour.
									if (includedFeatureSteps) {
										void startProductTour();
									}
								}}
							>
								{includedFeatureSteps
									? t("onboardingGetStarted")
									: t("onboardingFinish")}
							</Button>
						)}
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}

interface WizardStepBodyProps {
	step: WizardStep;
	steps: WizardStep[];
	currentStep: number;
	onSelectStep: (index: number) => void;
	analyticsOptIn: boolean;
	onAnalyticsOptInChange: (value: boolean) => void;
	t: (key: string, options?: Record<string, unknown>) => string;
}

/**
 * Renders the body for whichever wizard step is currently active.
 * Each step type uses a different layout: feature steps keep the
 * two-column list+illustration shape, what's-new shows a single-
 * column stack of release items, consent shows a centred checkbox
 * card.
 */
function WizardStepBody({
	step,
	steps,
	currentStep,
	onSelectStep,
	analyticsOptIn,
	onAnalyticsOptInChange,
	t,
}: WizardStepBodyProps) {
	if (step.type === "feature") {
		const featureIndices = steps
			.map((s, idx) => (s.type === "feature" ? idx : -1))
			.filter((idx) => idx !== -1);
		return (
			<div className="grid gap-5 sm:grid-cols-[2fr_3fr]">
				<div className="flex flex-col justify-center gap-1.5">
					{featureIndices.map((idx) => {
						const featureStep = steps[idx] as FeatureStep;
						const active = idx === currentStep;
						return (
							<button
								key={featureStep.id}
								type="button"
								className={cn(
									"flex gap-3 rounded-xl p-3 text-left transition-colors",
									active
										? "bg-surface-secondary"
										: "bg-transparent hover:bg-surface-secondary/30",
								)}
								onClick={() => onSelectStep(idx)}
							>
								<div
									className={cn(
										"flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
										active
											? "bg-foreground text-background"
											: "bg-surface/40 text-muted/30",
									)}
								>
									{featureStep.icon}
								</div>
								<div className="min-w-0 space-y-1">
									<p
										className={cn(
											"text-sm font-semibold transition-colors",
											active
												? "text-foreground"
												: "text-muted/40",
										)}
									>
										{t(featureStep.titleKey)}
									</p>
									{active && (
										<p className="text-xs leading-5 text-muted">
											{t(featureStep.descriptionKey)}
										</p>
									)}
								</div>
							</button>
						);
					})}
				</div>
				<WizardIllustration stepId={step.id} />
			</div>
		);
	}

	if (step.type === "whats-new") {
		return (
			<div className="space-y-3">
				<div className="space-y-1">
					<p className="text-xs font-medium uppercase tracking-wider text-accent">
						{t("whatsNewSectionLabel", {
							version: step.entry.version,
						})}
					</p>
					<h3 className="text-lg font-semibold">
						{t(step.entry.titleKey)}
					</h3>
					<p className="text-sm text-muted">
						{t(step.entry.subtitleKey)}
					</p>
				</div>
				<ul className="space-y-2">
					{step.entry.items.map((item: WhatsNewItem) => (
						<li
							key={item.titleKey}
							className="flex gap-3 rounded-xl border border-border bg-surface-secondary/50 p-3"
						>
							<div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
								{WHATS_NEW_ICONS[item.iconKey]}
							</div>
							<div className="min-w-0 space-y-1">
								<p className="text-sm font-semibold">
									{t(item.titleKey)}
								</p>
								<p className="text-xs leading-5 text-muted">
									{t(item.descriptionKey)}
								</p>
							</div>
						</li>
					))}
				</ul>
			</div>
		);
	}

	// consent step
	return (
		<div className="space-y-3">
			<div className="space-y-1">
				<p className="text-xs font-medium uppercase tracking-wider text-accent">
					{t("onboardingConsentSectionLabel")}
				</p>
				<h3 className="text-lg font-semibold">
					{t("onboardingAnalyticsTitle")}
				</h3>
				<p className="text-sm text-muted">
					{t("onboardingAnalyticsDescription")}
				</p>
			</div>
			<div className="rounded-xl border border-border bg-surface-secondary/50 p-4">
				<Checkbox
					variant="secondary"
					isSelected={analyticsOptIn}
					onChange={onAnalyticsOptInChange}
				>
					<Checkbox.Control>
						<Checkbox.Indicator />
					</Checkbox.Control>
					<Checkbox.Content>
						<p className="text-sm font-medium">
							{t("settingsAnalyticsToggleLabel")}
						</p>
					</Checkbox.Content>
				</Checkbox>
			</div>
		</div>
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
