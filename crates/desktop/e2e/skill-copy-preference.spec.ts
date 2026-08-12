import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

interface SkillCopyPreferenceTestState {
	getStoreValue: (key: string) => unknown;
}

function storedPreferences() {
	return (
		window as unknown as {
			__AGHUB_E2E__: SkillCopyPreferenceTestState;
		}
	).__AGHUB_E2E__.getStoreValue("skillPreferences");
}

const DEFAULT_PREFERENCES = {
	enabled: true,
	mode: "automatic",
	groupIdenticalCopies: true,
	warnOnConflicts: true,
	defaultStorageMode: "preserve",
	discovery: {
		projectSkills: true,
		embeddedSkills: true,
		dependencySkills: false,
	},
};

test("manual copy checks run only when requested from skill details", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	await page.goto("/settings?tab=skills");

	await page.getByRole("radio", { name: "Manual" }).click();
	await expect
		.poll(() => page.evaluate(storedPreferences))
		.toEqual({ ...DEFAULT_PREFERENCES, mode: "manual" });

	await page.getByRole("link", { name: "Skills", exact: true }).click();
	await page.getByRole("option", { name: "react-pro" }).click();
	await expect(
		page.getByRole("button", { name: "Check changes" }),
	).toBeVisible();
	expect(mocks.getSkillCopyStatusRequestCount()).toBe(0);
	expect(mocks.getSkillDiffRequests()).toHaveLength(0);
	expect(mocks.getSkillTreeRequests()).toEqual([
		"/tmp/e2e/.claude/skills/react-pro/SKILL.md",
	]);

	await page.getByRole("button", { name: "Check changes" }).click();
	await expect.poll(() => mocks.getSkillDiffRequests()).toHaveLength(1);
	await expect
		.poll(() => mocks.getSkillTreeRequests())
		.toEqual([
			"/tmp/e2e/.claude/skills/react-pro/SKILL.md",
			"/tmp/e2e/.cursor/skills/react-pro/SKILL.md",
		]);
});

test("disabled copy checks issue no scan requests", async ({ page }) => {
	const mocks = await installMocks(page);
	await page.goto("/settings?tab=skills");

	await page.getByRole("radio", { name: "Off" }).click();
	await expect
		.poll(() => page.evaluate(storedPreferences))
		.toEqual({ ...DEFAULT_PREFERENCES, enabled: false });

	await page.getByRole("link", { name: "Skills", exact: true }).click();
	await page.getByRole("option", { name: "react-pro" }).click();
	await expect(
		page.getByRole("button", { name: "Check changes" }),
	).toHaveCount(0);
	expect(mocks.getSkillCopyStatusRequestCount()).toBe(0);
	expect(mocks.getSkillDiffRequests()).toHaveLength(0);
	expect(mocks.getSkillTreeRequests()).toEqual([
		"/tmp/e2e/.claude/skills/react-pro/SKILL.md",
	]);
});

test("skill copy and discovery preferences are compact and stored", async ({
	page,
}) => {
	await installMocks(page);
	await page.setViewportSize({ width: 1024, height: 768 });
	await page.goto("/settings?tab=skills");

	const panel = page.getByRole("tabpanel", { name: "Skills" });
	await expect(panel).toBeVisible();
	await expect(page.getByText("Installation location")).toHaveCount(0);
	expect(
		await panel.evaluate(
			(element) => element.scrollWidth <= element.clientWidth,
		),
	).toBe(true);
	await page
		.getByRole("switch", { name: /Show matching content once/ })
		.press("Space");
	await page
		.getByRole("switch", { name: /Flag content conflicts/ })
		.press("Space");
	await page
		.locator('[data-slot="radio-content"]')
		.filter({ hasText: "Write independent files" })
		.click();
	await page
		.locator('[data-slot="checkbox-content"]')
		.filter({ hasText: "Project Skills" })
		.click();
	await page
		.locator('[data-slot="checkbox-content"]')
		.filter({ hasText: "Skills in dependencies" })
		.click();

	await expect
		.poll(() => page.evaluate(storedPreferences))
		.toEqual({
			...DEFAULT_PREFERENCES,
			groupIdenticalCopies: false,
			warnOnConflicts: false,
			defaultStorageMode: "copy",
			discovery: {
				projectSkills: false,
				embeddedSkills: true,
				dependencySkills: true,
			},
		});
});
