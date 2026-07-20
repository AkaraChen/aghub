import { expect, type Page, test } from "@playwright/test";
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

	// The default card starts with the weekly quota and the four useful
	// totals. Everything else remains available in the drawer.
	const card = page.getByTestId("layout-card-replica");
	const drawer = page.getByTestId("layout-hidden-drawer");
	await expect(card.getByText("Weekly limit", { exact: true })).toBeVisible();
	await expect(card.getByText("5-hour limit", { exact: true })).toHaveCount(
		0,
	);
	await expect(
		drawer.getByText("5-hour limit", { exact: true }),
	).toBeVisible();
	await expect(card.getByText("Total tokens", { exact: true })).toBeVisible();
	const totalTokensRow = page
		.getByTestId("layout-card-replica")
		.getByText("Total tokens", { exact: true })
		.locator("..");
	await expect(totalTokensRow.getByText("—", { exact: true })).toHaveCount(0);
	await expect(page.getByText("Not shown", { exact: true })).toBeVisible();
	await expect(page.getByText("Cache read", { exact: true })).toBeVisible();
	await expect(card.locator("button")).toHaveCount(0);

	// Sidecar status row: version + inline update hint in the description,
	// plus an external package-page action and re-check.
	await expect(page.getByText("20.0.17 available")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Open npm page" }),
	).toBeVisible();
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

test("Usage settings uses the same surface level as Appearance", async ({
	page,
}) => {
	await page.goto("/settings?tab=appearance");
	const appearancePanel = page.locator('[data-slot="tabs-panel"]');
	const appearanceCard = appearancePanel.locator(".card--default").first();
	const appearanceBackground = await appearanceCard.evaluate(
		(element) => getComputedStyle(element).backgroundColor,
	);
	await expect
		.poll(() =>
			appearancePanel.evaluate(
				(element) => getComputedStyle(element).backgroundColor,
			),
		)
		.toBe("rgba(0, 0, 0, 0)");

	await page.goto("/settings?tab=usage");
	const usagePanel = page.locator('[data-slot="tabs-panel"]');
	const usageCard = usagePanel.locator(".card--default").first();
	await expect(usageCard).toBeVisible();
	await expect
		.poll(() =>
			usageCard.evaluate(
				(element) => getComputedStyle(element).backgroundColor,
			),
		)
		.toBe(appearanceBackground);
	await expect
		.poll(() =>
			usagePanel.evaluate(
				(element) => getComputedStyle(element).backgroundColor,
			),
		)
		.toBe("rgba(0, 0, 0, 0)");
	await expect(usagePanel.locator(".surface--default")).toHaveCount(0);
	await expect(usageCard.locator('[data-slot="card-content"]')).toHaveCount(
		0,
	);
});

test("Agents panel lets Card variants own static surfaces", async ({
	page,
}) => {
	await page.goto("/settings?tab=agents");

	const panel = page.locator('[data-slot="tabs-panel"]');
	const outerCard = panel.locator(":scope > div > .card--default");
	const agentCard = outerCard.locator(".card--secondary").first();
	await expect(outerCard).toBeVisible();
	await expect(agentCard).toBeVisible();
	await expect(outerCard).not.toHaveClass(/card--transparent/);
	await expect(agentCard).not.toHaveClass(/transition-all/);
	await expect(
		page.getByRole("radio", { name: "All", exact: true }),
	).not.toHaveClass(/bg-surface/);

	const idleBackground = await agentCard.evaluate(
		(element) => getComputedStyle(element).backgroundColor,
	);
	await agentCard.hover();
	await expect
		.poll(() =>
			agentCard.evaluate(
				(element) => getComputedStyle(element).backgroundColor,
			),
		)
		.toBe(idleBackground);
});

test("layout editor uses the available settings width", async ({ page }) => {
	await page.goto("/settings?tab=usage");

	const card = page.getByTestId("layout-card-replica");
	const drawer = page.getByTestId("layout-hidden-drawer");
	const grid = card.locator("..");
	const surface = page
		.locator('[data-slot="tabs-panel"]')
		.locator(".card--default")
		.first();
	const [gridBox, surfaceBox, cardBox, drawerBox] = await Promise.all([
		grid.boundingBox(),
		surface.boundingBox(),
		card.boundingBox(),
		drawer.boundingBox(),
	]);

	expect(gridBox).not.toBeNull();
	expect(surfaceBox).not.toBeNull();
	expect(cardBox).not.toBeNull();
	expect(drawerBox).not.toBeNull();
	expect(gridBox!.width / surfaceBox!.width).toBeGreaterThan(0.9);
	expect(drawerBox!.width).toBeGreaterThan(cardBox!.width);

	const [firstHiddenStat, thirdHiddenStat] = await Promise.all([
		drawer.getByTestId("layout-hidden-item-cacheRead").boundingBox(),
		drawer.getByTestId("layout-hidden-item-reasoning").boundingBox(),
	]);
	expect(firstHiddenStat).not.toBeNull();
	expect(thirdHiddenStat).not.toBeNull();
	expect(Math.abs(firstHiddenStat!.y - thirdHiddenStat!.y)).toBeLessThan(2);
});

