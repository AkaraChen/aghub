import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

interface UpdateTestState {
	clearUpdateChecks: () => void;
	getStoreValue: (key: string) => unknown;
	getUpdateChecks: () => string[];
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
