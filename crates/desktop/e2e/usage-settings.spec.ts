import { expect, type Page, test } from "@playwright/test";
import type { CcusageRuntimeDto, UsageStatusDto } from "../src/generated/dto";
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

const statusReport: UsageStatusDto = {
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

	// Runtime controls and the layout editor's inspector block.
	await expect(page.getByRole("heading", { name: "ccusage" })).toBeVisible();
	await expect(
		page.getByText("Reads local token and cost data for the Usage page."),
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "ccusage source" }),
	).toContainText("Automatic");
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

	// Runtime health stays separate from the source details.
	const runtimeSection = page
		.getByText("ccusage", { exact: true })
		.locator("xpath=ancestor::section");
	const runtimeStatus = runtimeSection.getByRole("status");
	await expect(runtimeStatus).toHaveText("Update available");
	await expect(runtimeStatus).not.toHaveClass(/truncate/);
	await expect(
		runtimeSection.getByTestId("usage-runtime-version"),
	).toHaveText("v20.0.6");
	await expect(
		runtimeSection.getByTestId("usage-runtime-source-metadata"),
	).toHaveText("Bundled");
	await expect(
		runtimeSection.getByRole("button", {
			name: "Update to v20.0.17",
		}),
	).toBeVisible();
	const runtimeSummary = runtimeSection.getByTestId("usage-runtime-summary");
	const updateButton = runtimeSection.getByRole("button", {
		name: "Update to v20.0.17",
	});
	const sourceSelect = runtimeSection.getByRole("button", {
		name: "ccusage source",
	});
	await expect(
		runtimeSummary.getByRole("button", { name: "Check again" }),
	).toBeVisible();
	const [updateBox, sourceBox] = await Promise.all([
		updateButton.boundingBox(),
		sourceSelect.boundingBox(),
	]);
	expect(updateBox).not.toBeNull();
	expect(sourceBox).not.toBeNull();
	expect(updateBox!.x + updateBox!.width).toBeLessThanOrEqual(sourceBox!.x);
	expect(sourceBox!.width).toBeLessThanOrEqual(160);

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
	await page.getByRole("option", { name: "Gemini" }).click();
	await expect(card.getByText("Weekly limit", { exact: true })).toBeHidden();
	await expect(page.getByText("Reasoning")).toBeHidden();
	await page.getByRole("button", { name: "Editing layout for" }).click();
	await page.getByRole("option", { name: "Default" }).click();

	// Advanced knobs are collapsed by default and expand on demand.
	await expect(page.getByText("Polling interval")).toBeHidden();
	await page.getByRole("button", { name: "Advanced" }).click();
	await expect(page.getByText("Polling interval")).toBeVisible();
	await expect(
		page.locator('[data-slot="number-field"]').first(),
	).toHaveClass(/number-field--secondary/);

	// Inactive candidates do not add their paths to the current-source summary.
	await expect(page.getByText("/usr/local/bin/ccusage")).toHaveCount(0);
});

test("agent enablement bounds usage probes", async ({ page }) => {
	await page.goto("/settings?tab=agents");
	const claudeSwitch = page.getByRole("switch", { name: "Toggle Claude" });
	await expect(claudeSwitch).toBeChecked();
	await claudeSwitch.locator("xpath=ancestor::label").click();
	await expect(claudeSwitch).not.toBeChecked();

	const summaryRequest = page.waitForRequest((request) =>
		new URL(request.url()).pathname.endsWith("/usage/summary"),
	);
	await page.getByRole("link", { name: "Usage", exact: true }).click();
	const request = await summaryRequest;
	const selected = new URL(request.url()).searchParams
		.get("agents")
		?.split(",");

	expect(selected).not.toContain("claude");
	expect(selected).toContain("gemini");
});

