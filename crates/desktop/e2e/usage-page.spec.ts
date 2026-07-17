import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

/**
 * Dedicated /usage page smoke: cross-agent summary stats and the stacked
 * daily-activity strip up top, then one row per agent the summary reports,
 * with quota bars for the quota agents (claude/codex), a totals breakdown
 * that drops zero-valued rows, and the ccusage status chip. Boots through
 * the shared Tauri/API mocks.
 */

const agent = (
	id: string,
	totals: Record<string, number | null>,
	days: Record<string, unknown>[] = [],
) => ({
	agent: id,
	days,
	totals,
});

const day = (date: string, total: number) => ({
	date,
	input_tokens: Math.round(total * 0.3),
	output_tokens: Math.round(total * 0.1),
	cache_creation_tokens: 0,
	cache_read_tokens: Math.round(total * 0.6),
	reasoning_tokens: 0,
	total_tokens: total,
	cost_usd: total === 0 ? null : (total / 1_000_000) * 9,
	models: [],
});

const summary = {
	agents: [
		agent(
			"claude",
			{
				input_tokens: 420_000,
				output_tokens: 130_000,
				cache_creation_tokens: 12_000,
				cache_read_tokens: 910_000,
				reasoning_tokens: 0,
				total_tokens: 1_472_000,
				cost_usd: 12.5,
			},
			[
				day("2026-07-13", 40_000),
				day("2026-07-14", 0),
				day("2026-07-15", 80_000),
			],
		),
		agent("gemini", {
			input_tokens: 12_000,
			output_tokens: 5_000,
			cache_creation_tokens: 0,
			cache_read_tokens: 0,
			reasoning_tokens: 0,
			total_tokens: 17_000,
			cost_usd: null,
		}),
	],
	generated_at: "2026-07-15T00:00:00Z",
	ccusage_version: "ccusage 20.0.6",
	warnings: [],
};

const limits = {
	agents: [
		{
			agent: "claude",
			windows: [
				{ kind: "5h", utilization_pct: 42, resets_at: null },
				{ kind: "weekly", utilization_pct: 71, resets_at: null },
			],
		},
	],
	generated_at: "2026-07-15T00:00:00Z",
	warnings: [],
};

const status = {
	version: "ccusage 20.0.6",
	reachable: true,
	error: null,
	latest_version: "20.0.17",
	update_available: true,
};

test.beforeEach(async ({ page }) => {
	await installMocks(page);
	await page.route("**/api/v1/usage/summary**", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(summary),
		}),
	);
	await page.route("**/api/v1/usage/limits**", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(limits),
		}),
	);
	await page.route("**/api/v1/usage/status**", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(status),
		}),
	);
});

test("usage page shows summary, daily strip, and per-agent rows", async ({
	page,
}) => {
	await page.goto("/usage");

	await expect(page.getByRole("heading", { name: "Usage" })).toBeVisible();

	// Status chip: version + inline update hint.
	await expect(page.getByText("20.0.17 available")).toBeVisible();

	// Cross-agent summary stats: spend total and active days (2 of the 3
	// mocked days carry usage).
	await expect(page.getByText("Total spend")).toBeVisible();
	await expect(page.getByText("2 / 30")).toBeVisible();

	// The stacked daily strip renders with a legend entry for the one agent
	// that has day-level data ("Claude" also appears on its row → first()).
	await expect(
		page.getByRole("img", { name: "Daily usage by agent" }),
	).toBeVisible();
	await expect(
		page.getByText("Claude", { exact: true }).first(),
	).toBeVisible();

	// A quota agent (claude) renders its rate-limit bars...
	await expect(page.getByText("42%")).toBeVisible();
	await expect(page.getByText("71%")).toBeVisible();
	// ...and its cost (also in the summary stat → first()) + a non-zero
	// breakdown row.
	await expect(page.getByText("$12.50").first()).toBeVisible();
	await expect(page.getByText("Cache read", { exact: true })).toBeVisible();

	// A usage-only agent (gemini) shows totals but no quota bars.
	await expect(page.getByText("Gemini", { exact: true })).toBeVisible();
});
