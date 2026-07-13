import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

test.beforeEach(async ({ page }) => {
	await installMocks(page);
	await page.goto("/skills");
});

test("right-clicking a project renames it", async ({ page }) => {
	const project = page.getByRole("link", { name: "demo-project" });
	await expect(project).toBeVisible();

	await project.click({ button: "right" });
	await page
		.getByRole("menu", { name: "Actions" })
		.getByRole("menuitem", { name: "Rename" })
		.click();

	const dialog = page.getByRole("dialog", { name: "Rename project" });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("textbox").fill("renamed-project");
	await dialog.getByRole("button", { name: "Save" }).click();

	await expect(
		page.getByRole("link", { name: "renamed-project" }),
	).toBeVisible();
	await expect(page.getByRole("link", { name: "demo-project" })).toBeHidden();
});
