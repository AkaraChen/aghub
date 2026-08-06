import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

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
	await expect(targets.first()).toHaveAccessibleName(
		"Universal agents (Gemini)",
	);
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
	await targetGrid
		.getByRole("row", { name: "Universal agents (Gemini)" })
		.click();
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