test("runtime source row owns version and availability metadata", async ({
	page,
}) => {
	const activePath =
		"/Users/test/Library/Application Support/aghub/ccusage/installations/bun/20.0.18/ccusage";
	const systemPath = "/usr/local/bin/ccusage";
	const runtime: CcusageRuntimeDto = {
		preference: "bun",
		active: {
			source: "bun",
			version: "20.0.18",
			can_update: true,
			path: activePath,
		},
		candidates: [
			{
				source: "path",
				installed: true,
				version: "20.0.14",
				can_install: false,
				path: systemPath,
			},
			{
				source: "bun",
				installed: true,
				version: "20.0.18",
				can_install: true,
				path: activePath,
			},
			{
				source: "npm",
				installed: false,
				version: null,
				can_install: true,
				path: null,
			},
			{
				source: "download",
				installed: false,
				version: null,
				can_install: true,
				path: null,
			},
			{
				source: "bundled",
				installed: false,
				version: null,
				can_install: false,
				path: null,
			},
		],
		latest_version: "20.0.18",
		update_available: false,
		error: null,
	};
	await page.route("**/api/v1/usage/runtime", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(runtime),
		}),
	);
	await page.goto("/settings?tab=usage");

	const runtimeSection = page
		.getByText("ccusage", { exact: true })
		.locator("xpath=ancestor::section");
	const source = page.getByRole("button", { name: "ccusage source" });
	const summary = runtimeSection.getByTestId("usage-runtime-summary");
	const version = summary.getByTestId("usage-runtime-version");
	const status = summary.getByRole("status");
	await expect(version).toHaveText("v20.0.18");
	await expect(status).toHaveText("Up to date");
	await expect(
		runtimeSection.getByTestId("usage-runtime-source-metadata"),
	).toHaveText("Bun");
	await expect(runtimeSection.getByTestId("usage-runtime-path")).toHaveText(
		activePath,
	);
	await expect(
		runtimeSection.getByTestId("usage-runtime-path"),
	).toHaveAttribute("title", activePath);
	await expect(runtimeSection.getByText(/v20\.0\.18/)).toHaveCount(1);
	await expect(source).toContainText("Bun");
	await expect(source).not.toContainText("v20.0.18");
	const [versionBox, statusBox, sourceBox] = await Promise.all([
		version.boundingBox(),
		status.boundingBox(),
		source.boundingBox(),
	]);
	expect(versionBox).not.toBeNull();
	expect(statusBox).not.toBeNull();
	expect(sourceBox).not.toBeNull();
	expect(versionBox!.x + versionBox!.width).toBeLessThanOrEqual(statusBox!.x);
	expect(Math.abs(versionBox!.y - statusBox!.y)).toBeLessThan(3);
	expect(Math.abs(sourceBox!.y - statusBox!.y)).toBeLessThan(16);

	await source.click();
	const pathOption = page.getByRole("option", { name: /System PATH/ });
	const bunOption = page.getByRole("option", { name: "Bun v20.0.18" });
	const npmOption = page.getByRole("option", { name: /^npm/ });
	const bundledOption = page.getByRole("option", {
		name: /Bundled/,
	});
	await expect(pathOption.locator('[data-slot="description"]')).toHaveText(
		"v20.0.14",
	);
	await expect(bunOption.locator('[data-slot="description"]')).toHaveText(
		"v20.0.18",
	);
	await expect(npmOption.locator('[data-slot="description"]')).toHaveText(
		"Installable",
	);
	await expect(bundledOption.locator('[data-slot="description"]')).toHaveText(
		"Unavailable",
	);
	const menu = page.locator('[data-slot="select-popover"]');
	await expect(menu).toBeVisible();
	const menuBox = await menu.boundingBox();
	expect(menuBox?.width).toBeLessThanOrEqual(320);
	const bunDescriptionBox = await bunOption
		.locator('[data-slot="description"]')
		.boundingBox();
	const bunIndicatorBox = await bunOption
		.locator('[data-slot="list-box-item-indicator"]')
		.boundingBox();
	expect(bunDescriptionBox).not.toBeNull();
	expect(bunIndicatorBox).not.toBeNull();
	expect(
		(bunDescriptionBox?.x ?? 0) + (bunDescriptionBox?.width ?? 0),
	).toBeLessThanOrEqual((bunIndicatorBox?.x ?? 0) - 8);
	await pathOption.click();
	await expect(runtimeSection.getByTestId("usage-runtime-path")).toHaveText(
		systemPath,
	);
});

test("ccusage update uses the runtime endpoint", async ({ page }) => {
	let updateRequests = 0;
	await page.route("**/api/v1/usage/runtime/update", async (route) => {
		updateRequests += 1;
		expect(route.request().method()).toBe("POST");
		await route.fallback();
	});
	await page.goto("/settings?tab=usage");

	await page.getByRole("button", { name: "Update to v20.0.17" }).click();
	await expect.poll(() => updateRequests).toBe(1);
	const runtimeSection = page
		.getByText("ccusage", { exact: true })
		.locator("xpath=ancestor::section");
	await expect(runtimeSection.getByRole("status")).toHaveText("Up to date");
	await expect(
		runtimeSection.getByTestId("usage-runtime-version"),
	).toHaveText("v20.0.17");
	await expect(
		runtimeSection.getByTestId("usage-runtime-source-metadata"),
	).toHaveText("Bun");
	await expect(runtimeSection.getByText("Install with Bun")).toHaveCount(0);
	await expect(page.getByRole("button", { name: /v20\.0\.17/ })).toHaveCount(
		0,
	);
	await expect(page).toHaveURL(/\/settings\?tab=usage$/);
});

test("package-managed PATH runtime updates without changing location", async ({
	page,
}) => {
	const executable = "/Users/test/.bun/bin/ccusage";
	let updateRequests = 0;
	let runtime: CcusageRuntimeDto = {
		preference: "auto",
		active: {
			source: "path",
			path: executable,
			version: "20.0.14",
			can_update: true,
		},
		candidates: [
			{
				source: "path",
				installed: true,
				path: executable,
				version: "20.0.14",
				can_install: false,
			},
			{
				source: "bun",
				installed: false,
				path: null,
				version: null,
				can_install: true,
			},
		],
		latest_version: "20.0.19",
		update_available: true,
		error: null,
	};
	await page.route("**/api/v1/usage/runtime", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(runtime),
		}),
	);
	await page.route("**/api/v1/usage/runtime/update", (route) => {
		updateRequests += 1;
		runtime = {
			...runtime,
			active: {
				...runtime.active!,
				version: "20.0.19",
			},
			candidates: runtime.candidates.map((candidate) =>
				candidate.source === "path"
					? { ...candidate, version: "20.0.19" }
					: candidate,
			),
			update_available: false,
		};
		return route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(runtime),
		});
	});
	await page.goto("/settings?tab=usage");

	await page.getByRole("button", { name: "Update to v20.0.19" }).click();
	await expect.poll(() => updateRequests).toBe(1);
	await expect(page.getByTestId("usage-runtime-version")).toHaveText(
		"v20.0.19",
	);
	await expect(page.getByTestId("usage-runtime-source-metadata")).toHaveText(
		"System PATH",
	);
	await expect(page.getByTestId("usage-runtime-path")).toHaveText(executable);
});

test("runtime sources use selection and installation endpoints", async ({
	page,
}) => {
	const selections: unknown[] = [];
	const installs: unknown[] = [];
	await page.route("**/api/v1/usage/runtime", async (route) => {
		if (route.request().method() === "PUT") {
			selections.push(route.request().postDataJSON());
		}
		await route.fallback();
	});
	await page.route("**/api/v1/usage/runtime/install", async (route) => {
		installs.push(route.request().postDataJSON());
		await route.fallback();
	});
	await page.goto("/settings?tab=usage");

	const source = page.getByRole("button", { name: "ccusage source" });
	await source.click();
	await page.getByRole("option", { name: "Bundled" }).click();
	await page.getByRole("button", { name: "Use Bundled" }).click();
	await expect
		.poll(() => selections)
		.toEqual([{ source: "bundled", path: null }]);
	await expect(source).toContainText("Bundled");

	await source.click();
	await page.getByRole("option", { name: "Direct download" }).click();
	await page.getByRole("button", { name: "Download and use" }).click();
	await expect.poll(() => installs).toEqual([{ source: "download" }]);
	await expect(page.getByTestId("usage-runtime-version")).toHaveText(
		"v20.0.17",
	);
	await expect(page.getByTestId("usage-runtime-source-metadata")).toHaveText(
		"Direct download",
	);
	await expect(source).toContainText("Direct download");
});

