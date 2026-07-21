import { expect, test } from "@playwright/test";
import type { UsageStatusDto } from "../src/generated/dto";
import { installMocks } from "./mocks";

/**
 * Real-pipeline smoke for usage: the summary request passes through to the
 * actual `aghub-api` server (booted by playwright's webServer with
 * AGHUB_CCUSAGE_BIN pointing at e2e/fixtures/fake-ccusage.mjs), so genuine
 * ccusage JSON snapshots — camelCase fields, current Codex cache fields, and
 * generic-agent model breakdowns — run through the Rust parsers into DTOs and
 * onto the page. Only limits (an OAuth endpoint, needs real credentials) and
 * runtime status stay mocked.
 */

test.beforeEach(async ({ page }) => {
	const mocks = await installMocks(page);
	mocks.addAgent("codex", "Codex");
	mocks.addAgent("factory", "Factory");
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
	const status: UsageStatusDto = {
		version: "ccusage 99.0.0-e2e",
		reachable: true,
		error: null,
		latest_version: null,
		update_available: false,
	};
	await page.route("**/api/v1/usage/status**", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(status),
		}),
	);
});

test("usage page renders real ccusage JSON parsed by the backend", async ({
	page,
}) => {
	await page.goto("/usage");

	// Cross-agent summary from the upstream-aligned Claude, Codex, and Droid
	// report samples.
	await expect(page.getByText("$0.67")).toBeVisible();
	await expect(page.getByText("2.3K")).toBeVisible();

	// Claude's row carries its parsed snapshot totals.
	await expect(page.getByText("1.9K")).toBeVisible();
	await expect(page.getByText("$0.42")).toBeVisible();

	// Codex's current field names made it through: reasoning and cache-read
	// tokens are non-zero breakdown rows.
	const usage = page.getByLabel("Usage", { exact: true });
	const codexRow = usage
		.getByText("Codex", { exact: true })
		.locator("..")
		.locator("..")
		.locator("..");
	const reasoning = codexRow
		.getByText("Reasoning", { exact: true })
		.locator("..");
	const cacheRead = codexRow
		.getByText("Cache read", { exact: true })
		.locator("..");
	await expect(reasoning.getByText("2", { exact: true })).toBeVisible();
	await expect(cacheRead.getByText("110", { exact: true })).toBeVisible();

	// Day-level data landed too — the stacked strip has both agents.
	const strip = page.getByRole("img", { name: "Daily usage by agent" });
	await expect(strip).toBeVisible();
	await expect(
		page.getByLabel("Usage", { exact: true }).getByText("Factory"),
	).toBeVisible();
});
