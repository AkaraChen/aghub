import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export const ONBOARDING_WINDOW_LABEL = "onboarding";

export async function openOnboardingWindow() {
	const existingWindow = await WebviewWindow.getByLabel(
		ONBOARDING_WINDOW_LABEL,
	);

	if (existingWindow) {
		await existingWindow.setFocus();
		return existingWindow;
	}

	return await new Promise<WebviewWindow>((resolve, reject) => {
		const onboardingWindow = new WebviewWindow(ONBOARDING_WINDOW_LABEL, {
			title: "Welcome to aghub",
			url: "/onboarding",
			width: 1120,
			height: 760,
			minWidth: 960,
			minHeight: 680,
			center: true,
			focus: true,
			preventOverflow: true,
			decorations: true,
			hiddenTitle: true,
			titleBarStyle: "overlay",
		});

		void onboardingWindow.once("tauri://created", () => {
			resolve(onboardingWindow);
		});

		void onboardingWindow.once("tauri://error", (event) => {
			const message =
				typeof event.payload === "string"
					? event.payload
					: "Failed to open onboarding window";
			reject(new Error(message));
		});
	});
}
