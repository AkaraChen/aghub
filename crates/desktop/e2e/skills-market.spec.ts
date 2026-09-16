import { expect, test } from "@playwright/test";
import { e2eApiUrl, installMocks } from "./mocks";

test.beforeEach(async ({ page }) => {
	await installMocks(page);
	await page.route(e2eApiUrl("/skills-market/search*"), (route) =>
		route.fulfill({
			json: [
				{
					name: "react-patterns",
					source: "example/skills",
					slug: "react-patterns",
					installs: 1200,
				},
			],
		}),
	);
});

test("legacy skill search keeps the market navigation", async ({ page }) => {
	await page.goto("/market/search?q=react");
	await expect(
		page.getByRole("heading", { name: "Market", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("tab", { name: "Skills.sh", exact: true }),
	).toHaveAttribute("aria-selected", "true");
	await expect(
		page.getByRole("cell", { name: "react-patterns", exact: true }),
	).toBeVisible();
});

test("search, tab switching and Back keep the query in the market shell", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	await page.goto("/market");
	const field = page.getByRole("searchbox", { name: "Search skills.sh..." });
	await field.fill("r");
	await expect(
		page.getByRole("button", { name: "Search", exact: true }),
	).toBeDisabled();
	await field.fill("react");
	await field.press("Enter");
	await expect(page).toHaveURL(/q=react/);
	await expect(
		page.getByRole("columnheader", { name: "Source", exact: true }),
	).toBeVisible();
	await page.getByRole("tab", { name: "MCP Marketplace" }).click();
	await expect(
		page.getByRole("tabpanel", { name: "MCP Marketplace" }),
	).toBeVisible();
	await page.goBack();
	await expect(field).toHaveValue("react");
	await field.fill("typescript");
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await expect(page).toHaveURL(/q=typescript/);
	await page.goBack();
	await expect(field).toHaveValue("react");
	await page.getByRole("button", { name: "Install", exact: true }).click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await expect(
		page.locator('[role="button"] button, button button'),
	).toHaveCount(0);
	expect(errors).toEqual([]);
});

test("search error can be retried and is not reported as an empty result", async ({
	page,
}) => {
	let fails = true;
	await page.route(e2eApiUrl("/skills-market/search*"), (route) =>
		fails
			? route.fulfill({
					status: 400,
					json: {
						error: "skills.sh request failed: fixture",
						code: "FIXTURE",
					},
				})
			: route.fulfill({ json: [] }),
	);
	await page.goto("/market?q=broken");
	await expect(
		page.getByText("skills.sh request failed: fixture", { exact: true }),
	).toBeVisible();
	await expect(page.getByText("No results", { exact: true })).toHaveCount(0);
	fails = false;
	await page.getByRole("button", { name: "Retry", exact: true }).click();
	await expect(page.getByText("No results", { exact: true })).toBeVisible();
});

test("a full results page can load the next page without losing existing rows", async ({
	page,
}) => {
	const limits: number[] = [];
	await page.route(e2eApiUrl("/skills-market/search*"), (route) => {
		const limit = Number(
			new URL(route.request().url()).searchParams.get("limit"),
		);
		limits.push(limit);
		return route.fulfill({
			json: Array.from({ length: Math.min(limit, 102) }, (_, index) => ({
				name: `skill-${index}`,
				slug: `skill-${index}`,
				source: "example/skills",
				installs: 1000 - index,
				author: null,
			})),
		});
	});
	await page.goto("/market?q=skill");
	await expect(page.getByText("100 loaded", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Load more", exact: true }).click();
	await expect(page.getByText("102 loaded", { exact: true })).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Load more", exact: true }),
	).toHaveCount(0);
	expect(limits).toEqual([100, 200]);
	await expect(
		page.getByRole("cell", { name: "skill-0", exact: true }),
	).toBeVisible();
});

for (const theme of ["light", "dark"]) {
	test(`skills market contains long identities in ${theme} at desktop widths`, async ({
		page,
	}, testInfo) => {
		await page.addInitScript(
			(theme) => localStorage.setItem("theme", theme),
			theme,
		);
		await page.route(e2eApiUrl("/skills-market/search*"), (route) =>
			route.fulfill({
				json: [
					{
						name: "react-performance-guidelines-for-cross-platform-agent-projects",
						source: "example-org/very-long-repository-with-agent-skills",
						slug: "react-patterns",
						installs: 126800,
						author: null,
					},
					{
						name: "accessibility-review",
						source: "example/skills",
						slug: "accessibility-review",
						installs: 2100,
						author: null,
					},
					{
						name: "component-patterns",
						source: "example/skills",
						slug: "component-patterns",
						installs: 970,
						author: null,
					},
				],
			}),
		);
		await page.goto("/market?q=react");
		const panel = page.getByRole("tabpanel", { name: "Skills.sh" });
		await expect(
			panel.getByRole("cell", { name: "accessibility-review" }),
		).toBeVisible();
		for (const width of [1280, 1024, 960]) {
			await page.setViewportSize({
				width,
				height: width === 1024 ? 600 : 800,
			});
			await expect
				.poll(() =>
					panel.evaluate(
						(element) => element.scrollWidth <= element.clientWidth,
					),
				)
				.toBe(true);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			await expect(
				panel
					.getByRole("button", { name: "Install", exact: true })
					.first(),
			).toBeVisible();
		}
		const install = panel
			.getByRole("button", { name: "Install", exact: true })
			.first();
		await install.focus();
		await expect(install).toBeFocused();
		await install.hover();
		await expect(
			page.locator('[role="button"] button, button button'),
		).toHaveCount(0);
		await page.screenshot({
			path: testInfo.outputPath(`skills-market-${theme}.png`),
		});
	});
}
