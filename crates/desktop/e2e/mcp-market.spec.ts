import { expect, test } from "@playwright/test";
import { agentInfo, e2eApiUrl, installMocks } from "./mocks";

let mocks: Awaited<ReturnType<typeof installMocks>>;

test.beforeEach(async ({ page }) => {
	mocks = await installMocks(page);
	await page.goto("/market?tab=mcp");
	await expect(page.getByText("Remote Demo")).toBeVisible();
});

test("install form enforces registry input and transport capability", async ({
	page,
}) => {
	await page.getByRole("button", { name: "Add", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Install MCP server" });
	await expect(dialog).toBeVisible();

	await expect(dialog.getByText("Claude", { exact: true })).toBeVisible();
	await expect(dialog.getByText("Gemini", { exact: true })).toBeHidden();

	await dialog.getByText("Claude", { exact: true }).click();
	await dialog.getByRole("textbox", { name: /Tenant/ }).fill("tenant-a");
	const secret = dialog.getByLabel(/Authorization/);
	await expect(secret).toHaveAttribute("type", "password");
	await expect(
		dialog.getByRole("button", { name: "Install", exact: true }),
	).toBeDisabled();

	await secret.fill("Bearer test-secret");
	await expect(
		dialog.getByRole("button", { name: "Install", exact: true }),
	).toBeEnabled();
	await expect(dialog.locator("pre")).not.toContainText("test-secret");
});

test("uses the same card surface as the agent overview", async ({ page }) => {
	const card = page
		.locator('[data-slot="card"]')
		.filter({ hasText: "Remote Demo" });

	await expect(card).toHaveClass(/card--default/);
});

test("offers Codex for Streamable HTTP installation", async ({ page }) => {
	const codex = agentInfo("codex", "Codex");
	codex.capabilities.mcp.sse = false;
	await page.route(e2eApiUrl("/agents"), (route) =>
		route.fulfill({ json: [codex] }),
	);
	await page.route(e2eApiUrl("/agents/availability"), (route) =>
		route.fulfill({
			json: [
				{
					id: "codex",
					has_global_directory: true,
					has_cli: true,
					is_available: true,
				},
			],
		}),
	);
	await page.reload();
	await page.getByRole("button", { name: "Add", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Install MCP server" });
	await dialog.getByText("Codex", { exact: true }).click();
	await dialog.getByRole("textbox", { name: /Tenant/ }).fill("tenant-a");
	await dialog.getByLabel(/Authorization/).fill("Bearer test-secret");
	await dialog.getByRole("button", { name: "Install", exact: true }).click();
	await expect(dialog.getByText("Installed successfully")).toBeVisible();
	expect(mocks.mcpCreates[0]).toMatchObject({
		agent: "codex",
		body: { transport: { type: "streamable_http" } },
	});
});

for (const width of [1280, 960]) {
	test(`names the registry source without overflow at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 800 });
		await page.emulateMedia({
			colorScheme: "dark",
			reducedMotion: "reduce",
		});
		await page.evaluate(() => localStorage.setItem("language", "zh-Hans"));
		await page.reload();
		const source = page.getByRole("button", { name: /MCP Registry/ });
		await expect(source).toBeVisible();
		await source.click();
		await expect(
			page.getByRole("option", { name: "MCP Registry", exact: true }),
		).toBeVisible();
		await expect(
			page.getByText("官方 registry", { exact: true }),
		).toBeHidden();
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		await page.screenshot({
			path: testInfo.outputPath("mcp-registry-zh.png"),
			animations: "disabled",
		});
	});
}

test("adds and selects a public custom registry", async ({ page }) => {
	await page.getByRole("button", { name: "MCP Registry Source" }).click();
	await page.getByRole("option", { name: "Add custom source…" }).click();

	const dialog = page.getByRole("dialog", {
		name: "Add MCP registry source",
	});
	await dialog.getByLabel("Name").fill("Team registry");
	await dialog.getByLabel("URL").fill("https://registry.example.test");
	await dialog.getByRole("button", { name: "Add", exact: true }).click();

	await expect(dialog).toBeHidden();
	await expect(
		page.getByRole("button", { name: "Team registry Source" }),
	).toBeVisible();
});

test("install resolves secret fields into the selected agent request", async ({
	page,
}) => {
	await page.getByRole("button", { name: "Add", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Install MCP server" });
	await dialog.getByText("Claude", { exact: true }).click();
	await dialog.getByRole("textbox", { name: /Tenant/ }).fill("tenant-a");
	await dialog.getByLabel(/Authorization/).fill("Bearer test-secret");
	await dialog.getByRole("button", { name: "Install", exact: true }).click();
	await expect(dialog.getByText("Installed successfully")).toBeVisible();

	expect(mocks.mcpCreates).toHaveLength(1);
	expect(mocks.mcpCreates[0]).toMatchObject({
		agent: "claude",
		body: {
			name: "remote-demo",
			transport: {
				type: "streamable_http",
				url: "https://tenant-a.example.test/mcp",
				headers: { Authorization: "Bearer test-secret" },
			},
		},
	});

	await dialog.getByRole("button", { name: "Done" }).click();
	await expect(
		page.getByRole("button", { name: "Installed", exact: true }),
	).toBeVisible();
});

test("switches between registry install methods", async ({ page }) => {
	await page.getByRole("button", { name: "Add", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Install MCP server" });

	await expect(dialog.getByText("Gemini", { exact: true })).toBeHidden();
	await dialog.getByLabel("Install method").click();
	await page.getByRole("option", { name: "npm · @acme/remote-demo" }).click();

	await expect(dialog.getByRole("textbox", { name: /Tenant/ })).toBeHidden();
	await expect(dialog.getByText("Gemini", { exact: true })).toBeVisible();
	await dialog.getByText("Gemini", { exact: true }).click();
	await dialog.getByRole("button", { name: "Install", exact: true }).click();
	await expect(dialog.getByText("Installed successfully")).toBeVisible();

	expect(mocks.mcpCreates.at(-1)).toMatchObject({
		agent: "gemini",
		body: {
			name: "remote-demo",
			transport: {
				type: "stdio",
				command: "npx",
				args: ["-y", "@acme/remote-demo@1.0.0"],
			},
		},
	});
});

test("keeps the installation dialog open until writes finish", async ({
	page,
}) => {
	const writeFinished = Promise.withResolvers<void>();
	await page.route(e2eApiUrl("/agents/claude/mcps**"), async (route) => {
		if (route.request().method() === "POST") await writeFinished.promise;
		await route.fallback();
	});
	await page.getByRole("button", { name: "Add", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Install MCP server" });
	await dialog.getByText("Claude", { exact: true }).click();
	await dialog.getByRole("textbox", { name: /Tenant/ }).fill("tenant-a");
	await dialog.getByLabel(/Authorization/).fill("Bearer test-secret");
	await dialog.getByRole("button", { name: "Install", exact: true }).click();
	try {
		await expect(
			dialog.getByRole("button", { name: "Go to MCP servers" }),
		).toBeDisabled();
		await expect(
			dialog.getByRole("button", { name: "Done" }),
		).toBeDisabled();
		await page.keyboard.press("Escape");
		await expect(dialog).toBeVisible();
	} finally {
		writeFinished.resolve();
	}
	await expect(dialog.getByText("Installed successfully")).toBeVisible();
	await expect(dialog.getByRole("button", { name: "Done" })).toBeEnabled();
	await dialog.getByRole("button", { name: "Go to MCP servers" }).click();
	await expect(page).toHaveURL(/\/mcp$/);
});

test("manages the selected project installation", async ({ page }) => {
	mocks.addMarketMcp("global");
	mocks.addMarketMcp("project");
	await page.reload();

	await page.getByRole("button", { name: "Installed", exact: true }).click();
	const locationDialog = page.getByRole("dialog", {
		name: "Choose an installed location",
	});
	await expect(locationDialog).toBeVisible();
	await locationDialog.getByRole("button", { name: /demo-project/ }).click();

	const manageDialog = page.getByRole("dialog", { name: "Manage Agents" });
	await expect(manageDialog).toBeVisible();
	await manageDialog.locator("label").filter({ hasText: "Cursor" }).click();
	await manageDialog.getByRole("button", { name: "Apply changes" }).click();

	expect(mocks.mcpReconciles.at(-1)).toMatchObject({
		source: {
			agent: "claude",
			scope: "project",
			project_root: "/tmp/e2e/demo",
			name: "remote-demo",
		},
		added: ["cursor"],
	});
});

test("does not offer installation while the local MCP inventory failed", async ({
	page,
}) => {
	mocks.setMcpListError(true);
	const inventoryFailure = page.waitForResponse(
		(response) =>
			response.url().includes("/agents/all/mcps") &&
			response.status() === 500,
	);
	await page.reload();
	await inventoryFailure;

	await expect(
		page.getByText("Couldn't check installed MCP servers."),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Add", exact: true }),
	).toBeHidden();

	mocks.setMcpListError(false);
	await page.getByRole("button", { name: "Retry" }).click();
	await expect(
		page.getByRole("button", { name: "Add", exact: true }),
	).toBeVisible();
});
