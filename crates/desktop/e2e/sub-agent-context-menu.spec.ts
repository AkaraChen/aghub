import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

test("right-clicking a sub-agent offers edit and delete", async ({ page }) => {
	await installMocks(page);
	await page.goto("/sub-agents");

	await page
		.getByRole("option", { name: "reviewer" })
		.click({ button: "right" });

	const menu = page.getByRole("menu", { name: "Actions" });
	await expect(menu).toBeVisible();
	await expect(
		menu.getByRole("menuitem", { name: "Edit sub-agent" }),
	).toBeVisible();
	await expect(
		menu.getByRole("menuitem", { name: "Delete sub-agent" }),
	).toBeVisible();

	// Edit opens the edit form
	await menu.getByRole("menuitem", { name: "Edit sub-agent" }).click();
	await expect(page.getByRole("textbox").first()).toBeVisible();
});
