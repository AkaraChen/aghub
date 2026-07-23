import { getStore } from ".";
import type { AnalyticsConsent } from "./index";
import { DEFAULT_ONBOARDING_PROGRESS, type OnboardingProgress } from "./types";

const ANALYTICS_CONSENT_KEY = "analyticsConsent";
const ANALYTICS_CONSENT_ACK_KEY = "analyticsConsentAcked";
const LAST_SEEN_WHATS_NEW_KEY = "lastSeenWhatsNewVersion";
const ONBOARDING_PROGRESS_KEY = "onboardingProgress";

function normalizeOnboardingProgress(
	value: Partial<OnboardingProgress> | null | undefined,
): OnboardingProgress {
	return {
		hasSeenWelcome: value?.hasSeenWelcome ?? false,
		completedTours: {
			productMap:
				value?.completedTours?.productMap ??
				DEFAULT_ONBOARDING_PROGRESS.completedTours.productMap,
			projectWorkflow:
				value?.completedTours?.projectWorkflow ??
				DEFAULT_ONBOARDING_PROGRESS.completedTours.projectWorkflow,
		},
	};
}

export async function getOnboardingProgress(): Promise<OnboardingProgress> {
	const store = await getStore();
	const progress = await store.get<OnboardingProgress>(
		ONBOARDING_PROGRESS_KEY,
	);

	return normalizeOnboardingProgress(progress);
}

async function saveOnboardingProgress(
	progress: Partial<OnboardingProgress>,
): Promise<OnboardingProgress> {
	const store = await getStore();
	const nextProgress = normalizeOnboardingProgress(progress);

	await store.set(ONBOARDING_PROGRESS_KEY, nextProgress);
	await store.save();

	return nextProgress;
}

export async function updateOnboardingProgress(updates: {
	hasSeenWelcome?: boolean;
	completedTours?: Partial<OnboardingProgress["completedTours"]>;
}): Promise<OnboardingProgress> {
	const current = await getOnboardingProgress();

	return saveOnboardingProgress({
		...current,
		...updates,
		completedTours: {
			...current.completedTours,
			...updates.completedTours,
		},
	});
}

interface OnboardingCompletion {
	analyticsConsent: AnalyticsConsent | null;
	lastSeenWhatsNewVersion: string | null;
}

export async function saveOnboardingCompletion(
	completion: OnboardingCompletion,
): Promise<void> {
	const store = await getStore();
	const previousValues = new Map<string, unknown>([
		[ANALYTICS_CONSENT_KEY, await store.get(ANALYTICS_CONSENT_KEY)],
		[ANALYTICS_CONSENT_ACK_KEY, await store.get(ANALYTICS_CONSENT_ACK_KEY)],
		[LAST_SEEN_WHATS_NEW_KEY, await store.get(LAST_SEEN_WHATS_NEW_KEY)],
		[ONBOARDING_PROGRESS_KEY, await store.get(ONBOARDING_PROGRESS_KEY)],
	]);
	const progress = normalizeOnboardingProgress(
		previousValues.get(ONBOARDING_PROGRESS_KEY) as
			Partial<OnboardingProgress> | undefined,
	);

	try {
		if (completion.analyticsConsent !== null) {
			await store.set(ANALYTICS_CONSENT_KEY, completion.analyticsConsent);
			await store.set(ANALYTICS_CONSENT_ACK_KEY, true);
		}
		if (completion.lastSeenWhatsNewVersion !== null) {
			await store.set(
				LAST_SEEN_WHATS_NEW_KEY,
				completion.lastSeenWhatsNewVersion,
			);
		}
		await store.set(ONBOARDING_PROGRESS_KEY, {
			...progress,
			hasSeenWelcome: true,
		});
		await store.save();
	} catch (error) {
		try {
			for (const [key, value] of previousValues) {
				if (value === undefined) {
					await store.delete(key);
				} else {
					await store.set(key, value);
				}
			}
		} catch (rollbackError) {
			throw new AggregateError(
				[error, rollbackError],
				"Failed to save or restore onboarding completion",
			);
		}
		throw error;
	}
}
