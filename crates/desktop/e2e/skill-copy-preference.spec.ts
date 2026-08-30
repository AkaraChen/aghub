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
	showDisplayNames: true,
	discovery: {
		projectSkills: true,
		embeddedSkills: true,
		dependencySkills: false,
		agentProvidedSkills: true,
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
	await expect(panel.locator('[data-slot="card-header"]')).toHaveCount(0);
	await expect(
		panel.locator('[data-slot="card"] [data-slot="surface"]'),
	).toHaveCount(0);
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
		.getByRole("checkbox", { name: "List dependency Skills separately" })
		.press("Space");

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
				agentProvidedSkills: true,
			},
		});
});

test("skill preference controls share one compact row layout", async ({
	page,
}) => {
	await installMocks(page);
	await page.setViewportSize({ width: 1024, height: 768 });
	await page.goto("/settings?tab=skills");
	await page.addStyleTag({
		content:
			"*, *::before, *::after { transition-duration: 0s !important; }",
	});

	const timingLabel = page.getByText("When to check", { exact: true });
	const automatic = page.getByRole("radio", { name: "Automatic" });
	const [timingBox, automaticBox] = await Promise.all([
		timingLabel.boundingBox(),
		automatic.boundingBox(),
	]);

	expect(timingBox).not.toBeNull();
	expect(automaticBox).not.toBeNull();
	expect(automaticBox?.x).toBeGreaterThan(timingBox?.x ?? 0);
	expect(
		Math.abs(
			(automaticBox?.y ?? 0) +
				(automaticBox?.height ?? 0) / 2 -
				((timingBox?.y ?? 0) + (timingBox?.height ?? 0) / 2),
		),
	).toBeLessThanOrEqual(timingBox?.height ?? 0);

	const storageChoice = page
		.locator('[data-slot="radio"]')
		.filter({ hasText: "Keep the current storage method" });
	await expect(storageChoice).toHaveCSS("border-top-width", "1px");

	const projectSkills = page
		.locator('[data-slot="checkbox"]')
		.filter({ hasText: "Project Skills" });
	await expect(projectSkills).toHaveClass(/checkbox--secondary/);
	await expect(projectSkills).toHaveCSS("border-top-width", "1px");

	const [radioRadius, checkboxRadius, radioBackground] = await Promise.all([
		storageChoice.evaluate(
			(element) => getComputedStyle(element).borderTopLeftRadius,
		),
		projectSkills.evaluate(
			(element) => getComputedStyle(element).borderTopLeftRadius,
		),
		storageChoice.evaluate(
			(element) => getComputedStyle(element).backgroundColor,
		),
	]);
	expect(radioRadius).not.toBe("0px");
	expect(checkboxRadius).toBe(radioRadius);
	expect(radioBackground).not.toBe("rgba(0, 0, 0, 0)");

	await storageChoice.hover();
	await expect
		.poll(() =>
			storageChoice.evaluate(
				(element) => getComputedStyle(element).backgroundColor,
			),
		)
		.not.toBe(radioBackground);
	const radioHoverColor = await storageChoice.evaluate(
		(element) => getComputedStyle(element).backgroundColor,
	);
	await projectSkills.hover();
	await expect
		.poll(() =>
			projectSkills.evaluate(
				(element) => getComputedStyle(element).backgroundColor,
			),
		)
		.toBe(radioHoverColor);

	const matchingContentSwitch = page
		.locator('[data-slot="switch"]')
		.filter({ hasText: "Show matching content once" });
	const conflictingContentSwitch = page
		.locator('[data-slot="switch"]')
		.filter({ hasText: "Flag content conflicts" });
	await expect(matchingContentSwitch).toHaveCSS("border-bottom-width", "0px");
	await expect(conflictingContentSwitch).toHaveCSS("border-top-width", "0px");

	const storageChoices = page
		.getByRole("radiogroup", {
			name: "When writing to other locations",
		})
		.locator('[data-slot="radio"]');
	const skillSources = page.locator('[data-slot="checkbox"]');
	const [firstStorageBox, secondStorageBox, firstSourceBox, secondSourceBox] =
		await Promise.all([
			storageChoices.nth(0).boundingBox(),
			storageChoices.nth(1).boundingBox(),
			skillSources.nth(0).boundingBox(),
			skillSources.nth(1).boundingBox(),
		]);
	expect(firstStorageBox).not.toBeNull();
	expect(secondStorageBox).not.toBeNull();
	expect(firstSourceBox).not.toBeNull();
	expect(secondSourceBox).not.toBeNull();
	const storageGap =
		(secondStorageBox?.y ?? 0) -
		((firstStorageBox?.y ?? 0) + (firstStorageBox?.height ?? 0));
	const sourceGap =
		(secondSourceBox?.y ?? 0) -
		((firstSourceBox?.y ?? 0) + (firstSourceBox?.height ?? 0));
	expect(storageGap).toBe(sourceGap);
});