test("usage window uses a finite desktop picker", async ({ page }) => {
	await page.goto("/settings?tab=usage");

	const picker = page.getByRole("button", { name: "Usage window" });
	await expect(picker).toContainText("30 days");
	await picker.click();
	await page.getByRole("option", { name: "90 days" }).click();
	await expect(picker).toContainText("90 days");
	await expect(page.locator('input[aria-label="Usage window"]')).toHaveCount(
		0,
	);
});

test("finite pickers preserve stored custom values", async ({ page }) => {
	await page.goto("/");
	await page.evaluate(async () => {
		type Invoke = <T>(
			command: string,
			args?: Record<string, unknown>,
		) => Promise<T>;
		const { invoke } = (
			window as unknown as {
				__TAURI_INTERNALS__: { invoke: Invoke };
			}
		).__TAURI_INTERNALS__;
		const rid = await invoke<number>("plugin:store|load", {
			path: "store.json",
		});
		await invoke("plugin:store|set", {
			rid,
			key: "usageSettings",
			value: {
				globalAlertThresholdPct: 83,
				agents: { claude: { alertThresholdPct: 82 } },
				home: { windowDays: 45 },
			},
		});
	});
	await page.getByRole("link", { name: "Settings" }).click();
	await page.getByRole("tab", { name: "Usage" }).click();

	await expect(
		page.getByRole("button", { name: "Usage window" }),
	).toContainText("45 days");
	await expect(
		page.getByRole("button", { name: "Global alert threshold" }),
	).toContainText("83%");
	await expect(
		page.locator('button[aria-label="Alert threshold"]').first(),
	).toContainText("82%");
});

test("layout rows are the complete drag targets", async ({ page }) => {
	await page.goto("/settings?tab=usage");

	const card = page.getByTestId("layout-card-replica");
	const drawer = page.getByTestId("layout-hidden-drawer");
	const hiddenRow = drawer.getByTestId("layout-hidden-item-cacheRead");
	const cardRow = card.getByTestId("layout-card-item-totalTokens");

	await expect(hiddenRow).toHaveAttribute("role", "button");
	await expect(cardRow).toHaveAttribute("role", "button");
	await expect(hiddenRow.locator("button")).toHaveCount(0);
	await expect(card.locator("button")).toHaveCount(0);

	await hiddenRow.scrollIntoViewIfNeeded();
	const rowBox = await hiddenRow.boundingBox();
	if (!rowBox) throw new Error("drag row missing");
	await page.mouse.move(
		rowBox.x + rowBox.width * 0.8,
		rowBox.y + rowBox.height / 2,
	);
	await page.mouse.down();
	await page.mouse.move(
		rowBox.x + rowBox.width * 0.65,
		rowBox.y + rowBox.height / 2,
		{
			steps: 3,
		},
	);
	await expect(page.locator("#root .cursor-grabbing")).toBeVisible();
	await page.keyboard.press("Escape");
});

test("keyboard dragging previews and cancels without losing focus", async ({
	page,
}) => {
	await page.goto("/settings?tab=usage");

	const card = page.getByTestId("layout-card-replica");
	const drawer = page.getByTestId("layout-hidden-drawer");
	const hiddenRow = drawer.getByTestId("layout-hidden-item-cacheRead");
	await hiddenRow.focus();
	await expect(hiddenRow).toBeFocused();

	await page.keyboard.press("Space");
	await expect(page.locator("#root .cursor-grabbing")).toBeVisible();
	await page.keyboard.press("ArrowLeft");
	await expect(card.getByText("Cache read", { exact: true })).toBeVisible();
	await page.keyboard.press("Escape");

	await expect(hiddenRow).toBeFocused();
	await expect(card.getByText("Cache read", { exact: true })).toHaveCount(0);
	await expect(drawer.getByText("Cache read", { exact: true })).toBeVisible();
});

