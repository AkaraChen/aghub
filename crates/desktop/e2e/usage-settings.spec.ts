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

const statusReport = {
	version: "ccusage 20.0.6",
	reachable: true,
	error: null,
	latest_version: "20.0.17",
	update_available: true,
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
	await page.route("**/api/v1/usage/status**", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(statusReport),
		}),
	);
});

test("Usage settings panel and layout editor render", async ({ page }) => {
	await page.goto("/settings?tab=usage");

	// Sidecar card + the layout editor's inspector block.
	await expect(page.getByText("Auto-discover ccusage")).toBeVisible();
	await expect(page.getByText("Card layout", { exact: true })).toBeVisible();

	// The card replica shows the shown fields as placeholders (no live
	// data), and the drawer lists what's hidden.
	await expect(page.getByText("5-hour limit").first()).toBeVisible();
	await expect(page.getByText("Total tokens").first()).toBeVisible();
	await expect(page.getByText("Not shown", { exact: true })).toBeVisible();
	await expect(page.getByText("Cache read", { exact: true })).toBeVisible();
	await expect(
		page.locator(
			'[data-testid="layout-card-replica"] [role="button"] button',
		),
	).toHaveCount(0);

	// Sidecar status row: version + inline update hint in the description,
	// plus the update + re-check actions.
	await expect(page.getByText("20.0.17 available")).toBeVisible();
	await expect(page.getByRole("button", { name: "Update" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Re-check" })).toBeVisible();

	// Agent enablement has one owner in Settings → Agents; Usage only keeps
	// quota-specific alert overrides.
	await expect(page.getByTestId("tracked-agents")).toHaveCount(0);

	// Alerts: one row per quota agent with the resolved-global threshold.
	await expect(
		page.getByRole("button", { name: "Use global (80%)" }).first(),
	).toBeVisible();

	// A specific agent's editor only offers that agent's fields: Codex
	// reports no Opus window, so switching the target drops it.
	await expect(page.getByText("Weekly (Opus)")).toBeVisible();
	await page.getByRole("button", { name: "Editing layout for" }).click();
	await page.getByRole("option", { name: "Codex" }).click();
	await expect(page.getByText("Weekly (Opus)")).toBeHidden();
	await expect(page.getByText("Reasoning")).toBeVisible();
	await page.getByRole("button", { name: "Editing layout for" }).click();
	await page.getByRole("option", { name: "Default" }).click();

	// Advanced knobs are collapsed by default and expand on demand.
	await expect(page.getByText("Polling interval")).toBeHidden();
	await page.getByRole("button", { name: "Advanced" }).click();
	await expect(page.getByText("Polling interval")).toBeVisible();
	await expect(
		page.locator('[data-slot="number-field"]').first(),
	).toHaveClass(/number-field--secondary/);

	// Auto-discover is on by default, so the resolved binary (from the Tauri
	// mock) shows as a hint under the toggle.
	await expect(page.getByText("/usr/local/bin/ccusage")).toBeVisible();

	await page.screenshot({
		path: "artifacts/usage-settings-panel.png",
		fullPage: true,
	});
});

test("hidden layout rows use a surface hover instead of fading", async ({
	page,
}) => {
	await page.goto("/settings?tab=usage");

	const drawer = page.getByTestId("layout-hidden-drawer");
	await page
		.getByTestId("layout-card-replica")
		.getByRole("button", { name: "Remove Total tokens", exact: true })
		.click();
	const row = drawer.getByTestId("layout-hidden-item-totalTokens");
	const idleBackground = await row.evaluate(
		(element) => getComputedStyle(element).backgroundColor,
	);

	await row.hover();
	await expect
		.poll(() =>
			row.evaluate(
				(element) => getComputedStyle(element).backgroundColor,
			),
		)
		.not.toBe(idleBackground);
	await expect(row).not.toHaveClass(/opacity-70/);
});

test("layout editor moves a field between the card and the drawer", async ({
	page,
}) => {
	await page.goto("/settings?tab=usage");

	const card = page.getByTestId("layout-card-replica");
	const drawer = page.getByTestId("layout-hidden-drawer");
	await expect(card.getByText("Total tokens")).toBeVisible();

	// Hide via the eye button: the field leaves the card and lands in the
	// drawer. exact — the dnd-kit draggable row is
	// also a "button" whose accessible name contains these words.
	await card
		.getByRole("button", { name: "Remove Total tokens", exact: true })
		.click();
	await expect(card.getByText("Total tokens")).toHaveCount(0);
	await expect(drawer.getByText("Total tokens")).toBeVisible();

	// dnd-kit registers a freshly mounted draggable in a passive effect;
	// grabbing the row in that window is silently ignored, so give the
	// drawer row a beat before pressing it.
	await page.waitForTimeout(250);

	// Drag it back: the append slot only exists mid-drag, so cross the
	// activation distance first, then drop onto the dashed slot.
	const source = drawer.getByText("Total tokens");
	const s = await source.boundingBox();
	if (!s) throw new Error("drag source missing");
	const sx = s.x + s.width / 2;
	const sy = s.y + s.height / 2;
	await page.mouse.move(sx, sy);
	await page.mouse.down();
	await page.mouse.move(sx + 12, sy + 12, { steps: 3 });
	// The drag engaged — the ghost overlay is on screen.
	await expect(page.locator(".cursor-grabbing")).toBeVisible();

	const slot = page.getByTestId("layout-empty-slot-stat");
	await slot.waitFor();
	const t = await slot.boundingBox();
	if (!t) throw new Error("append slot missing");
	await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, {
		steps: 10,
	});
	await page.mouse.move(t.x + t.width / 2 + 1, t.y + t.height / 2 + 1);
	await page.mouse.up();

	await expect(card.getByText("Total tokens")).toBeVisible();
	await expect(drawer.getByText("Total tokens")).toHaveCount(0);
});

test("usage header separates ccusage status from navigation", async ({
	page,
}) => {
	await page.goto("/usage");

	const status = page.getByRole("status");
	await expect(status).toContainText("20.0.6");
	await expect(status).toContainText("20.0.17 available");
	await expect(
		page.getByRole("button", { name: "Open settings" }),
	).toBeVisible();
	await expect(status.locator("button")).toHaveCount(0);
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
