import { expect, test } from "@playwright/test";
import { e2eApiUrl, installMocks, MARKET_MCPS } from "./mocks";

const server = {
	...MARKET_MCPS[0],
	description:
		"Discover project documentation and inspect repository files across multiple workspaces. " +
		"Search the complete content, compare releases, and review changes before configuring an agent.",
	updated_at: "2026-08-31T10:00:00Z",
};

test("preserves source order when the first server is installed", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	mocks.addMarketMcp("global");
	await page.route(e2eApiUrl("/mcp-market/search**"), (route) =>
		route.fulfill({
			json: {
				servers: [
					server,
					{
						...server,
						name: "io.github.acme/other",
						display_name: "Other server",
						suggested_name: "other",
						install_methods: [],
					},
				],
				next_cursor: null,
			},
		}),
	);
	await page.goto("/market?tab=mcp");
	await expect(
		page.getByRole("button", { name: "Installed", exact: true }),
	).toBeVisible();
	await expect(page.locator('[data-slot="card-title"]')).toHaveText([
		"Remote Demo",
		"Other server",
	]);
});

test("shows the full catalog identity, version, description and update time", async ({
	page,
}) => {
	await installMocks(page);
	await page.route(e2eApiUrl("/mcp-market/search**"), (route) =>
		route.fulfill({ json: { servers: [server], next_cursor: null } }),
	);
	await page.goto("/market?tab=mcp");
	const card = page
		.locator('[data-slot="card"]')
		.filter({ hasText: "Remote Demo" });
	await expect(card.getByText(server.name, { exact: true })).toBeVisible();
	await expect(card.getByText("v1.0.0", { exact: true })).toBeVisible();
	await expect(card.locator("time")).toHaveAttribute(
		"datetime",
		server.updated_at,
	);
	const description = card.getByText(server.description, { exact: true });
	expect(
		await description.evaluate(
			(element) => element.scrollHeight <= element.clientHeight,
		),
	).toBe(true);
});

test("loads subsequent pages, keeps results on failure, and resets the search cursor", async ({
	page,
}) => {
	await installMocks(page);
	const cursor = "source/entry:2+/=&?";
	let failNextPage = true;
	const requests: URLSearchParams[] = [];
	await page.route(e2eApiUrl("/mcp-market/search**"), (route) => {
		const params = new URL(route.request().url()).searchParams;
		requests.push(params);
		if (params.get("cursor") && failNextPage)
			return route.fulfill({
				status: 503,
				json: { error: "Source unavailable" },
			});
		return route.fulfill({
			json: {
				servers: params.get("cursor")
					? [
							{
								...server,
								name: "io.github.acme/next",
								display_name: "Next server",
							},
						]
					: [server],
				next_cursor:
					params.has("cursor") || params.has("q") ? null : cursor,
			},
		});
	});
	await page.goto("/market?tab=mcp");
	await page.getByRole("button", { name: "Load more", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Retry loading more" }),
	).toBeVisible({ timeout: 15000 });
	await expect(page.getByText("Remote Demo", { exact: true })).toBeVisible();
	failNextPage = false;
	await page.getByRole("button", { name: "Retry loading more" }).click();
	await expect(page.getByText("Next server", { exact: true })).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Load more", exact: true }),
	).toBeHidden();
	expect(requests.at(-1)?.get("cursor")).toBe(cursor);
	await page.getByRole("searchbox").fill("calendar");
	await page.getByRole("searchbox").press("Enter");
	await expect(page.getByText("Next server", { exact: true })).toBeHidden();
	expect(requests.at(-1)?.get("q")).toBe("calendar");
	expect(requests.at(-1)?.has("cursor")).toBe(false);
});

