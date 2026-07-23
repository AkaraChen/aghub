import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

test.describe.configure({ timeout: 60_000 });

const freshLaunchPath = "/mcp?__e2eOnboarding=fresh";
const upgradeLaunchPath = "/mcp?__e2eOnboarding=upgrade";

test.beforeEach(async ({ page }) => {
	await installMocks(page);
});

test("closing before consent leaves the consent step for the next launch", async ({
	page,
}) => {
	await page.goto(freshLaunchPath);
	const wizard = page.getByRole("dialog", { name: "Welcome to Aghub" });

	await expect(wizard).toBeVisible();
	await expect(
		wizard.getByRole("button", { name: "MCP Servers" }),
	).toBeVisible();
	await expect(wizard.getByText(/What's new in/)).toHaveCount(0);

	await wizard.getByRole("button", { name: "Close" }).click();
	await expect(wizard).toBeHidden();

	await page.reload({ waitUntil: "domcontentloaded" });
	await expect(wizard).toBeVisible();
	await expect(
		wizard.getByRole("heading", { name: "Help improve aghub" }),
	).toBeVisible();
	await expect(
		wizard.getByRole("button", { name: "MCP Servers" }),
	).toHaveCount(0);

	await wizard.getByRole("button", { name: "Start Working" }).click();
	await expect(wizard).toBeHidden();
	await page.reload({ waitUntil: "domcontentloaded" });
	await expect(wizard).toHaveCount(0);
});

test("fresh launch keeps release notes out of onboarding and persists consent", async ({
	page,
}) => {
	await page.goto(freshLaunchPath);
	const wizard = page.getByRole("dialog", { name: "Welcome to Aghub" });

	await expect(wizard).toBeVisible();
	await expect(wizard.getByText(/What's new in/)).toHaveCount(0);

	await wizard.getByRole("button", { name: "Next" }).click();
	await wizard.getByRole("button", { name: "Next" }).click();
	await wizard.getByRole("button", { name: "Next" }).click();

	const consent = wizard.getByRole("checkbox", {
		name: "Share anonymous usage data",
	});
	await expect(consent).not.toBeChecked();
	await wizard
		.getByText("Share anonymous usage data", { exact: true })
		.click();
	await expect(consent).toBeChecked();
	await wizard.getByRole("button", { name: "Get Started" }).click();
	await expect(wizard).toBeHidden();
	await expect(
		page.getByText("Everything starts in the sidebar"),
	).toBeVisible();

	await page.reload({ waitUntil: "domcontentloaded" });
	await expect(wizard).toHaveCount(0);
});

test("upgrade notes are acknowledged after the user sees them", async ({
	page,
}) => {
	await page.goto(upgradeLaunchPath);
	const wizard = page.getByRole("dialog", { name: "What's New in Aghub" });

	await expect(wizard).toBeVisible();
	await expect(wizard.getByText("What's new in 1.9.0-beta.1")).toBeVisible();
	await expect(
		wizard.getByRole("heading", {
			name: "Plugins, privacy, and desktop updates",
		}),
	).toBeVisible();

	await wizard.getByRole("button", { name: "Start Working" }).click();
	await expect(wizard).toBeHidden();

	await page.reload({ waitUntil: "domcontentloaded" });
	await expect(wizard).toHaveCount(0);
});

test("manual welcome replay preserves the release-note watermark", async ({
	page,
}) => {
	await page.goto("/settings?tab=application");
	await page.getByRole("button", { name: "Show Welcome" }).click();

	const wizard = page.getByRole("dialog", { name: "Welcome to Aghub" });
	await expect(wizard).toBeVisible();
	await wizard.getByRole("button", { name: "Close" }).click();
	await expect(wizard).toBeHidden();

	const watermark = await page.evaluate(() => {
		const stored = sessionStorage.getItem("aghub-e2e-store:default");
		if (!stored) return null;
		return new Map(JSON.parse(stored)).get("lastSeenWhatsNewVersion");
	});
	expect(watermark).toBe("99.99.99");
});
