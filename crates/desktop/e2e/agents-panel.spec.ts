import { expect, test } from "@playwright/test";
import { agentInfo, installMocks } from "./mocks";

test.beforeEach(async ({ page }) => {
	await installMocks(page);
});

test("an agent can be disabled and enabled again", async ({ page }) => {
	await page.goto("/settings?tab=agents");
	await expect(page.getByText("Claude", { exact: true })).toBeVisible();
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

test("JetBrains AI uses its bundled icon", async ({ page }) => {
	await page.route("http://localhost:45999/api/v1/agents", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify([agentInfo("jetbrains-ai", "JetBrains AI")]),
		}),
	);
	await page.route(
		"http://localhost:45999/api/v1/agents/availability",
		(route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify([
					{
						id: "jetbrains-ai",
						has_global_directory: true,
						has_cli: true,
						is_available: true,
					},
				]),
			}),
	);

	await page.goto("/settings?tab=agents");
	const card = page
		.getByText("JetBrains AI", { exact: true })
		.locator('xpath=ancestor::*[@data-slot="card"][1]');
	await expect(card).toBeVisible();
	await expect(card.locator('[data-slot="avatar-fallback"]')).toHaveCount(0);
	await expect(card.locator("svg")).toHaveCount(1);
});