test("keyboard dragging follows the card grid", async ({ page }) => {
	await page.goto("/settings?tab=usage");

	const stats = page
		.getByTestId("layout-stat-section")
		.locator('[data-layout-type="stat"]');
	const input = page.getByTestId("layout-card-item-inputTokens");
	await input.focus();

	await page.keyboard.press("Space");
	await expect(page.locator("#root .cursor-grabbing")).toBeVisible();
	await nextBrowserPaint(page);
	await page.keyboard.press("ArrowRight");
	await expect(stats).toHaveText([
		"Output",
		"Input",
		"Total tokens",
		"Spend",
	]);
	await page.keyboard.press("Escape");
	await expect(input).toBeFocused();

	await page.keyboard.press("Space");
	await expect(page.locator("#root .cursor-grabbing")).toBeVisible();
	await nextBrowserPaint(page);
	await page.keyboard.press("ArrowDown");
	await expect(stats).toHaveText([
		"Output",
		"Total tokens",
		"Input",
		"Spend",
	]);
	await page.keyboard.press("Space");
	await expect(stats).toHaveText([
		"Output",
		"Total tokens",
		"Input",
		"Spend",
	]);
});

test("layout editor replaces a full card slot from the drawer", async ({
	page,
}) => {
	await page.goto("/settings?tab=usage");

	const card = page.getByTestId("layout-card-replica");
	const drawer = page.getByTestId("layout-hidden-drawer");
	const source = drawer.getByTestId("layout-hidden-item-cacheRead");
	const target = card.getByTestId("layout-card-item-totalTokens");
	await target.scrollIntoViewIfNeeded();
	const [sourceBox, targetBox] = await Promise.all([
		source.boundingBox(),
		target.boundingBox(),
	]);
	if (!sourceBox || !targetBox) throw new Error("drag endpoints missing");

	await page.mouse.move(
		sourceBox.x + sourceBox.width / 2,
		sourceBox.y + sourceBox.height / 2,
	);
	await page.mouse.down();
	await page.mouse.move(sourceBox.x - 12, sourceBox.y + 12, { steps: 3 });
	await expect(page.locator("#root .cursor-grabbing")).toBeVisible();
	await page.mouse.move(
		targetBox.x + targetBox.width / 2,
		targetBox.y + targetBox.height / 2,
		{ steps: 10 },
	);
	// Projection is visible before the pointer is released. The displaced
	// field moves to the drawer immediately, without a separate replace ring.
	await expect(card.getByText("Cache read", { exact: true })).toBeVisible();
	await expect(
		drawer.getByText("Total tokens", { exact: true }),
	).toBeVisible();
	await expect(card.locator("[data-drop-action]")).toHaveCount(0);
	await expect(page.getByTestId(/layout-empty-slot/)).toHaveCount(0);
	await page.keyboard.press("Escape");

	await expect(card.getByText("Total tokens", { exact: true })).toBeVisible();
	await expect(card.getByText("Cache read", { exact: true })).toHaveCount(0);
	await expect(drawer.getByText("Cache read", { exact: true })).toBeVisible();
	await expect(drawer.getByText("Total tokens", { exact: true })).toHaveCount(
		0,
	);

	// A second drag is committed once on release.
	const sourceAfterCancel = drawer.getByTestId(
		"layout-hidden-item-cacheRead",
	);
	const targetAfterCancel = card.getByTestId("layout-card-item-totalTokens");
	const [nextSourceBox, nextTargetBox] = await Promise.all([
		sourceAfterCancel.boundingBox(),
		targetAfterCancel.boundingBox(),
	]);
	if (!nextSourceBox || !nextTargetBox)
		throw new Error("drag endpoints missing");
	await page.mouse.move(
		nextSourceBox.x + nextSourceBox.width / 2,
		nextSourceBox.y + nextSourceBox.height / 2,
	);
	await page.mouse.down();
	await page.mouse.move(nextSourceBox.x - 12, nextSourceBox.y + 12, {
		steps: 3,
	});
	await page.mouse.move(
		nextTargetBox.x + nextTargetBox.width / 2,
		nextTargetBox.y + nextTargetBox.height / 2,
		{ steps: 10 },
	);
	await page.mouse.up();

	await expect(card.getByText("Cache read", { exact: true })).toBeVisible();
	await expect(card.getByText("Total tokens", { exact: true })).toHaveCount(
		0,
	);
	await expect(drawer.getByText("Cache read", { exact: true })).toHaveCount(
		0,
	);
	await expect(card.getByText("Spend", { exact: true })).toBeVisible();
	await expect(card.getByText("Input", { exact: true })).toBeVisible();
	await expect(card.getByText("Output", { exact: true })).toBeVisible();
});