test("runtime source distinguishes the saved preference from an environment override", async ({
	page,
}) => {
	const overriddenRuntime: CcusageRuntimeDto = {
		preference: "bun",
		active: {
			source: "environment",
			path: "/opt/tools/ccusage",
			version: "20.0.17",
			can_update: false,
		},
		candidates: [
			{
				source: "bun",
				installed: true,
				path: "/tmp/e2e/ccusage/installations/bun/20.0.17/ccusage",
				version: "20.0.17",
				can_install: true,
			},
		],
		latest_version: "20.0.18",
		update_available: true,
		error: null,
	};
	await page.route("**/api/v1/usage/runtime", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(overriddenRuntime),
		}),
	);
	await page.goto("/settings?tab=usage");

	await expect(
		page.getByRole("button", { name: "ccusage source" }),
	).toContainText("Bun");
	await expect(page.getByTestId("usage-runtime-version")).toHaveText(
		"v20.0.17",
	);
	await expect(page.getByTestId("usage-runtime-source-metadata")).toHaveText(
		"Environment override",
	);
	await expect(
		page.getByRole("button", { name: "Install v20.0.18" }),
	).toHaveCount(0);

	const source = page.getByRole("button", { name: "ccusage source" });
	await source.click();
	await page.getByRole("option", { name: "Automatic" }).click();
	await expect(
		page.getByText(
			"Uses the first available ccusage runtime. Choose a source to override it.",
			{ exact: true },
		),
	).toBeVisible();
	await expect(
		page.getByTestId("usage-runtime-source-metadata"),
	).not.toHaveText("Environment override");
});

test("re-check spins and remains pending until the probe settles", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	let requestCount = 0;
	let finishRecheck: () => void = () => undefined;
	const recheckPending = new Promise<void>((resolve) => {
		finishRecheck = () => resolve();
	});
	await page.route("**/api/v1/usage/runtime/refresh", async (route) => {
		requestCount += 1;
		await recheckPending;
		await route.fallback();
	});

	try {
		await page.goto("/settings?tab=usage");
		const recheck = page.getByRole("button", { name: "Check again" });
		const runtimeSection = recheck.locator("xpath=ancestor::section");
		const status = runtimeSection.getByRole("status");
		const indicator = runtimeSection.locator("span.size-2.rounded-full");
		await expect(recheck).not.toHaveAttribute("data-pending", "true");

		await recheck.click();
		await expect.poll(() => requestCount).toBe(1);
		await expect(recheck).toHaveAttribute("data-pending", "true");
		await expect(recheck).toHaveAttribute("aria-disabled", "true");
		await expect(status).toHaveText("Checking ccusage…");
		await expect(indicator).toHaveClass(/bg-muted/);
		await expect
			.poll(() =>
				recheck
					.locator("svg")
					.evaluate(
						(element) => getComputedStyle(element).animationName,
					),
			)
			.toContain("spin");

		finishRecheck();
		await expect(recheck).not.toHaveAttribute("data-pending", "true");
		await expect(status).toHaveText("Update available");
		await expect(indicator).toHaveClass(/bg-success/);
		await expect
			.poll(() =>
				recheck
					.locator("svg")
					.evaluate(
						(element) => getComputedStyle(element).animationName,
					),
			)
			.toBe("none");
	} finally {
		finishRecheck();
	}
});

test("re-check does not spin when reduced motion is requested", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	let finishRecheck: () => void = () => undefined;
	const recheckPending = new Promise<void>((resolve) => {
		finishRecheck = resolve;
	});
	await page.route("**/api/v1/usage/runtime/refresh", async (route) => {
		await recheckPending;
		await route.fallback();
	});

	try {
		await page.goto("/settings?tab=usage");
		const recheck = page.getByRole("button", { name: "Check again" });
		await recheck.click();
		await expect(recheck).toHaveAttribute("data-pending", "true");
		await expect
			.poll(() =>
				recheck
					.locator("svg")
					.evaluate(
						(element) => getComputedStyle(element).animationName,
					),
			)
			.toBe("none");
	} finally {
		finishRecheck();
	}
});

test("failed re-check replaces the cached active runtime", async ({ page }) => {
	let refreshFailed = false;
	let runtimeGetCount = 0;
	const unavailableRuntime: CcusageRuntimeDto = {
		preference: "auto",
		active: null,
		candidates: [],
		latest_version: null,
		update_available: false,
		error: "ccusage is unavailable after re-check",
	};
	await page.route("**/api/v1/usage/runtime", async (route) => {
		if (route.request().method() !== "GET") {
			await route.fallback();
			return;
		}
		runtimeGetCount += 1;
		if (!refreshFailed) {
			await route.fallback();
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(unavailableRuntime),
		});
	});
	await page.route("**/api/v1/usage/runtime/refresh", async (route) => {
		refreshFailed = true;
		await route.fulfill({
			status: 500,
			contentType: "application/json",
			body: JSON.stringify({ error: "ccusage re-check failed" }),
		});
	});
	await page.goto("/settings?tab=usage");

	const runtimeSection = page
		.getByText("ccusage", { exact: true })
		.locator("xpath=ancestor::section");
	const status = runtimeSection.getByRole("status");
	const indicator = runtimeSection.locator("span.size-2.rounded-full");
	await expect(status).toHaveText("Update available");
	await expect(indicator).toHaveClass(/bg-success/);

	await runtimeSection.getByRole("button", { name: "Check again" }).click();
	await expect.poll(() => runtimeGetCount).toBeGreaterThan(1);
	await expect(status).toHaveText("Unavailable");
	await expect(
		runtimeSection.getByText("ccusage is unavailable after re-check"),
	).toBeVisible();
	await expect(
		runtimeSection.getByText("v20.0.6", { exact: true }),
	).toHaveCount(0);
	await expect(indicator).toHaveClass(/bg-danger/);
});

