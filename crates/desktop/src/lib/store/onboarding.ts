import { getStore } from ".";
import { DEFAULT_ONBOARDING_PROGRESS, type OnboardingProgress } from "./types";

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
	const progress = await store.get<OnboardingProgress>("onboardingProgress");

	return normalizeOnboardingProgress(progress);
}

export async function saveOnboardingProgress(
	progress: Partial<OnboardingProgress>,
): Promise<OnboardingProgress> {
	const store = await getStore();
	const nextProgress = normalizeOnboardingProgress(progress);

	await store.set("onboardingProgress", nextProgress);
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
