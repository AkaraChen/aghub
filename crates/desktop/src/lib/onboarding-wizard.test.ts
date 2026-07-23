import { describe, expect, it } from "vitest";
import type { WhatsNewEntry } from "./whats-new";
import {
	buildWizardSteps,
	createWizardState,
	getWizardAcknowledgements,
	onboardingWizardReducer,
	WIZARD_FEATURE_STEPS,
} from "./onboarding-wizard";

const release: WhatsNewEntry = {
	version: "1.0.0",
	titleKey: "releaseTitle",
	subtitleKey: "releaseSubtitle",
	items: [],
};

describe("buildWizardSteps", () => {
	it("keeps release notes out of the first-run feature wizard", () => {
		const steps = buildWizardSteps({
			hasSeenWelcome: false,
			consentAcked: false,
			whatsNewEntries: [release],
		});

		expect(steps.map((step) => step.type)).toEqual([
			"feature",
			"feature",
			"feature",
			"consent",
		]);
	});

	it("shows unseen releases before consent for an existing user", () => {
		const steps = buildWizardSteps({
			hasSeenWelcome: true,
			consentAcked: false,
			whatsNewEntries: [release],
		});

		expect(steps.map((step) => step.type)).toEqual([
			"whats-new",
			"consent",
		]);
	});
});

describe("onboardingWizardReducer", () => {
	it("only acknowledges the app version for the first-run session", () => {
		const firstRun = onboardingWizardReducer(createWizardState(), {
			type: "open",
			steps: [...WIZARD_FEATURE_STEPS],
			versionToAcknowledge: "1.9.0-beta.1",
		});
		const manualReplay = onboardingWizardReducer(firstRun, {
			type: "open",
			steps: [...WIZARD_FEATURE_STEPS],
			versionToAcknowledge: null,
		});

		expect(getWizardAcknowledgements(firstRun)).toEqual({
			consentWasSeen: false,
			latestWhatsNewVersion: "1.9.0-beta.1",
		});
		expect(getWizardAcknowledgements(manualReplay)).toEqual({
			consentWasSeen: false,
			latestWhatsNewVersion: null,
		});
	});

	it("remembers the furthest step reached after navigating back", () => {
		const steps = buildWizardSteps({
			hasSeenWelcome: true,
			consentAcked: false,
			whatsNewEntries: [release],
		});
		let state = createWizardState(steps);

		state = onboardingWizardReducer(state, { type: "next" });
		state = onboardingWizardReducer(state, { type: "previous" });

		expect(state.currentStep).toBe(0);
		expect(state.highestReachedStep).toBe(1);
		expect(getWizardAcknowledgements(state)).toEqual({
			consentWasSeen: true,
			latestWhatsNewVersion: "1.0.0",
		});
	});

	it("does not acknowledge steps the user never reached", () => {
		const steps = buildWizardSteps({
			hasSeenWelcome: false,
			consentAcked: false,
			whatsNewEntries: [release],
		});
		const state = createWizardState(steps);

		expect(getWizardAcknowledgements(state)).toEqual({
			consentWasSeen: false,
			latestWhatsNewVersion: null,
		});
	});
});