test("runtime errors override stale health without hiding its version", async ({
	page,
}) => {
	let finishRecheck: () => void = () => undefined;
	const recheckPending = new Promise<void>((resolve) => {
		finishRecheck = resolve;
	});
	const staleRuntime: CcusageRuntimeDto = {
		preference: "auto",
		active: {
			source: "bun",
			path: "/tmp/e2e/ccusage/installations/bun/20.0.17/ccusage",
			version: "20.0.17",
			can_update: true,
		},
		candidates: [],
		latest_version: "20.0.17",
		update_available: false,
		error: "The last runtime probe timed out",
	};
	await page.route("**/api/v1/usage/runtime", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(staleRuntime),
		}),
	);
	await page.route("**/api/v1/usage/runtime/refresh", async (route) => {
		await recheckPending;
		await route.fallback();
	});

	try {
		await page.goto("/settings?tab=usage");

		const runtimeSection = page
			.getByText("ccusage", { exact: true })
			.locator("xpath=ancestor::section");
		const status = runtimeSection.getByRole("status");
		const errorDetail = runtimeSection.getByText(
			"The last runtime probe timed out",
		);
		await expect(status).toHaveText("Couldn't check ccusage");
		await expect(
			runtimeSection.getByTestId("usage-runtime-version"),
		).toHaveText("v20.0.17");
		await expect(
			runtimeSection.getByTestId("usage-runtime-source-metadata"),
		).toHaveText("Bun");
		await expect(errorDetail).toBeVisible();
		await expect(
			runtimeSection.locator("span.size-2.rounded-full"),
		).toHaveClass(/bg-danger/);

		await page.getByRole("button", { name: "Check again" }).click();
		await expect(status).toHaveText("Checking ccusage…");
		await expect(errorDetail).toBeHidden();

		finishRecheck();
		await expect(status).not.toHaveText("Checking ccusage…");
	} finally {
		finishRecheck();
	}
});

test("runtime status and defaults footer fit a compact desktop", async ({
	page,
}) => {
	await page.setViewportSize({ width: 800, height: 650 });
	await page.addInitScript(() => localStorage.setItem("theme", "light"));
	await page.goto("/settings?tab=usage");

	const runtimeSection = page
		.getByText("ccusage", { exact: true })
		.locator("xpath=ancestor::section");
	await expect(runtimeSection.getByRole("status")).toBeVisible();
	await expect(
		runtimeSection.getByRole("button", {
			name: "Update to v20.0.17",
		}),
	).toBeVisible();
	await expect(page.getByTestId("usage-defaults-footer")).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					document.documentElement.scrollWidth -
					document.documentElement.clientWidth,
			),
		)
		.toBeLessThanOrEqual(1);
	const defaultsFooter = page.getByTestId("usage-defaults-footer");
	await defaultsFooter.scrollIntoViewIfNeeded();
	await expect(
		defaultsFooter.getByRole("button", {
			name: "Restore usage defaults",
		}),
	).toBeEnabled();

	await page.evaluate(() => document.documentElement.classList.add("dark"));
	await expect(page.locator("html")).toHaveClass(/dark/);
	await expect(defaultsFooter).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					document.documentElement.scrollWidth -
					document.documentElement.clientWidth,
			),
		)
		.toBeLessThanOrEqual(1);
	await runtimeSection.scrollIntoViewIfNeeded();
	await expect(runtimeSection.getByRole("status")).toBeVisible();
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
	await page.setViewportSize({ width: 1600, height: 900 });
	await expect(page.getByTestId("settings-content")).toHaveCSS(
		"max-width",
		"1024px",
	);

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

	const hiddenQuota = drawer.getByTestId("layout-hidden-item-5h");
	const [hiddenQuotaBox, hiddenQuotaMeter] = await Promise.all([
		hiddenQuota.boundingBox(),
		hiddenQuota.locator('[data-slot="meter"]').boundingBox(),
	]);
	expect(hiddenQuotaBox).not.toBeNull();
	expect(hiddenQuotaMeter).not.toBeNull();
	expect(hiddenQuotaBox!.width).toBeLessThanOrEqual(288.5);
	expect(hiddenQuotaMeter!.width).toBeLessThanOrEqual(288.5);
	expect(hiddenQuotaMeter!.width / hiddenQuotaBox!.width).toBeGreaterThan(
		0.9,
	);

	const [firstHiddenStat, thirdHiddenStat] = await Promise.all([
		drawer.getByTestId("layout-hidden-item-cacheRead").boundingBox(),
		drawer.getByTestId("layout-hidden-item-reasoning").boundingBox(),
	]);
	expect(firstHiddenStat).not.toBeNull();
	expect(thirdHiddenStat).not.toBeNull();
	expect(Math.abs(firstHiddenStat!.y - thirdHiddenStat!.y)).toBeLessThan(2);

	await page.setViewportSize({ width: 900, height: 900 });
	const [narrowQuotaBox, narrowQuotaMeter] = await Promise.all([
		hiddenQuota.boundingBox(),
		hiddenQuota.locator('[data-slot="meter"]').boundingBox(),
	]);
	expect(narrowQuotaBox).not.toBeNull();
	expect(narrowQuotaMeter).not.toBeNull();
	expect(narrowQuotaMeter!.width / narrowQuotaBox!.width).toBeGreaterThan(
		0.95,
	);
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					document.documentElement.scrollWidth -
					document.documentElement.clientWidth,
			),
		)
		.toBeLessThanOrEqual(1);
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

