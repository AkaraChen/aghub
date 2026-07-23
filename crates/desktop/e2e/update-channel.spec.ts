import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

interface UpdateTestState {
	clearUpdateChecks: () => void;
	finishUpdateInstall: () => void;
	getStoreValue: (key: string) => unknown;
	getUpdateChecks: () => string[];
	setAvailableUpdate: () => void;
}

test.beforeEach(async ({ page }) => {
	await installMocks(page);
});

test("beta updates stay opt-in and are persisted before checking", async ({
	page,
}) => {
	await page.goto("/settings?tab=application");

	const betaUpdates = page.getByLabel("Receive beta updates");
	await expect(betaUpdates).not.toBeChecked();
	await expect
		.poll(() =>
			page.evaluate(() =>
				(
					window as unknown as {
						__AGHUB_E2E__: UpdateTestState;
					}
				).__AGHUB_E2E__
					.getUpdateChecks()
					.at(0),
			),
		)
		.toBe("stable");

	await betaUpdates.focus();
	await betaUpdates.press("Space");
	await expect(betaUpdates).toBeChecked();
	await expect
		.poll(() =>
			page.evaluate(() =>
				(
					window as unknown as {
						__AGHUB_E2E__: UpdateTestState;
					}
				).__AGHUB_E2E__.getStoreValue("updateChannel"),
			),
		)
		.toBe("beta");

	await page.evaluate(() =>
		(
			window as unknown as {
				__AGHUB_E2E__: UpdateTestState;
			}
		).__AGHUB_E2E__.clearUpdateChecks(),
	);
	await page.getByRole("button", { name: "Check for Updates" }).click();
	await expect
		.poll(() =>
			page.evaluate(() =>
				(
					window as unknown as {
						__AGHUB_E2E__: UpdateTestState;
					}
				).__AGHUB_E2E__
					.getUpdateChecks()
					.at(-1),
			),
		)
		.toBe("beta");
});

test("download action stays legible in dark mode while pending", async ({
	page,
}) => {
	await page.addInitScript(() => localStorage.setItem("theme", "dark"));
	await page.goto("/settings?tab=application");
	await expect(page.locator("html")).toHaveClass(/dark/);
	await page.evaluate(() =>
		(
			window as unknown as {
				__AGHUB_E2E__: UpdateTestState;
			}
		).__AGHUB_E2E__.setAvailableUpdate(),
	);

	await page.getByRole("button", { name: "Check for Updates" }).click();
	await page.getByRole("button", { name: "Download and Install" }).click();

	const pendingButton = page.getByRole("button", {
		name: "Downloading update...",
	});
	await expect(pendingButton).toHaveAttribute("data-pending", "true");
	await expect(pendingButton.locator('[data-slot="spinner"]')).toBeVisible();
	await expect(pendingButton).toHaveCSS("opacity", "1");

	await page.evaluate(() =>
		(
			window as unknown as {
				__AGHUB_E2E__: UpdateTestState;
			}
		).__AGHUB_E2E__.finishUpdateInstall(),
	);
});