test("drawer uses a complete non-shifting drop outline", async ({ page }) => {
	await page.goto("/settings?tab=usage");

	const card = page.getByTestId("layout-card-replica");
	const drawer = page.getByTestId("layout-hidden-drawer");
	const row = drawer.getByTestId("layout-hidden-item-cacheRead");
	const idleOutlineColor = await drawer.evaluate(
		(element) => getComputedStyle(element).outlineColor,
	);
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

	const before = await drawer.boundingBox();
	const source = card.getByTestId("layout-card-item-totalTokens");
	const [sourceBox, drawerBox] = await Promise.all([
		source.boundingBox(),
		drawer.boundingBox(),
	]);
	if (!before || !sourceBox || !drawerBox)
		throw new Error("drag endpoints missing");
	await page.mouse.move(
		sourceBox.x + sourceBox.width / 2,
		sourceBox.y + sourceBox.height / 2,
	);
	await page.mouse.down();
	await page.mouse.move(sourceBox.x + 12, sourceBox.y - 12, { steps: 3 });
	await page.mouse.move(drawerBox.x + drawerBox.width / 2, drawerBox.y + 12, {
		steps: 10,
	});
	await expect
		.poll(() =>
			drawer.evaluate(
				(element) => getComputedStyle(element).outlineStyle,
			),
		)
		.toBe("solid");
	await expect
		.poll(() =>
			drawer.evaluate(
				(element) => getComputedStyle(element).outlineWidth,
			),
		)
		.toBe("1px");
	await expect
		.poll(() =>
			drawer.evaluate(
				(element) => getComputedStyle(element).outlineColor,
			),
		)
		.not.toBe(idleOutlineColor);
	const during = await drawer.boundingBox();
	expect(during).not.toBeNull();
	expect(during!.x).toBe(before.x);
	expect(during!.y).toBe(before.y);
	expect(during!.width).toBe(before.width);
	expect(during!.height).toBeGreaterThanOrEqual(before.height);
	await page.keyboard.press("Escape");
	await expect
		.poll(() =>
			drawer.evaluate(
				(element) => getComputedStyle(element).outlineColor,
			),
		)
		.toBe(idleOutlineColor);
});

test("layout editor moves a field between the card and the drawer", async ({
	page,
}) => {
	await page.goto("/settings?tab=usage");

	const card = page.getByTestId("layout-card-replica");
	const drawer = page.getByTestId("layout-hidden-drawer");
	await expect(card.getByText("Total tokens")).toBeVisible();

	// Drag the complete row to the drawer to hide it.
	const source = card.getByTestId("layout-card-item-totalTokens");
	await source.hover();
	const [sourceBox, drawerBox] = await Promise.all([
		source.boundingBox(),
		drawer.boundingBox(),
	]);
	if (!sourceBox || !drawerBox) throw new Error("drag endpoints missing");
	await page.mouse.move(
		sourceBox.x + sourceBox.width / 2,
		sourceBox.y + sourceBox.height / 2,
	);
	await page.mouse.down();
	await page.mouse.move(sourceBox.x + 12, sourceBox.y - 12, { steps: 3 });
	await page.mouse.move(drawerBox.x + drawerBox.width / 2, drawerBox.y + 12, {
		steps: 10,
	});
	await expect(drawer.getByText("Total tokens")).toBeVisible();
	await page.mouse.up();
	await expect(card.getByText("Total tokens")).toHaveCount(0);
	await expect(drawer.getByText("Total tokens")).toBeVisible();

	// Drag it back into the stat section; no temporary plus slot appears.
	const hiddenSource = drawer.getByTestId("layout-hidden-item-totalTokens");
	await nextBrowserPaint(page);
	const s = await hiddenSource.boundingBox();
	if (!s) throw new Error("drag source missing");
	const sx = s.x + s.width / 2;
	const sy = s.y + s.height / 2;
	await page.mouse.move(sx, sy);
	await page.mouse.down();
	await page.mouse.move(sx + 12, sy + 12, { steps: 3 });
	await expect(page.locator("#root .cursor-grabbing")).toBeVisible();
	const statSection = page.getByTestId("layout-stat-section");
	const t = await statSection.boundingBox();
	if (!t) throw new Error("stat section missing");
	await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, {
		steps: 10,
	});
	await page.mouse.move(t.x + t.width / 2 + 1, t.y + t.height / 2 + 1);
	await page.mouse.up();

	await expect(card.getByText("Total tokens")).toBeVisible();
	await expect(drawer.getByText("Total tokens")).toHaveCount(0);
});