test("advanced number steppers use the default horizontal anatomy", async ({
	page,
}) => {
	await page.goto("/settings?tab=usage");
	await page.getByRole("button", { name: "Advanced" }).click();

	const fields = page.locator('[data-slot="number-field"]');
	await expect(fields).toHaveCount(2);
	for (let index = 0; index < 2; index += 1) {
		const field = fields.nth(index);
		const [group, input, increment, decrement] = await Promise.all([
			field.locator('[data-slot="number-field-group"]').boundingBox(),
			field.locator('[data-slot="number-field-input"]').boundingBox(),
			field
				.locator('[data-slot="number-field-increment-button"]')
				.boundingBox(),
			field
				.locator('[data-slot="number-field-decrement-button"]')
				.boundingBox(),
		]);
		if (!group || !input || !increment || !decrement) {
			throw new Error("number stepper geometry missing");
		}

		expect(group.height).toBeCloseTo(36, 0);
		expect(Math.abs(decrement.y - group.y)).toBeLessThan(2);
		expect(Math.abs(input.y - group.y)).toBeLessThan(2);
		expect(Math.abs(increment.y - group.y)).toBeLessThan(2);
		expect(Math.abs(decrement.height - group.height)).toBeLessThan(2);
		expect(Math.abs(input.height - group.height)).toBeLessThan(2);
		expect(Math.abs(increment.height - group.height)).toBeLessThan(2);
		expect(decrement.x).toBeLessThan(input.x);
		expect(input.x).toBeLessThan(increment.x);
		expect(increment.width).toBeGreaterThanOrEqual(24);
		expect(increment.height).toBeGreaterThanOrEqual(24);
		expect(decrement.width).toBeGreaterThanOrEqual(24);
		expect(decrement.height).toBeGreaterThanOrEqual(24);
		expect(Math.abs(decrement.x + decrement.width - input.x)).toBeLessThan(
			2,
		);
		expect(Math.abs(input.x + input.width - increment.x)).toBeLessThan(2);
		expect(
			Math.abs(increment.x + increment.width - (group.x + group.width)),
		).toBeLessThan(2);
	}
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

test("usage settings clamp persisted ranges and reject invalid timezones", async ({
	page,
}) => {
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
				pollIntervalMs: 100_000_000,
				timezone: "Mars/Olympus_Mons",
				requestTimeoutSecs: 10_000,
				home: { windowDays: 1_000 },
			},
		});
	});
	await page.getByRole("link", { name: "Settings" }).click();
	await page.getByRole("tab", { name: "Usage" }).click();

	await expect(
		page.getByRole("button", { name: "Usage window" }),
	).toContainText("365 days");
	await page.getByRole("button", { name: "Advanced" }).click();
	await expect(
		page.locator('input[aria-label="Polling interval"]'),
	).toHaveValue("86,400s");
	await expect(
		page.locator('input[aria-label="Request timeout"]'),
	).toHaveValue("3,600s");
	await expect(page.getByRole("button", { name: "Timezone" })).toContainText(
		"System default",
	);
});

test("layout rows are the complete drag targets", async ({ page }) => {
	await page.goto("/settings?tab=usage");

	const card = page.getByTestId("layout-card-replica");
	const drawer = page.getByTestId("layout-hidden-drawer");
	const hiddenRow = drawer.getByTestId("layout-hidden-item-5h");
	const cardRow = card.getByTestId("layout-card-item-totalTokens");

	await expect(hiddenRow).toHaveAttribute("role", "button");
	await expect(cardRow).toHaveAttribute("role", "button");
	await expect(hiddenRow.locator("button")).toHaveCount(0);
	await expect(card.locator("button")).toHaveCount(0);
	const draggableBorders = await page
		.locator('[aria-roledescription="draggable"]')
		.evaluateAll((elements) =>
			elements.map((element) => {
				const style = getComputedStyle(element);
				return `${style.borderTopWidth} ${style.borderTopStyle}`;
			}),
		);
	expect(draggableBorders.length).toBeGreaterThan(0);
	expect(new Set(draggableBorders)).toEqual(new Set(["1px dashed"]));

	await hiddenRow.scrollIntoViewIfNeeded();
	const rowBox = await hiddenRow.boundingBox();
	if (!rowBox) throw new Error("drag row missing");
	const dragStartX = rowBox.x + rowBox.width - 3;
	await page.mouse.move(dragStartX, rowBox.y + rowBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(
		rowBox.x + rowBox.width * 0.8,
		rowBox.y + rowBox.height / 2,
		{
			steps: 3,
		},
	);
	await expect(page.locator("#root .cursor-grabbing")).toBeVisible();
	await page.keyboard.press("Escape");
});

test("wide short layout editor auto-scrolls toward the card target", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1100, height: 420 });
	await page.goto("/settings?tab=usage");

	const scroller = page.locator("main > div").first();
	const card = page.getByTestId("layout-card-replica");
	const drawer = page.getByTestId("layout-hidden-drawer");
	const source = drawer.getByTestId("layout-hidden-item-reasoning");
	const target = card.getByTestId("layout-slot-stat-0");
	await source.evaluate((element) =>
		element.scrollIntoView({ block: "center" }),
	);
	await nextBrowserPaint(page);
	const initialScrollTop = await scroller.evaluate(
		(element) => element.scrollTop,
	);
	expect(initialScrollTop).toBeGreaterThan(0);
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
	await page.mouse.move(targetBox.x + targetBox.width / 2, 36, {
		steps: 10,
	});
	await expect
		.poll(() => scroller.evaluate((element) => element.scrollTop))
		.toBeLessThan(initialScrollTop - 8);
	const viewportHeight = page.viewportSize()?.height ?? 420;
	await page.mouse.move(
		sourceBox.x + sourceBox.width / 2,
		viewportHeight / 2,
	);
	await expect
		.poll(async () => {
			const before = await scroller.evaluate(
				(element) => element.scrollTop,
			);
			await nextBrowserPaint(page);
			const after = await scroller.evaluate(
				(element) => element.scrollTop,
			);
			return Math.abs(after - before);
		})
		.toBeLessThanOrEqual(1);
	await expect(target).toBeInViewport({ ratio: 1 });
	const visibleTargetBox = await target.boundingBox();
	if (!visibleTargetBox) throw new Error("drop target missing");
	await page.mouse.move(
		visibleTargetBox.x + visibleTargetBox.width / 2,
		visibleTargetBox.y + visibleTargetBox.height / 2,
	);
	await expect(
		card
			.getByTestId("layout-stat-section")
			.locator('[data-layout-type="stat"]'),
	).toHaveText(["Reasoning", "Input", "Output", "Total tokens"]);
	await page.mouse.up();
	await expect(card.getByText("Reasoning", { exact: true })).toBeVisible();
	await expect(drawer.getByText("Reasoning", { exact: true })).toHaveCount(0);
});

