import { expect, test, type Page } from "@playwright/test";
import { agentAvailability, agentInfo, e2eApiUrl, installMocks } from "./mocks";

const importTargetAgents = [
	agentInfo("claude", "Claude"),
	agentInfo("codex", "OpenAI Codex", true),
	agentInfo("openclaw", "OpenClaw"),
	agentInfo("opencode", "OpenCode", true),
	agentInfo("gemini", "Gemini CLI", true),
];

const importTargetAvailability = importTargetAgents.map((agent) =>
	agentAvailability(agent.id),
);

async function scanRepository(page: Page) {
	await page
		.getByRole("textbox", { name: "Repository URL" })
		.fill("https://github.com/AkaraChen/alpha-pack");
	await page.getByRole("button", { name: "Scan", exact: true }).click();
	await expect(page.getByText("fresh-skill description")).toBeVisible();
}

async function expectSharedTargets(page: Page) {
	const targetGrid = page.getByRole("grid");
	await expect(
		targetGrid.getByRole("row", { name: "Universal agents" }),
	).toBeVisible();
	await expect(
		targetGrid.getByRole("row", { name: "Claude", exact: true }),
	).toBeVisible();
	await expect(
		targetGrid.getByRole("row", { name: "OpenClaw", exact: true }),
	).toBeVisible();
	await expect(
		targetGrid.getByRole("row", { name: "OpenAI Codex", exact: true }),
	).toBeVisible();
	await expect(
		targetGrid.getByRole("row", { name: "OpenCode", exact: true }),
	).toBeVisible();
	await expect(
		targetGrid.getByRole("row", { name: "Gemini CLI", exact: true }),
	).toBeVisible();

	const universalTop = await targetGrid
		.getByRole("row", { name: "Universal agents" })
		.evaluate((element) => element.offsetTop);
	const claudeTop = await targetGrid
		.getByRole("row", { name: "Claude", exact: true })
		.evaluate((element) => element.offsetTop);
	expect(universalTop).toBe(claudeTop);
}

test.describe("GitHub import targets", () => {
	test.beforeEach(async ({ page }) => {
		await installMocks(page);
		await page.route(e2eApiUrl("/agents"), (route) =>
			route.fulfill({ json: importTargetAgents }),
		);
		await page.route(e2eApiUrl("/agents/availability"), (route) =>
			route.fulfill({ json: importTargetAvailability }),
		);
	});

	test("market uses universal targets", async ({ page }) => {
		await page.goto("/market");
		await page
			.getByRole("tab", { name: "Import Skills from GitHub" })
			.click();
		await scanRepository(page);
		await expectSharedTargets(page);
	});

	test("skills uses the same universal targets", async ({ page }) => {
		await page.goto("/skills");
		await page.getByRole("button", { name: "Add skill" }).click();
		await page
			.getByRole("menuitem", { name: "Import Remote Source" })
			.click();
		await scanRepository(page);
		await expectSharedTargets(page);
	});
});

test("Skill installs default to the universal target and keep native targets", async ({
	page,
}) => {
	await installMocks(page);
	const installRequest = page.waitForRequest((request) =>
		request.url().endsWith("/api/v1/skills/install"),
	);
	const deepLink =
		"aghub://import?type=skill&source=github%2FAkaraChen%2Falpha-pack&name=fresh-skill";
	await page.goto(`/?e2eDeepLink=${encodeURIComponent(deepLink)}`);

	const dialog = page.getByRole("dialog", { name: "Review import" });
	const targetGrid = dialog.getByRole("grid");
	const targets = targetGrid.getByRole("row");
	await expect(targets.first()).toHaveAccessibleName("Universal agents");
	await expect(
		targets.first().getByTestId("universal-skill-target-icon"),
	).toBeVisible();
	await expect(targets.first()).toHaveAttribute("aria-selected", "true");
	await expect(
		targetGrid.getByRole("row", { name: "Claude", exact: true }),
	).toBeVisible();

	await dialog.getByRole("button", { name: "Install", exact: true }).click();
	const request = await installRequest;
	expect(request.postDataJSON()).toMatchObject({
		agents: ["universal"],
		audit_only: true,
	});
});

test("native Skill targets stay separate from the universal directory", async ({
	page,
}) => {
	await installMocks(page);
	const installRequest = page.waitForRequest((request) =>
		request.url().endsWith("/api/v1/skills/install"),
	);
	const deepLink =
		"aghub://import?type=skill&source=github%2FAkaraChen%2Falpha-pack&name=fresh-skill";
	await page.goto(`/?e2eDeepLink=${encodeURIComponent(deepLink)}`);

	const dialog = page.getByRole("dialog", { name: "Review import" });
	const targetGrid = dialog.getByRole("grid");
	await targetGrid.getByRole("row", { name: "Universal agents" }).click();
	await targetGrid.getByRole("row", { name: "Claude", exact: true }).click();
	await dialog.getByRole("button", { name: "Install", exact: true }).click();

	const request = await installRequest;
	expect(request.postDataJSON()).toMatchObject({
		agents: ["claude"],
		audit_only: true,
	});
});

test("a Skill in the universal directory does not select native targets", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	mocks.addSkill(
		"shared-skill",
		"universal",
		"/tmp/e2e/.agents/skills/shared-skill/SKILL.md",
	);
	await page.goto("/skills");

	await page.getByRole("option", { name: "shared-skill" }).click();
	const location = page.locator("[data-skill-location]");
	await expect(location).toHaveCount(1);
	await expect(location).toContainText(
		"/tmp/e2e/.agents/skills/shared-skill",
	);
	await expect(location).toContainText("Universal agents");
	await page.getByRole("button", { name: "Add to Agent" }).click();
	const dialog = page.getByRole("dialog", { name: "Manage Agents" });

	await expect(
		dialog.getByRole("checkbox", { name: /Universal agents/ }),
	).toBeChecked();
	await expect(
		dialog.getByRole("checkbox", { name: "Claude Unconfigured" }),
	).not.toBeChecked();
	await expect(
		dialog.getByRole("checkbox", { name: "Gemini Unconfigured" }),
	).not.toBeChecked();
});
