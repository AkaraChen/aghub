import { expect, test } from "@playwright/test";
import type { UsageStatusDto } from "../src/generated/dto";
import { installMocks } from "./mocks";

/**
 * Dedicated /usage page smoke: cross-agent summary stats and the stacked
 * daily-activity strip up top, then one row per agent the summary reports,
 * with a totals breakdown that drops zero-valued rows and the ccusage status
 * chip. Boots through the shared Tauri/API mocks.
 */

let limitsRequests = 0;

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
};

test.beforeEach(async ({ page }) => {
	limitsRequests = 0;
	const mocks = await installMocks(page);
	mocks.addAgent("codex", "Codex");
	mocks.addAgent("opencode", "OpenCode");
	mocks.addAgent("factory", "Factory");
	await page.route("**/api/v1/usage/summary**", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(summary),
		}),
	);
	await page.route("**/api/v1/usage/limits**", (route) => {
		limitsRequests += 1;
		return route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(limits),
		});
	});
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
	const usageStatus = page.getByRole("status").filter({
		hasText: "v20.0.17 available",
	});
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
	for (const testId of ["usage-summary-strip", "usage-chart-legend"]) {
		const surface = page.getByTestId(testId);
		const idleBackground = await surface.evaluate(
			(element) => getComputedStyle(element).backgroundColor,
		);
		await surface.hover();
		await expect
			.poll(() =>
				surface.evaluate(
					(element) => getComputedStyle(element).backgroundColor,
				),
			)
			.not.toBe(idleBackground);
	}

	// The stacked daily strip renders with a legend entry for the one agent
	// that has day-level data ("Claude" also appears on its row → first()).
	await expect(
		page.getByRole("img", { name: "Daily usage by agent" }),
	).toBeVisible();
	await expect(
		page.getByText("Claude", { exact: true }).first(),
	).toBeVisible();

	// This route is statistical. Quota windows remain on the home cards and in
	// settings, while each row here keeps cost and token breakdowns only.
	await expect(page.getByText("5-hour limit", { exact: true })).toHaveCount(
		0,
	);
	await expect(page.getByText("Weekly limit", { exact: true })).toHaveCount(
		0,
	);
	expect(limitsRequests).toBe(0);
	await expect(page.getByText("$12.50").first()).toBeVisible();
	await expect(page.getByText("Cache read", { exact: true })).toBeVisible();

	// A usage-only agent (gemini) uses the same statistical row.
	await expect(page.getByText("Gemini", { exact: true })).toBeVisible();

	const agentCards = page.getByTestId("usage-agent-card");
	await expect(agentCards).toHaveCount(2);
	await expect(agentCards.first()).toHaveAttribute("data-slot", "card");
	const pageSurface = agentCards
		.first()
		.locator(
			"xpath=ancestor::*[contains(@class, 'surface--secondary')][1]",
		);
	const [cardBackground, pageBackground] = await Promise.all([
		agentCards
			.first()
			.evaluate((element) => getComputedStyle(element).backgroundColor),
		pageSurface.evaluate(
			(element) => getComputedStyle(element).backgroundColor,
		),
	]);
	expect(cardBackground).not.toBe(pageBackground);

	const borderBeforeHover = await agentCards
		.first()
		.evaluate((element) => getComputedStyle(element).borderTopColor);
	await agentCards.first().hover();
	await expect
		.poll(() =>
			agentCards
				.first()
				.evaluate(
					(element) => getComputedStyle(element).borderTopColor,
				),
		)
		.not.toBe(borderBeforeHover);
});

test("statistical rows stay within an 800px desktop width", async ({
	page,
}) => {
	await page.setViewportSize({ width: 800, height: 650 });
	await page.goto("/usage");

	await expect(page.getByText("5-hour limit", { exact: true })).toHaveCount(
		0,
	);
	await expect(page.getByText("Weekly limit", { exact: true })).toHaveCount(
		0,
	);
	await expect(page.getByText("Cache read", { exact: true })).toBeVisible();

	const pageScroller = page.locator("main > div").first();
	const overflow = await pageScroller.evaluate((element) => ({
		client: element.clientWidth,
		scroll: element.scrollWidth,
	}));
	expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
});

