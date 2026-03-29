export type OnboardingTourId =
	| "product-map"
	| "project-workflow"
	| "project-setup";

export type OnboardingCommand =
	| { type: "show-welcome" }
	| { type: "start-tour"; tour: OnboardingTourId };

export const ONBOARDING_EVENT = "aghub:onboarding";

export function dispatchOnboardingCommand(command: OnboardingCommand) {
	if (typeof window === "undefined") {
		return;
	}

	window.dispatchEvent(
		new CustomEvent<OnboardingCommand>(ONBOARDING_EVENT, {
			detail: command,
		}),
	);
}
