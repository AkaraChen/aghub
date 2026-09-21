import { expect, test } from "@playwright/test";
import { e2eApiUrl, installMocks } from "./mocks";

for (const pinnedRef of [null, "v1.2.3"]) {
	test(`source sync honors ${pinnedRef ? "a version pin" : "a stored branch"}`, async ({
		page,
	}) => {
		await installMocks(page);
		await page.route(e2eApiUrl("/skills/lock/global"), (route) =>
			route.fulfill({
				json: {
					version: 3,
					lastSelectedAgents: null,
					skills: [
						{
							name: "react-pro",
							source: "AkaraChen/web-dev",
							sourceType: "github",
							sourceUrl: "https://github.com/AkaraChen/web-dev",
							skillPath: "skills/react-pro/SKILL.md",
							ref: "release/v1",
							pinnedRef,
							skillFolderHash: "hash",
							installedAt: "2026-01-01T00:00:00Z",
							updatedAt: "2026-01-01T00:00:00Z",
							pluginName: null,
						},
					],
				},
			}),
		);
		await page.goto("/skills");
		await page.getByRole("option", { name: "react-pro" }).click();
		const scan = page.waitForRequest(e2eApiUrl("/skills/git/scan"));
		await page.getByRole("button", { name: "Sync from source" }).click();
		expect((await scan).postDataJSON().branch).toBe(
			pinnedRef ?? "release/v1",
		);
		await expect(page.getByText("Skill synced successfully")).toBeVisible();
	});
}

test("source sync replaces the current Skill without opening the import flow", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	for (const agent of ["claude", "cursor"]) {
		mocks.setSkillDiff(
			`/tmp/e2e/.${agent}/skills/react-pro/SKILL.md|git:skills/react-pro`,
			{
				identical: false,
				base_hash: "upstream",
				target_hash: "installed",
				files: [],
				files_omitted: 0,
			},
		);
	}
	await page.goto("/skills");
	await page.getByRole("option", { name: "react-pro" }).click();
	const before = page.url();
	await page.getByRole("button", { name: "Sync from source" }).click();
	await expect(page.getByText("Skill synced successfully")).toBeVisible();
	expect(page.url()).toBe(before);
	await expect(page.getByRole("dialog")).toHaveCount(0);
	const writes = mocks
		.getSkillCopyResolutionRequests()
		.filter((request) => !request.audit_only);
	expect(writes).toHaveLength(1);
	expect(writes[0]).toMatchObject({
		reference: { kind: "git_scan", skill_path: "skills/react-pro" },
		expected_reference_hash: "upstream",
		storage_mode: "preserve",
		targets: [
			{
				source_path: "/tmp/e2e/.claude/skills/react-pro/SKILL.md",
				expected_hash: "installed",
			},
			{
				source_path: "/tmp/e2e/.cursor/skills/react-pro/SKILL.md",
				expected_hash: "installed",
			},
		],
	});
});

test("an unreadable local copy prevents every write", async ({ page }) => {
	const mocks = await installMocks(page);
	await page.route(e2eApiUrl("/credentials"), (route) =>
		route.fulfill({ json: [] }),
	);
	mocks.setSkillDiffError(
		"/tmp/e2e/.claude/skills/react-pro/SKILL.md|git:skills/react-pro",
	);
	await page.goto("/skills");
	await page.getByRole("button", { name: "Sync from source" }).click();
	await expect(page.locator('[data-slot="toast"]')).toContainText(
		"Some skill copies could not be compared",
	);
	expect(mocks.getSkillCopyResolutionRequests()).toHaveLength(0);
});

test("a changed target fails without repeating the overwrite", async ({
	page,
}) => {
	await installMocks(page);
	let attempts = 0;
	await page.route(e2eApiUrl("/skills/copies/resolve"), async (route) => {
		attempts += 1;
		await route.fulfill({
			status: 409,
			json: {
				error: "Skill changed during sync",
				code: "SKILL_COPY_CHANGED",
			},
		});
	});
	await page.goto("/skills");
	await page.getByRole("button", { name: "Sync from source" }).click();
	await expect(page.locator('[data-slot="toast"]')).toContainText(
		"Skill changed during sync",
	);
	expect(attempts).toBe(1);
	await expect(page.getByText("Skill synced successfully")).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Sync from source" }),
	).toBeEnabled();
});

test("leaving the detail during the scan never starts a write", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route(e2eApiUrl("/skills/git/scan"), async (route) => {
		await gate;
		await route.fallback();
	});
	await page.goto("/skills");
	const scan = page.waitForRequest(e2eApiUrl("/skills/git/scan"));
	await page.getByRole("button", { name: "Sync from source" }).click();
	await scan;
	await page.getByRole("option", { name: "css-wizard" }).click();
	// The detail follows the list selection through useDeferredValue.
	await expect(
		page.getByRole("heading", { name: "css-wizard" }),
	).toBeVisible();
	const response = page.waitForResponse(e2eApiUrl("/skills/git/scan"));
	release();
	await response;
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() =>
					requestAnimationFrame(() => resolve()),
				),
			),
	);
	expect(mocks.getSkillCopyResolutionRequests()).toHaveLength(0);
});

test("a scan failure can retry with a saved credential", async ({ page }) => {
	const mocks = await installMocks(page);
	const credentialIds: Array<string | null> = [];
	await page.route(e2eApiUrl("/skills/git/scan"), async (route) => {
		const body = route.request().postDataJSON();
		credentialIds.push(body.credential_id);
		if (!body.credential_id) {
			await route.fulfill({
				status: 401,
				json: {
					error: "Repository requires authentication",
					code: "AUTH_REQUIRED",
				},
			});
		} else {
			await route.fallback();
		}
	});
	await page.route(e2eApiUrl("/credentials"), (route) =>
		route.fulfill({
			json: [
				{
					id: "private-repo",
					name: "Repository access",
					credential_type: "github",
				},
			],
		}),
	);
	await page.goto("/skills");
	await page.getByRole("button", { name: "Sync from source" }).click();
	const dialog = page.getByRole("dialog", { name: "Sync Skill" });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: /Credentials/ }).click();
	await page.getByRole("option", { name: "Repository access" }).click();
	await dialog.getByRole("button", { name: "Sync from source" }).click();
	await expect(page.getByText("Skill synced successfully")).toBeVisible();
	expect(credentialIds).toEqual([null, "private-repo"]);
	expect(
		mocks
			.getSkillCopyResolutionRequests()
			.filter((request) => !request.audit_only),
	).toHaveLength(1);
});