test("usage settings restore the complete default state", async ({ page }) => {
	await page.goto("/settings?tab=usage");

	const windowPicker = page.getByRole("button", { name: "Usage window" });
	await windowPicker.click();
	await page.getByRole("option", { name: "90 days" }).click();
	const homeSwitch = page.getByRole("switch", {
		name: "Show usage on home",
	});
	await homeSwitch
		.locator('xpath=ancestor::*[@data-slot="switch-content"]')
		.click();
	await expect(homeSwitch).not.toBeChecked();
	await page.getByRole("button", { name: "Editing layout for" }).click();
	await page.getByRole("option", { name: "Codex" }).click();

	await page.getByRole("button", { name: "Restore usage defaults" }).click();
	await expect(
		page.getByRole("alertdialog", { name: "Restore usage defaults" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Restore defaults" }).click();

	await expect(homeSwitch).toBeChecked();
	await expect(windowPicker).toContainText("30 days");
	await expect(
		page.getByRole("button", { name: "Editing layout for" }),
	).toContainText("Default");

	const card = page.getByTestId("layout-card-replica");
	await expect(card.getByText("Weekly limit", { exact: true })).toBeVisible();
	await expect(card.getByText("5-hour limit", { exact: true })).toHaveCount(
		0,
	);
	await expect(card.locator('[data-layout-type="stat"]')).toHaveText([
		"Input",
		"Output",
		"Total tokens",
		"Spend",
	]);
});

test("card stats have no horizontal divider", async ({ page }) => {
	await page.goto("/settings?tab=usage");
	const statGrid = page.getByTestId("layout-stat-section");
	await expect
		.poll(() =>
			statGrid.evaluate(
				(element) => getComputedStyle(element).borderTopWidth,
			),
		)
		.toBe("0px");
});

test("usage header keeps ccusage status unboxed", async ({ page }) => {
	await page.goto("/usage");

	await expect(page.getByRole("toolbar", { name: "Usage" })).toHaveCount(0);
	const status = page.getByRole("status");
	await expect(status).toContainText("20.0.6");
	await expect(status).not.toContainText("20.0.17 available");
	const containerStyle = await status.locator("..").evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			backgroundColor: style.backgroundColor,
			borderTopWidth: style.borderTopWidth,
		};
	});
	expect(containerStyle).toEqual({
		backgroundColor: "rgba(0, 0, 0, 0)",
		borderTopWidth: "0px",
	});
	await expect(
		page.getByRole("button", { name: "Open settings" }),
	).toBeVisible();
	await expect(status.locator("button")).toHaveCount(0);
});

test("home does not animate optional usage before data exists", async ({
	page,
}) => {
	const emptyUsageReport = { ...usageReport, agents: [] };
	const emptyLimitsReport = { ...limitsReport, agents: [] };
	let releaseUsageRequests = () => undefined;
	const usageRequestsPending = new Promise<void>((resolve) => {
		releaseUsageRequests = () => resolve();
	});
	await page.route("**/api/v1/usage/summary**", async (route) => {
		await usageRequestsPending;
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(emptyUsageReport),
		});
	});
	await page.route("**/api/v1/usage/limits**", async (route) => {
		await usageRequestsPending;
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(emptyLimitsReport),
		});
	});

	try {
		await page.goto("/");
		const claudeCard = page
			.getByText("Claude", { exact: true })
			.locator('xpath=ancestor::*[@data-slot="card"]');
		await expect(claudeCard).toBeVisible();
		expect(await claudeCard.locator(".skeleton").count()).toBe(0);
		expect(await claudeCard.getAttribute("class")).not.toContain(
			"row-span-2",
		);
	} finally {
		releaseUsageRequests();
	}
});

test("home agent card renders the customized usage block", async ({ page }) => {
	await page.goto("/");

	const claudeCard = page
		.getByRole("region", { name: "Your agents" })
		.getByText("Claude", { exact: true });
	await expect(claudeCard).toBeVisible();

	// The default layout shows only the weekly quota bar.
	await expect(page.getByText("42%")).toHaveCount(0);
	await expect(page.getByText("71%")).toBeVisible();

	await page.screenshot({ path: "artifacts/home-usage-card.png" });
});

async function nextBrowserPaint(page: Page) {
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				requestAnimationFrame(() =>
					requestAnimationFrame(() => resolve()),
				);
			}),
	);
}
