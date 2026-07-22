import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

test.beforeEach(async ({ page }) => {
	await installMocks(page);
	await page.goto("/rules");
	await expect(
		page.getByRole("option", { name: /CLAUDE\.md/ }),
	).toBeVisible();
});

test("rule drafts survive file switches and persist after save", async ({
	page,
}) => {
	await page.getByRole("option", { name: /CLAUDE\.md/ }).click();
	const editor = page.getByRole("textbox", { name: "CLAUDE.md" });
	await expect(editor).toHaveValue("# Existing rules\n");

	await editor.fill("# Unsaved draft\n");
	await page.getByRole("option", { name: /GEMINI\.md/ }).click();
	await page.getByRole("option", { name: /CLAUDE\.md/ }).click();
	await expect(editor).toHaveValue("# Unsaved draft\n");

	await page.getByRole("button", { name: "Save" }).click();
	await expect(page.getByText("Rule file saved")).toBeVisible();
	await page.reload({ waitUntil: "domcontentloaded" });
	await expect(editor).toHaveValue("# Unsaved draft\n");
});

test("saving a missing rule creates it and search reports no matches", async ({
	page,
}) => {
	await page.getByRole("option", { name: /GEMINI\.md/ }).click();
	await expect(
		page.getByText("This file does not exist yet", { exact: false }),
	).toBeVisible();

	const editor = page.getByRole("textbox", { name: "GEMINI.md" });
	await editor.fill("# Gemini rules\n");
	await page.getByRole("button", { name: "Save" }).click();
	await expect(
		page.getByRole("option", { name: /GEMINI\.md.*Exists/ }),
	).toBeVisible();
	await expect(
		page.getByText("This file does not exist yet", { exact: false }),
	).toBeHidden();

	await page.getByRole("searchbox", { name: "Search rules..." }).fill("none");
	await expect(page.getByText("No results", { exact: true })).toBeVisible();
});

test("global search opens a rule file", async ({ page }) => {
	await page.goto("/mcp");
	await expect(page.getByRole("option", { name: "alpha-mcp" })).toBeVisible();

	await page
		.getByRole("combobox", { name: "Search agents and resources" })
		.fill("CLAUDE");
	const results = page.getByRole("listbox", {
		name: "Search agents and resources",
	});
	await results.getByRole("option", { name: /CLAUDE\.md/ }).click();

	await expect(page).toHaveURL(/\/rules\?rule=/);
	await expect(
		page.getByRole("heading", { name: "CLAUDE.md" }),
	).toBeVisible();
});
