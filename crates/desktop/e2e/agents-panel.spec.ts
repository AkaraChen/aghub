import { expect, test } from "@playwright/test";
import { agentAvailability, agentInfo, e2eApiUrl, installMocks } from "./mocks";

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
	await page.route(e2eApiUrl("/agents"), (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify([agentInfo("jetbrains-ai", "JetBrains AI")]),
		}),
	);
	await page.route(e2eApiUrl("/agents/availability"), (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify([agentAvailability("jetbrains-ai")]),
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

test("separates detected and configurable Agents", async ({ page }) => {
	await page.route(e2eApiUrl("/agents"), (route) =>
		route.fulfill({
			json: [
				agentInfo("claude", "Claude"),
				agentInfo("grok", "Grok Build"),
			],
		}),
	);
	await page.route(e2eApiUrl("/agents/availability"), (route) =>
		route.fulfill({
			json: [
				agentAvailability("claude"),
				agentAvailability("grok", "not_detected", false),
			],
		}),
	);

	await page.goto("/settings?tab=agents");

	const yourAgents = page.getByRole("region", { name: "Your Agents" });
	const supportedAgents = page.getByRole("region", {
		name: "Supported Agents",
	});
	await expect(yourAgents.getByText("Claude", { exact: true })).toBeVisible();
	await expect(
		supportedAgents.getByText("Grok Build", { exact: true }),
	).toBeVisible();
	await expect(
		supportedAgents.getByText("Configuration can be prepared"),
	).toBeVisible();
});
