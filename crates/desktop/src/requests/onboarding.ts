import { queryOptions } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { buildWizardSteps, type WizardStep } from "../lib/onboarding-wizard";
import {
	getAnalyticsConsent,
	getConsentAcked,
	getLastSeenWhatsNewVersion,
	getOnboardingProgress,
} from "../lib/store";
import { pendingWhatsNew, WHATS_NEW_ENTRIES } from "../lib/whats-new";
import { queryKeys } from "./keys";

export interface OnboardingBootstrap {
	analyticsOptIn: boolean;
	steps: WizardStep[];
	versionToAcknowledge: string | null;
}

async function loadOnboardingBootstrap(): Promise<OnboardingBootstrap> {
	const [progress, consentAcked, consent, lastSeen, version] =
		await Promise.all([
			getOnboardingProgress(),
			getConsentAcked(),
			getAnalyticsConsent(),
			getLastSeenWhatsNewVersion(),
			getVersion(),
		]);
	const whatsNewEntries = pendingWhatsNew(
		lastSeen,
		version,
		WHATS_NEW_ENTRIES,
	);

	return {
		analyticsOptIn: consent === "granted",
		steps: buildWizardSteps({
			hasSeenWelcome: progress.hasSeenWelcome,
			consentAcked,
			whatsNewEntries,
		}),
		versionToAcknowledge: progress.hasSeenWelcome ? null : version,
	};
}

export function onboardingBootstrapQueryOptions() {
	return queryOptions({
		queryKey: queryKeys.onboarding.bootstrap(),
		queryFn: loadOnboardingBootstrap,
		retry: false,
		staleTime: Infinity,
		gcTime: 0,
	});
}
