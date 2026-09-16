import { expect, test } from "@playwright/test";
import { e2eApiUrl, installMocks } from "./mocks";

test.beforeEach(async ({ page }) => {
	await installMocks(page);
	await page.route(e2eApiUrl("/plugins-market"), (route) =>
		route.fulfill({ json: [] }),
	);
	await page.route(e2eApiUrl("/plugins/marketplaces"), (route) =>
		route.fulfill({
			json: {
				marketplaces: [
					{
						name: "example-plugins",
						source: { kind: "github", repo: "example/plugins" },
						install_location:
							"/tmp/aghub/marketplaces/example-plugins",
					},
				],
			},
		}),
	);
});

test("plugin marketplace sources have a reachable management entry", async ({
	page,
}) => {
	await page.goto("/market?tab=claude-plugins");
	await page
		.getByRole("button", { name: "Manage sources", exact: true })
		.click();
	const dialog = page.getByRole("dialog", {
		name: "Marketplace sources",
		exact: true,
	});
	await expect(
		dialog.getByText("example/plugins", { exact: true }),
	).toBeVisible();
	await expect(
		dialog.getByText("/tmp/aghub/marketplaces/example-plugins", {
			exact: true,
		}),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).not.toBeVisible();
	await expect(
		page.getByRole("button", { name: "Manage sources", exact: true }),
	).toBeFocused();
	await page
		.getByRole("button", { name: "Installed plugins", exact: true })
		.click();
	await expect(page).toHaveURL(/\/cc-plugins$/);
});

test("source writes keep scope, block duplicate submits and retain failures", async ({
	page,
}) => {
	let finishAdd: () => void = () => {};
	const addGate = new Promise<void>((resolve) => {
		finishAdd = resolve;
	});
	const bodies: unknown[] = [];
	await page.route(e2eApiUrl("/plugins/marketplaces"), async (route) => {
		if (route.request().method() === "GET") return route.fallback();
		bodies.push(route.request().postDataJSON());
		await addGate;
		await route.fulfill({
			status: 400,
			json: { error: "Repository cannot be read", code: "FIXTURE" },
		});
	});
	await page.goto("/market?tab=claude-plugins&scope=project");
	await page
		.getByRole("button", { name: "Manage sources", exact: true })
		.click();
	const dialog = page.getByRole("dialog", {
		name: "Marketplace sources",
		exact: true,
	});
	const field = dialog.getByRole("textbox", { name: "Source", exact: true });
	await field.fill("example/new-source");
	await field.press("Enter");
	await expect(field).toBeDisabled();
	await expect(
		dialog.getByRole("button", { name: "Add source", exact: true }),
	).toBeDisabled();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeVisible();
	finishAdd();
	await expect(
		page.getByText("Repository cannot be read", { exact: true }),
	).toBeVisible();
	await expect(field).toHaveValue("example/new-source");
	await expect(field).toBeEnabled();
	expect(bodies).toEqual([
		{ source: "example/new-source", scope: "project", sparse: [] },
	]);
	await dialog
		.getByRole("button", { name: "Close", exact: true })
		.last()
		.click();
	await expect(dialog).not.toBeVisible();
});

test("adding a source refreshes its location without leaving the catalog", async ({
	page,
}) => {
	let added = false;
	await page.route(e2eApiUrl("/plugins/marketplaces"), (route) => {
		if (route.request().method() === "POST") {
			added = true;
			return route.fulfill({
				json: { success: true, marketplace: null, message: "Added" },
			});
		}
		return route.fulfill({
			json: {
				marketplaces: added
					? [
							{
								name: "new-source",
								source: {
									kind: "local",
									path: "/tmp/local-plugins",
								},
								install_location:
									"/tmp/marketplaces/new-source",
							},
						]
					: [],
			},
		});
	});
	await page.goto("/market?tab=claude-plugins");
	await page
		.getByRole("button", { name: "Manage sources", exact: true })
		.click();
	const dialog = page.getByRole("dialog", {
		name: "Marketplace sources",
		exact: true,
	});
	await expect(
		dialog.getByText("No marketplace sources configured", { exact: true }),
	).toBeVisible();
	const field = dialog.getByRole("textbox", { name: "Source", exact: true });
	await field.fill("/tmp/local-plugins");
	await dialog
		.getByRole("button", { name: "Add source", exact: true })
		.click();
	await expect(
		dialog.getByText("/tmp/marketplaces/new-source", { exact: true }),
	).toBeVisible();
	await expect(field).toHaveValue("");
	await expect(page).toHaveURL(/tab=claude-plugins/);
});

