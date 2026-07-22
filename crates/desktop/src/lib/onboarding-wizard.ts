import type { WhatsNewEntry } from "./whats-new";

export type FeatureStepId = "mcp" | "skills" | "projects";

export interface FeatureStep {
	type: "feature";
	id: FeatureStepId;
	titleKey: string;
	descriptionKey: string;
}

export interface WhatsNewStep {
	type: "whats-new";
	id: string;
	entry: WhatsNewEntry;
}

export interface ConsentStep {
	type: "consent";
	id: "consent";
}

export type WizardStep = FeatureStep | WhatsNewStep | ConsentStep;

export const WIZARD_FEATURE_STEPS: readonly FeatureStep[] = [
	{
		type: "feature",
		id: "mcp",
		titleKey: "onboardingStepMcpTitle",
		descriptionKey: "onboardingStepMcpDescription",
	},
	{
		type: "feature",
		id: "skills",
		titleKey: "onboardingStepSkillsTitle",
		descriptionKey: "onboardingStepSkillsDescription",
	},
	{
		type: "feature",
		id: "projects",
		titleKey: "onboardingStepProjectsTitle",
		descriptionKey: "onboardingStepProjectsDescription",
	},
];

interface WizardOpenContext {
	hasSeenWelcome: boolean;
	consentAcked: boolean;
	whatsNewEntries: WhatsNewEntry[];
}

export function buildWizardSteps(context: WizardOpenContext): WizardStep[] {
	const steps: WizardStep[] = [];
	if (!context.hasSeenWelcome) {
		steps.push(...WIZARD_FEATURE_STEPS);
	} else {
		for (const entry of context.whatsNewEntries) {
			steps.push({
				type: "whats-new",
				id: `whats-new-${entry.version}`,
				entry,
			});
		}
	}
	if (!context.consentAcked) {
		steps.push({ type: "consent", id: "consent" });
	}
	return steps;
}

export interface WizardState {
	steps: WizardStep[];
	currentStep: number;
	highestReachedStep: number;
}

export type WizardAction =
	| { type: "open"; steps: WizardStep[] }
	| { type: "select"; step: number }
	| { type: "next" }
	| { type: "previous" }
	| { type: "reset" };

export function createWizardState(steps: WizardStep[] = []): WizardState {
	return {
		steps,
		currentStep: 0,
		highestReachedStep: steps.length > 0 ? 0 : -1,
	};
}

function selectWizardStep(state: WizardState, step: number): WizardState {
	const lastStep = state.steps.length - 1;
	if (lastStep < 0) return state;
	const currentStep = Math.min(Math.max(step, 0), lastStep);
	return {
		...state,
		currentStep,
		highestReachedStep: Math.max(state.highestReachedStep, currentStep),
	};
}

export function onboardingWizardReducer(
	state: WizardState,
	action: WizardAction,
): WizardState {
	switch (action.type) {
		case "open":
			return createWizardState(action.steps);
		case "select":
			return selectWizardStep(state, action.step);
		case "next":
			return selectWizardStep(state, state.currentStep + 1);
		case "previous":
			return selectWizardStep(state, state.currentStep - 1);
		case "reset":
			return createWizardState();
	}
}

export function getWizardAcknowledgements(state: WizardState) {
	const reachedSteps = state.steps.slice(0, state.highestReachedStep + 1);
	const latestWhatsNewVersion = reachedSteps
		.filter((step): step is WhatsNewStep => step.type === "whats-new")
		.map((step) => step.entry.version)
		.pop();

	return {
		consentWasSeen: reachedSteps.some((step) => step.type === "consent"),
		latestWhatsNewVersion: latestWhatsNewVersion ?? null,
	};
}