test("usage page reports summary failures instead of an empty report", async ({
	page,
}) => {
	await page.route("**/api/v1/usage/summary**", (route) =>
		route.fulfill({
			status: 500,
			contentType: "application/json",
			body: JSON.stringify({ error: "ccusage report failed" }),
		}),
	);

	await page.goto("/usage");

	await expect(page.getByText("ccusage report failed")).toBeVisible();
	await expect(page.getByText("No usage data yet.")).toHaveCount(0);
});

test("usage page shows a report warning when no agent data is available", async ({
	page,
}) => {
	await page.route("**/api/v1/usage/summary**", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				...summary,
				agents: [],
				warnings: ["Claude usage unavailable: session expired"],
			}),
		}),
	);

	await page.goto("/usage");

	await expect(
		page.getByText("Claude usage unavailable: session expired"),
	).toBeVisible();
	await expect(page.getByText("No usage data yet.")).toHaveCount(0);
});

test("usage range follows the selected timezone and polling interval", async ({
	page,
}) => {
	await page.clock.setFixedTime(new Date("2026-07-20T01:00:00Z"));
	const summaryRequests: URL[] = [];
	await page.route("**/api/v1/usage/summary**", async (route) => {
		summaryRequests.push(new URL(route.request().url()));
		await route.fallback();
	});

	await page.goto("/settings?tab=usage");
	await page.getByRole("button", { name: "Advanced" }).click();
	await page.getByRole("button", { name: "Timezone" }).click();
	await page.getByRole("option", { name: "America/Los_Angeles" }).click();
	const pollingInput = page.locator('input[aria-label="Polling interval"]');
	await pollingInput.fill("1");
	await pollingInput.press("Tab");
	await page.getByRole("link", { name: "Usage", exact: true }).click();

	await expect
		.poll(() => summaryRequests.length, { timeout: 3_000 })
		.toBeGreaterThanOrEqual(2);
	const firstRequest = summaryRequests[0];
	expect(firstRequest.searchParams.get("since")).toBe("20260620");
	expect(firstRequest.searchParams.get("until")).toBe("20260719");
	expect(firstRequest.searchParams.get("timezone")).toBe(
		"America/Los_Angeles",
	);
});

test("all-time usage omits date bounds and removes the active-day denominator", async ({
	page,
}) => {
	const summaryRequests: URL[] = [];
	await page.route("**/api/v1/usage/summary**", async (route) => {
		summaryRequests.push(new URL(route.request().url()));
		await route.fallback();
	});
	await page.goto("/settings?tab=usage");
	await page.getByRole("button", { name: "Usage time range" }).click();
	await page.getByRole("option", { name: "All time" }).click();
	await page.getByRole("link", { name: "Usage", exact: true }).click();

	await expect(page.getByText("All time", { exact: true })).toBeVisible();
	await expect(page.getByText("2", { exact: true }).first()).toBeVisible();
	await expect(page.getByText("2 / 30", { exact: true })).toHaveCount(0);
	await expect.poll(() => summaryRequests.length).toBeGreaterThan(0);
	const request = summaryRequests[0];
	expect(request.searchParams.has("since")).toBe(false);
	expect(request.searchParams.has("until")).toBe(false);
});

test("daily chart aggregates agents after the first three", async ({
	page,
}) => {
	await page.clock.setFixedTime(new Date("2026-07-15T12:00:00Z"));
	const totals = (total: number) => ({
		input_tokens: total,
		output_tokens: 0,
		cache_creation_tokens: 0,
		cache_read_tokens: 0,
		reasoning_tokens: 0,
		total_tokens: total,
		cost_usd: null,
	});
	const agents = [
		["claude", 10],
		["gemini", 20],
		["codex", 30],
		["opencode", 40],
		["factory", 50],
	].map(([id, total]) =>
		agent(String(id), totals(Number(total)), [
			day("2026-07-15", Number(total)),
		]),
	);
	await page.route("**/api/v1/usage/summary**", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ ...summary, agents }),
		}),
	);

	await page.goto("/usage");

	await expect(page.getByText("Other agents", { exact: true })).toBeVisible();
	await expect(page.getByText("OpenCode", { exact: true })).toBeVisible();
	await expect(page.getByText("Factory", { exact: true })).toBeVisible();
	await expect(page.getByTitle(/Jul 15 · 150$/)).toBeVisible();
});