test("side-by-side horizontal dragging does not scroll the main pane early", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1600, height: 900 });
	await page.goto("/settings?tab=usage");

	const scroller = page.locator("main > div").first();
	const card = page.getByTestId("layout-card-replica");
	const drawer = page.getByTestId("layout-hidden-drawer");
	const source = drawer.getByTestId("layout-hidden-item-cacheRead");
	const target = card.getByTestId("layout-slot-stat-1");
	const stats = card
		.getByTestId("layout-stat-section")
		.locator('[data-layout-type="stat"]');
	await source.evaluate((element) =>
		element.scrollIntoView({ block: "center" }),
	);
	await nextBrowserPaint(page);

	const [scrollerBox, cardBox, drawerBox, sourceBox, targetBox] =
		await Promise.all([
			scroller.boundingBox(),
			card.boundingBox(),
			drawer.boundingBox(),
			source.boundingBox(),
			target.boundingBox(),
		]);
	if (!scrollerBox || !cardBox || !drawerBox || !sourceBox || !targetBox) {
		throw new Error("side-by-side drag geometry missing");
	}
	expect(cardBox.x + cardBox.width).toBeLessThan(drawerBox.x);
	expect(sourceBox.y).toBeGreaterThanOrEqual(scrollerBox.y - 1);
	expect(sourceBox.y + sourceBox.height).toBeLessThanOrEqual(
		scrollerBox.y + scrollerBox.height + 1,
	);
	expect(targetBox.y).toBeGreaterThanOrEqual(scrollerBox.y - 1);
	expect(targetBox.y + targetBox.height).toBeLessThanOrEqual(
		scrollerBox.y + scrollerBox.height + 1,
	);
	const initialScrollTop = await scroller.evaluate(
		(element) => element.scrollTop,
	);
	const sourceCenter = {
		x: sourceBox.x + sourceBox.width / 2,
		y: sourceBox.y + sourceBox.height / 2,
	};
	const targetCenter = {
		x: targetBox.x + targetBox.width / 2,
		y: targetBox.y + targetBox.height / 2,
	};

	await page.mouse.move(sourceCenter.x, sourceCenter.y);
	await page.mouse.down();
	await page.mouse.move(sourceCenter.x - 12, sourceCenter.y, { steps: 3 });
	await expect(page.locator("#root .cursor-grabbing")).toBeVisible();
	await nextBrowserPaint(page);
	expect(await scroller.evaluate((element) => element.scrollTop)).toBe(
		initialScrollTop,
	);

	await page.mouse.move(
		(sourceCenter.x + targetCenter.x) / 2,
		sourceCenter.y,
		{ steps: 5 },
	);
	await nextBrowserPaint(page);
	expect(await scroller.evaluate((element) => element.scrollTop)).toBe(
		initialScrollTop,
	);

	await page.mouse.move(targetCenter.x, targetCenter.y, { steps: 5 });
	await expect(stats).toHaveText([
		"Input",
		"Cache read",
		"Output",
		"Total tokens",
	]);
	await nextBrowserPaint(page);
	expect(await scroller.evaluate((element) => element.scrollTop)).toBe(
		initialScrollTop,
	);

	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect(stats).toHaveText([
		"Input",
		"Output",
		"Total tokens",
		"Spend",
	]);
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

test("keyboard dragging reaches an offscreen card slot in a wide short window", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1100, height: 420 });
	await page.goto("/settings?tab=usage");

	const scroller = page.locator("main > div").first();
	const card = page.getByTestId("layout-card-replica");
	const drawer = page.getByTestId("layout-hidden-drawer");
	const source = drawer.getByTestId("layout-hidden-item-utilizationOpus");
	const target = card.getByTestId("layout-slot-stat-1");
	await source.evaluate((element) =>
		element.scrollIntoView({ block: "center" }),
	);
	await nextBrowserPaint(page);
	const [scrollerBox, targetBox] = await Promise.all([
		scroller.boundingBox(),
		target.boundingBox(),
	]);
	if (!scrollerBox || !targetBox) throw new Error("layout geometry missing");
	const scrollOffset = targetBox.y + targetBox.height - scrollerBox.y + 8;
	await scroller.evaluate(
		(element, offset) => element.scrollBy({ top: offset }),
		scrollOffset,
	);
	await nextBrowserPaint(page);

	const hiddenTargetBox = await target.boundingBox();
	const sourceBox = await source.boundingBox();
	if (!hiddenTargetBox || !sourceBox)
		throw new Error("keyboard drag endpoints missing");
	expect(hiddenTargetBox.y + hiddenTargetBox.height).toBeLessThan(
		scrollerBox.y,
	);
	expect(sourceBox.y).toBeGreaterThanOrEqual(scrollerBox.y);
	expect(sourceBox.y + sourceBox.height).toBeLessThanOrEqual(
		scrollerBox.y + scrollerBox.height,
	);
	const initialScrollTop = await scroller.evaluate(
		(element) => element.scrollTop,
	);

	await source.focus();
	await page.keyboard.press("Space");
	await expect(page.locator("#root .cursor-grabbing")).toBeVisible();
	await page.keyboard.press("ArrowLeft");
	await nextBrowserPaint(page);

	const reachedScrollTop = await scroller.evaluate(
		(element) => element.scrollTop,
	);
	const reachedTargetBox = await target.boundingBox();
	if (!reachedTargetBox) throw new Error("keyboard drop target missing");
	expect(reachedScrollTop).toBeLessThan(initialScrollTop);
	expect(reachedTargetBox.y).toBeGreaterThanOrEqual(scrollerBox.y - 1);
	expect(reachedTargetBox.y + reachedTargetBox.height).toBeLessThanOrEqual(
		scrollerBox.y + scrollerBox.height + 1,
	);
	await expect(
		card
			.getByTestId("layout-stat-section")
			.locator('[data-layout-type="stat"]'),
	).toHaveText(["Input", "Opus weekly", "Output", "Total tokens"]);

	await page.keyboard.press("Escape");
	await expect(source).toBeFocused();
	await expect(card.getByText("Opus weekly", { exact: true })).toHaveCount(0);
	await expect(
		drawer.getByText("Opus weekly", { exact: true }),
	).toBeVisible();
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