test("keeps pagination available after a transport filter hides the loaded page", async ({
	page,
}) => {
	await installMocks(page);
	await page.route(e2eApiUrl("/mcp-market/search**"), (route) => {
		const next = new URL(route.request().url()).searchParams.has("cursor");
		return route.fulfill({
			json: {
				servers: [next ? server : { ...server, install_methods: [] }],
				next_cursor: next ? null : "next",
			},
		});
	});
	await page.goto("/market?tab=mcp");
	await expect(
		page.getByText("No supported install method provided"),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Add", exact: true }),
	).toBeHidden();
	await page.getByRole("button", { name: "Type: All" }).click();
	await page.getByRole("option", { name: "HTTP", exact: true }).click();
	await expect(
		page.getByText(
			"No matches in loaded results. More results are available.",
		),
	).toBeVisible();
	await page.getByRole("button", { name: "Load more", exact: true }).click();
	await expect(page.getByText("Remote Demo", { exact: true })).toBeVisible();
});

test("starts a separate cursor chain when switching registry source", async ({
	page,
}) => {
	await installMocks(page);
	const requests: URLSearchParams[] = [];
	await page.route(e2eApiUrl("/mcp-market/search**"), (route) => {
		const params = new URL(route.request().url()).searchParams;
		requests.push(params);
		return route.fulfill({
			json: {
				servers: [
					{
						...server,
						name: params.has("registry_url")
							? "team/catalog"
							: server.name,
						display_name: params.has("registry_url")
							? "Team catalog"
							: "Remote Demo",
					},
				],
				next_cursor: "source-page",
			},
		});
	});
	await page.goto("/market?tab=mcp");
	await page.getByRole("button", { name: "MCP Registry Source" }).click();
	await page.getByRole("option", { name: "Add custom source…" }).click();
	const dialog = page.getByRole("dialog", {
		name: "Add MCP registry source",
	});
	await dialog.getByLabel("Name").fill("Team registry");
	await dialog.getByLabel("URL").fill("https://registry.example.test");
	await dialog.getByRole("button", { name: "Add", exact: true }).click();
	await expect(page.getByText("Team catalog", { exact: true })).toBeVisible();
	await expect(page.getByText("Remote Demo", { exact: true })).toBeHidden();
	expect(requests.at(-1)?.get("registry_url")).toBe(
		"https://registry.example.test/",
	);
	expect(requests.at(-1)?.has("cursor")).toBe(false);
});

for (const colorScheme of ["light", "dark"] as const) {
	for (const width of [1280, 960]) {
		test(`wraps complete catalog fields at ${width}px in ${colorScheme}`, async ({
			page,
		}, testInfo) => {
			await installMocks(page);
			await page.setViewportSize({ width, height: 800 });
			await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
			const entries = [
				{
					...server,
					name: `io.github.documentation/${"long-server-name-".repeat(7)}`,
					display_name: "Project documentation and workspace search",
					version: "2026.08.31-preview.12345678901234567890",
				},
				{
					...server,
					name: "ai.example/calendar",
					display_name: "Calendar",
					updated_at: null,
				},
				{
					...server,
					name: "ai.example/catalog",
					display_name: "Catalog metadata",
					updated_at: null,
					published_at: null,
					install_methods: [],
				},
			];
			await page.route(e2eApiUrl("/mcp-market/search**"), (route) =>
				route.fulfill({
					json: { servers: entries, next_cursor: "more" },
				}),
			);
			await page.goto("/market?tab=mcp");
			await page.evaluate(() =>
				localStorage.setItem("language", "zh-Hans"),
			);
			await page.reload();
			const cards = page.locator('[data-slot="card"]');
			await expect(cards).toHaveCount(3);
			await expect(cards.nth(1).getByText(/发布于/)).toBeVisible();
			await expect(cards.nth(2).locator("time")).toHaveCount(0);
			for (const card of await cards.all()) {
				expect(
					await card.evaluate(
						(element) => element.scrollWidth <= element.clientWidth,
					),
				).toBe(true);
				const description = card.getByText(server.description, {
					exact: true,
				});
				expect(
					await description.evaluate(
						(element) =>
							element.scrollHeight <= element.clientHeight,
					),
				).toBe(true);
			}
			expect(
				await page.evaluate(
					() =>
						document.documentElement.scrollWidth <=
						window.innerWidth,
				),
			).toBe(true);
			await page.screenshot({
				path: testInfo.outputPath("mcp-catalog.png"),
				animations: "disabled",
			});
		});
	}
}
