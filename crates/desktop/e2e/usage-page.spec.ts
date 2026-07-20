import { expect, test } from "@playwright/test";
import type { UsageStatusDto } from "../src/generated/dto";
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

const status: UsageStatusDto = {
	version: "ccusage 20.0.6",
	reachable: true,
	error: null,
	latest_version: "20.0.17",
	update_available: true,
	source: "bundled",
	can_install: true,
	can_update: true,
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

	// Version and update availability stay together as quiet, unboxed status
	// text. Installation and update actions live in Settings.
	const usageStatus = page.getByRole("status");
	const updateHint = usageStatus.getByText("v20.0.17 available", {
		exact: true,
	});
	await expect(usageStatus).toContainText("20.0.6");
	await expect(updateHint).toBeVisible();
	await expect(updateHint.locator("xpath=ancestor::button")).toHaveCount(0);
	const updateHintStyle = await updateHint.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			backgroundColor: style.backgroundColor,
			borderBottomWidth: style.borderBottomWidth,
			borderLeftWidth: style.borderLeftWidth,
			borderRightWidth: style.borderRightWidth,
			borderTopWidth: style.borderTopWidth,
		};
	});
	expect(updateHintStyle).toEqual({
		backgroundColor: "rgba(0, 0, 0, 0)",
		borderBottomWidth: "0px",
		borderLeftWidth: "0px",
		borderRightWidth: "0px",
		borderTopWidth: "0px",
	});

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

test("quota labels remain readable at an 800px desktop width", async ({
	page,
}) => {
	await page.setViewportSize({ width: 800, height: 650 });
	await page.goto("/usage");

	for (const name of ["5-hour limit", "Weekly limit"]) {
		const label = page.getByText(name, { exact: true });
		await expect(label).toBeVisible();
		const geometry = await label.evaluate((element) => {
			const header = element.closest(".justify-between");
			const value = header?.lastElementChild;
			if (
				!(header instanceof HTMLElement) ||
				!(value instanceof HTMLElement)
			) {
				throw new TypeError("quota label geometry missing");
			}
			const labelBox = element.getBoundingClientRect();
			const textRange = document.createRange();
			textRange.selectNodeContents(element);
			const textBox = textRange.getBoundingClientRect();
			return {
				allocatedWidth: labelBox.width,
				textWidth: textBox.width,
				textRight: textBox.right,
				valueLeft: value.getBoundingClientRect().left,
			};
		});
		expect(
			geometry.allocatedWidth + 0.5,
			`${name} must not be visually clipped`,
		).toBeGreaterThanOrEqual(geometry.textWidth);
		expect(geometry.textRight).toBeLessThanOrEqual(geometry.valueLeft);
	}

	const pageScroller = page.locator("main > div").first();
	const overflow = await pageScroller.evaluate((element) => ({
		client: element.clientWidth,
		scroll: element.scrollWidth,
	}));
	expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
});
