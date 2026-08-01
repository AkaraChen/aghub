import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

test("reports a failed desktop navigation subscription", async ({ page }) => {
	await installMocks(page);
	await page.addInitScript(() => {
		const tauriWindow = window as typeof window & {
			isTauri: boolean;
			__TAURI_INTERNALS__: {
				invoke: (
					command: string,
					args?: Record<string, unknown>,
				) => Promise<unknown>;
			};
		};
		tauriWindow.isTauri = true;
		const invoke = tauriWindow.__TAURI_INTERNALS__.invoke;
		tauriWindow.__TAURI_INTERNALS__.invoke = (command, args) => {
			if (
				command === "plugin:event|listen" &&
				args?.event === "navigate"
			) {
				return Promise.reject(new Error("navigation listener failed"));
			}
			return invoke(command, args);
		};
	});

	const subscriptionError = page.waitForEvent(
		"console",
		(message) =>
			message.type() === "error" &&
			message.text().includes("Failed to subscribe to navigation events"),
	);
	await page.goto("/");

	await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
	await expect(subscriptionError).resolves.toBeDefined();
});
