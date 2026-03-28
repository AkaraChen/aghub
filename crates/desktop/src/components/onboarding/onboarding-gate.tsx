import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useOnboardingStatus } from "../../hooks/use-onboarding";
import {
	ONBOARDING_WINDOW_LABEL,
	openOnboardingWindow,
} from "../../lib/onboarding-window";

export function OnboardingGate() {
	const [location] = useLocation();
	const { data: onboardingCompleted } = useOnboardingStatus();
	const hasOpenedWindowRef = useRef(false);

	useEffect(() => {
		if (hasOpenedWindowRef.current || onboardingCompleted !== false) {
			return;
		}

		if (location === "/onboarding") {
			return;
		}

		if (getCurrentWebviewWindow().label === ONBOARDING_WINDOW_LABEL) {
			return;
		}

		hasOpenedWindowRef.current = true;
		void openOnboardingWindow().catch((error) => {
			console.error("Failed to open onboarding window:", error);
			hasOpenedWindowRef.current = false;
		});
	}, [location, onboardingCompleted]);

	return null;
}
