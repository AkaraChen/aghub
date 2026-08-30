import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

test("nested Skills remain visible in the parent detail", async ({ page }) => {
	await installMocks(page);

	await page.route("**/api/v1/skills/tree**", (route) => {
		const url = new URL(route.request().url());
		const treePath = url.searchParams.get("path") ?? "";
		if (!treePath.includes("solo-skill")) return route.fallback();

		return route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				name: "solo-skill",
				path: treePath,
				kind: "directory",
				children: [
					{
						name: "SKILL.md",
						path: `${treePath}/SKILL.md`,
						kind: "file",
						children: [],
					},
					{
						name: "vendor",
						path: `${treePath}/vendor`,
						kind: "directory",
						children: [
							{
								name: "nested-tool",
								path: `${treePath}/vendor/nested-tool`,
								kind: "directory",
								skill: {
									name: "nested-command",
									display_name: "Nested Tool",
								},
								children: [
									{
										name: "SKILL.md",
										path: `${treePath}/vendor/nested-tool/SKILL.md`,
										kind: "file",
										children: [],
									},
								],
							},
						],
					},
				],
			}),
		});
	});

	await page.goto("/skills");
	await page.getByRole("option", { name: "solo-skill" }).click();

	const section = page.getByRole("region", { name: "Contained Skills" });
	await expect(section).toContainText("nested-command");
	await expect(section).toContainText("Nested Tool");
	await expect(section).toContainText("vendor/nested-tool");
});

test("a skill tree client error is shown once and can be retried", async ({
	page,
}) => {
	await installMocks(page);
	let treeRequests = 0;

	await page.route("**/api/v1/skills/tree**", (route) => {
		const url = new URL(route.request().url());
		if (!url.searchParams.get("path")?.includes("solo-skill")) {
			return route.fallback();
		}

		treeRequests += 1;
		return route.fulfill({
			status: 400,
			contentType: "application/json",
			body: JSON.stringify({
				code: "INVALID_SKILL_PATH",
				error: "Symbolic links are not supported for skill files.",
			}),
		});
	});

	await page.goto("/skills");
	await page.getByRole("option", { name: "solo-skill" }).click();

	const status = page.getByRole("alert");
	await expect(status).toHaveAttribute("data-slot", "alert-root");
	await expect(status).toContainText("Files unavailable");
	await expect(status).toContainText(
		"aghub couldn't inspect this copy's files.",
	);
	await expect(status).not.toContainText("Symbolic links are not supported");
	await expect.poll(() => treeRequests).toBe(1);

	await status.getByRole("button", { name: "Check Again" }).click();
	await expect.poll(() => treeRequests).toBe(2);
	const toast = page.locator('[data-slot="toast"]');
	await expect(toast).toContainText("Files unavailable");
	await expect(toast).toContainText(
		"aghub couldn't inspect this copy's files.",
	);
});

test("a broken file link is shown inside the skill tree", async ({ page }) => {
	await installMocks(page);

	await page.route("**/api/v1/skills/tree**", (route) => {
		const url = new URL(route.request().url());
		const treePath = url.searchParams.get("path") ?? "";
		if (!treePath.includes("react-pro")) return route.fallback();

		return route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				name: "react-pro",
				path: treePath,
				kind: "directory",
				children: [
					{
						name: "SKILL.md",
						path: `${treePath}/SKILL.md`,
						kind: "file",
						children: [],
					},
					{
						name: "references",
						path: `${treePath}/references`,
						kind: "directory",
						children: [
							{
								name: "example.html",
								path: `${treePath}/references/example.html`,
								kind: "symlink",
								children: [],
								link: {
									status: "broken",
								},
							},
						],
					},
				],
			}),
		});
	});

	await page.goto("/skills");
	await page.getByRole("option", { name: "react-pro" }).click();
	const locationStatus = page
		.locator("[data-skill-location]")
		.first()
		.locator('[data-skill-link-summary="problem"]');
	await expect(locationStatus).toContainText("1 file link");
	await expect(locationStatus).toContainText("1 needs attention");
	await page.getByRole("button", { name: /^Files/ }).click();

	const link = page.locator('[data-skill-link-status="broken"]');
	await expect(link).toContainText("Target not found");
	await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a linked skill location shows its link state and file-link health", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	mocks.setSkillSymlink("solo-skill", "claude");

	await page.route("**/api/v1/skills/tree**", (route) => {
		const url = new URL(route.request().url());
		const treePath = url.searchParams.get("path") ?? "";
		if (!treePath.includes("solo-skill")) return route.fallback();

		return route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				name: "solo-skill",
				path: treePath,
				kind: "directory",
				link: {
					target: "~/Developer/shared-skills/solo-skill",
					status: "valid",
				},
				children: [
					{
						name: "SKILL.md",
						path: `${treePath}/SKILL.md`,
						kind: "file",
						children: [],
					},
					{
						name: "references",
						path: `${treePath}/references`,
						kind: "directory",
						children: [
							{
								name: "reference.md",
								path: `${treePath}/references/reference.md`,
								kind: "symlink",
								children: [],
								link: {
									target: "source.md",
									status: "valid",
								},
							},
						],
					},
				],
			}),
		});
	});

	await page.goto("/skills");
	await page.getByRole("option", { name: "solo-skill" }).click();

	const location = page.locator("[data-skill-location]").first();
	const rootLink = location.locator("[data-skill-location-link='valid']");
	await expect(rootLink).toContainText("Symlink");
	await expect(rootLink).toContainText(
		"~/Developer/shared-skills/solo-skill",
	);
	const targetName = location.getByText("Claude", { exact: true });
	const [targetBox, rootLinkBox] = await Promise.all([
		targetName.boundingBox(),
		rootLink.boundingBox(),
	]);
	expect(targetBox).not.toBeNull();
	expect(rootLinkBox).not.toBeNull();
	expect(
		rootLinkBox!.y - (targetBox!.y + targetBox!.height),
	).toBeLessThanOrEqual(10);
	await expect(
		location.locator('[data-skill-link-summary="healthy"]'),
	).toHaveCount(0);
	await expect(location).not.toContainText("Link available");
});

test("a partial agent coverage failure identifies the skill and agent", async ({
	page,
}) => {
	await installMocks(page);

	await page.route("**/api/v1/skills/reconcile", async (route) => {
		const body = route.request().postDataJSON() as {
			added?: string[];
			source?: { name?: string };
		};
		const agent = body.added?.[0] ?? "cursor";
		const name = body.source?.name ?? "";
		const failed = name === "api-forge";

		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				success_count: failed ? 0 : 1,
				failed_count: failed ? 1 : 0,
				results: [
					{
						agent,
						scope: "global",
						project_root: null,
						action: "copy",
						success: !failed,
						error: failed ? "Source SKILL.md is missing." : null,
					},
				],
			}),
		});
	});

	await page.goto("/skills");
	await page
		.getByRole("button", {
			name: "github/AkaraChen/alpha-pack",
			exact: true,
		})
		.click();
	await page.getByTestId("matrix-row-cursor").click();

	await expect(page.getByText("1 succeeded · 1 failed")).toBeVisible();
	await expect(
		page.getByText(
			"Could not update Cursor: api-forge — Source SKILL.md is missing.",
		),
	).toBeVisible();
});
