import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

/**
 * ccusage usage feature smoke: the Settings → Usage panel and its fixed-slot
 * layout editor render, and a home agent card renders the customized usage
 * block (quota bars + stat slots) from a mocked report. Boots the app through
 * the shared Tauri/API mocks, so it also guards the rebase integration (the
 * card merged against main's refined overview).
 */

const usageReport = {
	agents: [
		{
			agent: "claude",
			days: [],
			totals: {
				input_tokens: 400_000,
				output_tokens: 120_000,
				cache_creation_tokens: 10_000,
				cache_read_tokens: 900_000,
				reasoning_tokens: 0,
				total_tokens: 1_430_000,
				cost_usd: 12.5,
			},
		},
	],
	generated_at: "2026-07-03T00:00:00Z",
	ccusage_version: "ccusage 20.0.6",
	warnings: [],
};

const limitsReport = {
	agents: [
		{
			agent: "claude",
			windows: [
				{ kind: "5h", utilization_pct: 42, resets_at: null },
				{ kind: "weekly", utilization_pct: 71, resets_at: null },
			],
		},
	],
	generated_at: "2026-07-03T00:00:00Z",
	warnings: [],
};

test.beforeEach(async ({ page }) => {
	await installMocks(page);
	// Registered after installMocks' catch-all, so these win for usage paths.
	await page.route("**/api/v1/usage/summary**", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(usageReport),
		}),
	);
	await page.route("**/api/v1/usage/limits**", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(limitsReport),
		}),
	);
});

test("Usage settings panel and layout editor render", async ({ page }) => {
	await page.goto("/settings?tab=usage");

	// Sidecar card + the fixed-slot layout editor's two panes.
	await expect(page.getByText("Auto-discover ccusage")).toBeVisible();
	await expect(page.getByText("Card layout", { exact: true })).toBeVisible();
	await expect(page.getByText("Home card", { exact: true })).toBeVisible();
	await expect(
		page.getByText("Available fields", { exact: true }),
	).toBeVisible();
	// A bar slot and a stat slot render inside the preview.
	await expect(page.getByText("5-hour limit").first()).toBeVisible();
	await expect(page.getByText("Total tokens").first()).toBeVisible();

	await page.screenshot({
		path: "artifacts/usage-settings-panel.png",
		fullPage: true,
	});

	await page.screenshot({
		path: "artifacts/usage-settings-panel.png",
		fullPage: true,
	});
});

test("home agent card renders the customized usage block", async ({ page }) => {
	await page.goto("/");

	const claudeCard = page
		.getByRole("region", { name: "Your agents" })
		.getByText("Claude", { exact: true });
	await expect(claudeCard).toBeVisible();

	// Quota bar utilization from the mocked limits report proves the slot-driven
	// usage block rendered (default window slots: 5h, weekly, weekly_opus).
	await expect(page.getByText("42%")).toBeVisible();
	await expect(page.getByText("71%")).toBeVisible();

	await page.screenshot({ path: "artifacts/home-usage-card.png" });
});
