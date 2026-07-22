import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

test.describe.configure({ timeout: 60_000 });

const freshLaunchPath = "/mcp?__e2eOnboarding=fresh";

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

	await page.reload({ waitUntil: "domcontentloaded" });
	await expect(wizard).toHaveCount(0);
});