test("source update and removal use existing APIs and refresh the list", async ({
	page,
}) => {
	const writes: string[] = [];
	let removed = false;
	await page.route(e2eApiUrl("/plugins/marketplaces"), (route) =>
		removed
			? route.fulfill({ json: { marketplaces: [] } })
			: route.fallback(),
	);
	await page.route(
		e2eApiUrl("/plugins/marketplaces/example-plugins**"),
		(route) => {
			writes.push(
				`${route.request().method()} ${new URL(route.request().url()).pathname}`,
			);
			if (route.request().method() === "DELETE") removed = true;
			return route.fulfill({
				json: { success: true, marketplace: null, message: "Done" },
			});
		},
	);
	await page.goto("/market?tab=claude-plugins");
	await page
		.getByRole("button", { name: "Manage sources", exact: true })
		.click();
	const dialog = page.getByRole("dialog", {
		name: "Marketplace sources",
		exact: true,
	});
	await dialog
		.getByRole("button", { name: "Refresh example-plugins", exact: true })
		.click();
	await expect(
		dialog.getByRole("button", {
			name: "Remove example-plugins",
			exact: true,
		}),
	).toBeEnabled();
	await dialog
		.getByRole("button", { name: "Remove example-plugins", exact: true })
		.click();
	await expect(
		dialog.getByText("No marketplace sources configured", { exact: true }),
	).toBeVisible();
	expect(writes).toEqual([
		"POST /api/v1/plugins/marketplaces/example-plugins/update",
		"DELETE /api/v1/plugins/marketplaces/example-plugins",
	]);
});

for (const theme of ["light", "dark"]) {
	test(`source management wraps paths in Chinese and ${theme}`, async ({
		page,
	}, testInfo) => {
		await page.addInitScript((theme) => {
			localStorage.setItem("theme", theme);
			localStorage.setItem("language", "zh-Hans");
		}, theme);
		await page.route(e2eApiUrl("/plugins/marketplaces"), (route) =>
			route.fulfill({
				json: {
					marketplaces: [
						{
							name: "claude-plugins-official",
							source: {
								kind: "github",
								repo: "example-org/long-claude-plugin-marketplace-source-name",
							},
							install_location:
								"/Users/example/Library/Application Support/claude/plugins/marketplaces/a-very-long-directory-name/claude-plugins-official",
						},
						{
							name: "local-plugins",
							source: {
								kind: "local",
								path: "/Users/example/WorkSpace/插件集/本地测试仓库",
							},
							install_location:
								"/Users/example/.claude/plugins/marketplaces/local-plugins",
						},
					],
				},
			}),
		);
		await page.goto("/market?tab=claude-plugins");
		await page
			.getByRole("button", { name: "管理来源", exact: true })
			.click();
		const dialog = page.getByRole("dialog", {
			name: "市场来源",
			exact: true,
		});
		await expect(
			dialog.getByText(
				"example-org/long-claude-plugin-marketplace-source-name",
				{ exact: true },
			),
		).toBeVisible();
		for (const width of [1280, 1024, 960]) {
			await page.setViewportSize({
				width,
				height: width === 1024 ? 600 : 720,
			});
			await expect
				.poll(() =>
					dialog.evaluate(
						(element) => element.scrollWidth <= element.clientWidth,
					),
				)
				.toBe(true);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
		}
		await expect(
			page.locator('[role="button"] button, button button'),
		).toHaveCount(0);
		await page.screenshot({
			path: testInfo.outputPath(`plugin-sources-${theme}.png`),
		});
	});
}
