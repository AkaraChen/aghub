import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

/**
 * Real-pipeline smoke for usage: the summary request passes through to the
 * actual `aghub-api` server (booted by playwright's webServer with
 * AGHUB_CCUSAGE_BIN pointing at e2e/fixtures/fake-ccusage.mjs), so genuine
 * ccusage JSON — camelCase fields, codex 20.0.14+ names, null costs — runs
 * through the Rust parsers into DTOs and onto the page. Only limits (an
 * OAuth endpoint, needs real credentials) and status (queries npm) stay
 * mocked.
 */

test.beforeEach(async ({ page }) => {
	await installMocks(page);
	// Let the summary through to the real server, past installMocks'
	// catch-all (later routes win; continue() sends it to the network).
	await page.route("**/api/v1/usage/summary**", (route) => route.continue());
	await page.route("**/api/v1/usage/limits**", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				agents: [],
				generated_at: "2026-07-17T00:00:00Z",
				warnings: [],
			}),
		}),
	);
	await page.route("**/api/v1/usage/status**", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				version: "ccusage 99.0.0-e2e",
				reachable: true,
				error: null,
				latest_version: null,
				update_available: false,
			}),
		}),
	);
});

test("usage page renders real ccusage JSON parsed by the backend", async ({
	page,
}) => {
	await page.goto("/usage");

	// Cross-agent summary from the fixture totals: 12.5 (claude) + 0.5
	// (codex) spend, 943K + 340K tokens.
	await expect(page.getByText("$13.00")).toBeVisible();
	await expect(page.getByText("1.3M")).toBeVisible();

	// Claude's row carries its parsed totals (943K tokens, $12.50).
	await expect(page.getByText("943K")).toBeVisible();
	await expect(page.getByText("$12.50")).toBeVisible();

	// Codex's 20.0.14+ field names made it through: reasoning and cache
	// read tokens are non-zero breakdown rows.
	await expect(page.getByText("Reasoning", { exact: true })).toBeVisible();
	await expect(page.getByText("20K", { exact: true })).toBeVisible();
	await expect(page.getByText("40K", { exact: true })).toBeVisible();

	// Day-level data landed too — the stacked strip has both agents.
	const strip = page.getByRole("img", { name: "Daily usage by agent" });
	await expect(strip).toBeVisible();
});
