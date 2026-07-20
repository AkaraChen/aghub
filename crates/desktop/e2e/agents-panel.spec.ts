import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

test.beforeEach(async ({ page }) => {
	await installMocks(page);
	await page.goto("/settings?tab=agents");
	await expect(page.getByText("Claude", { exact: true })).toBeVisible();
});

test("an agent can be disabled and enabled again", async ({ page }) => {
	const toggle = page.getByRole("switch", { name: "Toggle Claude" });
	const control = page
		.locator('[data-slot="switch-content"]')
		.filter({ has: toggle });

	await expect(toggle).toBeChecked();
	await control.click();
	await expect(toggle).not.toBeChecked();
	await control.click();
	await expect(toggle).toBeChecked();
});
