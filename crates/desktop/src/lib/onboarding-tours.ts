import { type Driver, type DriveStep, driver } from "driver.js";

export type TourTranslate = (
	key: string,
	options?: Record<string, unknown>,
) => string;

const TOUR_CLASS = "aghub-tour-popover";
const TOUR_WAIT_MS = 5000;

export function waitForTourElement(selector: string, timeoutMs = TOUR_WAIT_MS) {
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

export function createOnboardingDriver({
	t,
	steps,
	onDestroyed,
	progress = true,
}: {
	t: TourTranslate;
	steps: DriveStep[];
	onDestroyed: () => void;
	progress?: boolean;
}): Driver {
	return driver({
		animate: true,
		allowClose: true,
		allowKeyboardControl: true,
		overlayColor: "rgba(12, 18, 28, 0.54)",
		overlayOpacity: 0.54,
		popoverClass: TOUR_CLASS,
		showButtons: progress
			? ["previous", "next", "close"]
			: ["next", "close"],
		showProgress: progress,
		progressText: progress ? t("onboardingProgressText") : undefined,
		nextBtnText: progress ? t("next") : t("done"),
		prevBtnText: progress ? t("back") : undefined,
		doneBtnText: t("done"),
		stagePadding: 10,
		stageRadius: 14,
		onDestroyed,
		onCloseClick: (_element, _step, options) => {
			options.driver.destroy();
		},
		steps,
	});
}

export function projectWorkflowSteps(
	t: TourTranslate,
	onFinish: () => void,
): DriveStep[] {
	return [
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
				onNextClick: (_element, _step, options) => {
					onFinish();
					options.driver.destroy();
				},
			},
		},
	];
}

export function projectSetupSteps(t: TourTranslate): DriveStep[] {
	return [
		{
			element: '[data-tour="project-add"]',
			popover: {
				title: t("onboardingProjectSetupTitle"),
				description: t("onboardingProjectSetupDescription"),
				side: "right",
				align: "start",
				doneBtnText: t("done"),
				onNextClick: (_element, _step, options) => {
					options.driver.destroy();
				},
			},
		},
	];
}

export function productMapSteps(
	t: TourTranslate,
	onFinish: () => void,
): DriveStep[] {
	return [
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
				onNextClick: (_element, _step, options) => {
					onFinish();
					options.driver.destroy();
				},
			},
		},
	];
}

export function availableTourSteps(steps: DriveStep[]): DriveStep[] {
	return steps.filter((step) => {
		if (typeof step.element !== "string") return true;
		return document.querySelector(step.element) !== null;
	});
}