test("layout editor inserts at a full right slot and previews overflow", async ({
	page,
}) => {
	await page.goto("/settings?tab=usage");

	const card = page.getByTestId("layout-card-replica");
	const drawer = page.getByTestId("layout-hidden-drawer");
	const stats = card
		.getByTestId("layout-stat-section")
		.locator('[data-layout-type="stat"]');
	const source = drawer.getByTestId("layout-hidden-item-cacheRead");
	const target = card.getByTestId("layout-slot-stat-1");
	const liveRegion = page.locator(
		'[id^="DndLiveRegion-"][role="status"][aria-live="assertive"]',
	);
	await target.scrollIntoViewIfNeeded();
	await expect(liveRegion).toHaveCount(1);
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
	// Projection is visible before release. Inserting at the first row's right
	// slot shifts following fields and overflows only the final field.
	await expect(stats).toHaveText([
		"Input",
		"Cache read",
		"Output",
		"Total tokens",
	]);
	await expect(liveRegion).toHaveText(
		"Cache read will move to position 2. Spend will move to Not shown.",
	);
	await expect(drawer.getByText("Spend", { exact: true })).toBeVisible();
	await expect(drawer.getByText("Output", { exact: true })).toHaveCount(0);
	await expect(card.locator("[data-drop-action]")).toHaveCount(0);
	await expect(page.getByTestId(/layout-empty-slot/)).toHaveCount(0);
	await page.keyboard.press("Escape");
	await page.mouse.up();

	await expect(stats).toHaveText([
		"Input",
		"Output",
		"Total tokens",
		"Spend",
	]);
	await expect(card.getByText("Cache read", { exact: true })).toHaveCount(0);
	await expect(drawer.getByText("Cache read", { exact: true })).toBeVisible();
	await expect(drawer.getByText("Spend", { exact: true })).toHaveCount(0);

	// The same projection is committed once on release.
	const sourceAfterCancel = drawer.getByTestId(
		"layout-hidden-item-cacheRead",
	);
	const targetAfterCancel = card.getByTestId("layout-slot-stat-1");
	await sourceAfterCancel.hover();
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
	await expect(page.locator("#root .cursor-grabbing")).toBeVisible();
	await page.mouse.move(
		nextTargetBox.x + nextTargetBox.width / 2,
		nextTargetBox.y + nextTargetBox.height / 2,
		{ steps: 10 },
	);
	await expect(stats).toHaveText([
		"Input",
		"Cache read",
		"Output",
		"Total tokens",
	]);
	await expect(liveRegion).toHaveText(
		"Cache read will move to position 2. Spend will move to Not shown.",
	);
	await page.mouse.up();

	await expect(stats).toHaveText([
		"Input",
		"Cache read",
		"Output",
		"Total tokens",
	]);
	await expect(drawer.getByText("Cache read", { exact: true })).toHaveCount(
		0,
	);
	await expect(drawer.getByText("Spend", { exact: true })).toBeVisible();
});

test("drawer keeps complete side boundaries on hover without shifting", async ({
	page,
}) => {
	await page.goto("/settings?tab=usage");

	const drawer = page.getByTestId("layout-hidden-drawer");
	const row = drawer.getByTestId("layout-hidden-item-cacheRead");
	const before = await drawer.boundingBox();
	const idleBorders = await drawer.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			left: Number.parseFloat(style.borderLeftWidth),
			right: Number.parseFloat(style.borderRightWidth),
		};
	});
	if (!before) throw new Error("drawer geometry missing");
	expect(idleBorders.left).toBeGreaterThan(0);
	expect(idleBorders.right).toBeGreaterThan(0);
	expect(idleBorders.right).toBe(idleBorders.left);

	await row.hover();
	const after = await drawer.boundingBox();
	const hoverBorders = await drawer.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			left: Number.parseFloat(style.borderLeftWidth),
			right: Number.parseFloat(style.borderRightWidth),
		};
	});
	if (!after) throw new Error("drawer geometry missing after hover");
	expect(hoverBorders.left).toBeGreaterThan(0);
	expect(hoverBorders.right).toBe(hoverBorders.left);
	expect(after.x).toBeCloseTo(before.x, 1);
	expect(after.y).toBeCloseTo(before.y, 1);
	expect(after.width).toBeCloseTo(before.width, 1);
	expect(after.height).toBeCloseTo(before.height, 1);
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
	let releaseRuntimeReset: () => void = () => undefined;
	const runtimeResetPending = new Promise<void>((resolve) => {
		releaseRuntimeReset = resolve;
	});
	await page.route("**/api/v1/usage/runtime", async (route) => {
		if (route.request().method() !== "PUT") {
			await route.fallback();
			return;
		}
		await runtimeResetPending;
		await route.fallback();
	});
	await page.goto("/settings?tab=usage");
	const restoreButton = page.getByRole("button", {
		name: "Restore usage defaults",
	});
	await expect(restoreButton.locator("xpath=ancestor::section")).toHaveCount(
		0,
	);
	await expect(
		restoreButton.locator('xpath=ancestor::*[@data-slot="card-footer"]'),
	).toHaveCount(1);
	await expect(
		page.getByText("Default settings", { exact: true }),
	).toBeVisible();

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

	await restoreButton.click();
	await expect(
		page.getByRole("alertdialog", { name: "Restore usage defaults" }),
	).toBeVisible();
	const confirmRestore = page.getByRole("button", {
		name: "Restore defaults",
	});
	await confirmRestore.click();
	await expect(confirmRestore).toHaveAttribute("data-pending", "true");
	await expect(
		page.getByRole("alertdialog", { name: "Restore usage defaults" }),
	).toBeVisible();
	releaseRuntimeReset();
	await expect(
		page.getByRole("alertdialog", { name: "Restore usage defaults" }),
	).toHaveCount(0);

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

