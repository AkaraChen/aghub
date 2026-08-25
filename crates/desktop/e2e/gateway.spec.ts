import { expect, test, type Page, type Route } from "@playwright/test";
import { e2eApiUrl, installMocks } from "./mocks";

const instance = (status: "starting" | "running" | "stopped") => ({
	id: "gateway-1",
	name: "Test Gateway",
	kind: "managed",
	base_url: "http://127.0.0.1:8317",
	port: 8317,
	version: "7.2.141",
	auto_start: status === "stopped",
	status,
	created_at: "2026-07-22T00:00:00Z",
});

const json = (route: Route, body: unknown, status = 200) =>
	route.fulfill({
		status,
		contentType: "application/json",
		body: JSON.stringify(body),
	});

async function installGatewayPageRoutes(
	page: Page,
	status: "starting" | "running",
) {
	await page.route(e2eApiUrl("/**"), (route) => {
		const url = new URL(route.request().url());
		const path = url.pathname.replace("/api/v1", "");

		if (path === "/gateway/instances") {
			return json(route, [instance(status)]);
		}
		if (path === "/inference/providers" || path === "/inference/presets") {
			return json(route, []);
		}
		if (path === "/gateway/instances/gateway-1/version") {
			return json(route, {
				installed: "7.2.141",
				pinned: "7.2.141",
				latest: "7.2.141",
				bin_source: "downloaded",
				system_bin: null,
			});
		}
		if (path === "/gateway/instances/gateway-1/auth-files") {
			return json(route, [
				{
					id: "account-1",
					auth_index: "account-1",
					name: "claude.json",
					provider: "anthropic",
					label: null,
					status: "active",
					status_message: null,
					disabled: false,
					unavailable: false,
					email: "user@example.com",
					account: null,
					account_type: null,
					size: 100,
					modtime: null,
					success: 2,
					failed: 0,
				},
			]);
		}
		return json(route, { error: `unhandled ${path}` }, 404);
	});
}

test.beforeEach(async ({ page }) => {
	await installMocks(page);
});

test("auto-start retries discovery before starting an opted-in gateway", async ({
	page,
}) => {
	let listRequests = 0;
	let startRequests = 0;
	await page.route(e2eApiUrl("/gateway/**"), (route) => {
		const url = new URL(route.request().url());
		if (url.pathname.endsWith("/gateway/instances")) {
			listRequests += 1;
			if (listRequests <= 3) {
				return json(route, { error: "temporary failure" }, 503);
			}
			return json(route, [instance("stopped")]);
		}
		if (url.pathname.endsWith("/gateway-1/start")) {
			startRequests += 1;
			return json(route, instance("running"));
		}
		return json(route, { error: "unhandled gateway route" }, 404);
	});

	await page.goto("/skills");
	await expect.poll(() => listRequests).toBe(4);
	await expect.poll(() => startRequests).toBe(1);
});

test("starting status remains still when reduced motion is requested", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await installGatewayPageRoutes(page, "starting");
	await page.goto("/inference-providers");

	const row = page.getByRole("option", { name: "Test Gateway" });
	await expect(row).toBeVisible();
	const dot = row.locator("span.bg-accent");
	await expect(dot).toHaveCSS("animation-name", "none");
});

test("account actions do not nest interactive tooltip triggers", async ({
	page,
}) => {
	await installGatewayPageRoutes(page, "running");
	await page.goto("/inference-providers");
	await page.getByRole("option", { name: "Test Gateway" }).click();

	const reset = page.locator('button[aria-label^="Reset quota"]');
	await expect(reset).toBeVisible();
	await expect(
		reset.locator("xpath=ancestor::*[@role='button']"),
	).toHaveCount(0);
});

test("external gateways do not query the managed binary version", async ({
	page,
}) => {
	let versionRequests = 0;
	let resolveAuthFilesRequest: (() => void) | undefined;
	const authFilesRequested = new Promise<void>((resolve) => {
		resolveAuthFilesRequest = resolve;
	});
	await page.route(e2eApiUrl("/**"), (route) => {
		const url = new URL(route.request().url());
		const path = url.pathname.replace("/api/v1", "");

		if (path === "/gateway/instances") {
			return json(route, [
				{
					...instance("running"),
					name: "External Gateway",
					kind: "external",
					port: null,
					version: null,
					auto_start: false,
				},
			]);
		}
		if (path === "/inference/providers" || path === "/inference/presets") {
			return json(route, []);
		}
		if (path === "/gateway/instances/gateway-1/version") {
			versionRequests += 1;
			return json(route, { error: "managed endpoint" }, 422);
		}
		if (path === "/gateway/instances/gateway-1/auth-files") {
			resolveAuthFilesRequest?.();
			return json(route, []);
		}
		return json(route, { error: `unhandled ${path}` }, 404);
	});

	await page.goto("/inference-providers");
	await page.getByRole("option", { name: "External Gateway" }).click();
	await authFilesRequested;

	expect(versionRequests).toBe(0);
});