test("usage defaults dialog only blocks Escape while restoring", async ({
	page,
}) => {
	let releaseRuntimeReset: () => void = () => undefined;
	const runtimeResetPending = new Promise<void>((resolve) => {
		releaseRuntimeReset = resolve;
	});
	await page.route("**/api/v1/usage/runtime", async (route) => {
		if (route.request().method() !== "PUT") {
			await route.fallback();
			return;
		}
		await runtimeResetPending;
		await route.fallback();
	});
	await page.goto("/settings?tab=usage");

	const openDialog = page.getByRole("button", {
		name: "Restore usage defaults",
	});
	const dialog = page.getByRole("alertdialog", {
		name: "Restore usage defaults",
	});
	await openDialog.click();
	const confirmRestore = dialog.getByRole("button", {
		name: "Restore defaults",
	});
	await confirmRestore.click();
	await expect(confirmRestore).toHaveAttribute("data-pending", "true");
	await page.keyboard.press("Escape");
	await expect(dialog).toBeVisible();
	releaseRuntimeReset();
	await expect(dialog).toHaveCount(0);

	await openDialog.click();
	await expect(dialog).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);
});

test("usage defaults dialog stays open when runtime reset fails", async ({
	page,
}) => {
	let rejectRuntimeReset: () => void = () => undefined;
	const runtimeResetPending = new Promise<void>((resolve) => {
		rejectRuntimeReset = resolve;
	});
	await page.route("**/api/v1/usage/runtime", async (route) => {
		if (route.request().method() !== "PUT") {
			await route.fallback();
			return;
		}
		await runtimeResetPending;
		await route.fulfill({
			status: 500,
			contentType: "application/json",
			body: JSON.stringify({ error: "Runtime reset rejected" }),
		});
	});
	await page.goto("/settings?tab=usage");
	const windowPicker = page.getByRole("button", { name: "Usage window" });
	await windowPicker.click();
	await page.getByRole("option", { name: "90 days" }).click();
	await expect(windowPicker).toContainText("90 days");

	await page.getByRole("button", { name: "Restore usage defaults" }).click();
	const dialog = page.getByRole("alertdialog", {
		name: "Restore usage defaults",
	});
	const confirmRestore = dialog.getByRole("button", {
		name: "Restore defaults",
	});
	await confirmRestore.click();
	await expect(confirmRestore).toHaveAttribute("data-pending", "true");

	rejectRuntimeReset();
	await expect(confirmRestore).not.toHaveAttribute("data-pending", "true");
	await expect(confirmRestore).toBeEnabled();
	await expect(dialog).toBeVisible();
	await expect(page.locator('[data-slot="toast"]')).toContainText(
		"Runtime reset rejected",
	);
	await expect(windowPicker).toContainText("90 days");
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

test("home does not animate optional usage before data exists", async ({
	page,
}) => {
	const emptyUsageReport = { ...usageReport, agents: [] };
	const emptyLimitsReport = { ...limitsReport, agents: [] };
	let releaseUsageRequests: () => void = () => undefined;
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

test("home drops cached usage after show usage is turned off", async ({
	page,
}) => {
	await page.goto("/");
	const claudeCard = () =>
		page
			.getByRole("region", { name: "Your agents" })
			.getByText("Claude", { exact: true })
			.locator('xpath=ancestor::*[@data-slot="card"]');
	await expect(claudeCard().getByText("71%", { exact: true })).toBeVisible();
	await expect(claudeCard()).toHaveClass(/row-span-2/);

	await page.getByRole("link", { name: "Settings" }).click();
	await page.getByRole("tab", { name: "Usage" }).click();
	const homeSwitch = page.getByRole("switch", {
		name: "Show usage on home",
	});
	await homeSwitch
		.locator('xpath=ancestor::*[@data-slot="switch-content"]')
		.click();
	await expect(homeSwitch).not.toBeChecked();

	await page.getByRole("link", { name: "Home", exact: true }).click();
	await expect(claudeCard().getByText("71%", { exact: true })).toHaveCount(0);
	await expect(claudeCard()).not.toHaveClass(/row-span-2/);
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
});

test("home resource tile keeps its hover arrow readable on accent tint", async ({
	page,
}) => {
	await page.goto("/");

	const claudeCard = page
		.getByRole("region", { name: "Your agents" })
		.getByText("Claude", { exact: true })
		.locator('xpath=ancestor::*[@data-slot="card"]');
	const skillsTile = claudeCard.getByRole("button", { name: /Skills/ });
	const arrow = skillsTile.locator('span[aria-hidden="true"]');
	await skillsTile.hover();
	await expect(arrow).toHaveCSS("opacity", "1");

	const [arrowColor, accentColor] = await Promise.all([
		arrow.evaluate((element) => getComputedStyle(element).color),
		page.evaluate(() => {
			const probe = document.createElement("span");
			probe.style.color = "var(--accent)";
			document.body.append(probe);
			const color = getComputedStyle(probe).color;
			probe.remove();
			return color;
		}),
	]);
	expect(arrowColor).toBe(accentColor);
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
