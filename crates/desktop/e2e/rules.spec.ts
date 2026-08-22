import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

let mocks: Awaited<ReturnType<typeof installMocks>>;

test.beforeEach(async ({ page }) => {
	mocks = await installMocks(page);
	await page.goto("/rules");
	await expect(
		page.getByRole("option", { name: /CLAUDE\.md/ }),
	).toBeVisible();
});

test("puts the agent identity before the rule file and names missing files accurately", async ({
	page,
}) => {
	await expect(
		page.getByRole("option", { name: /^Claude.*CLAUDE\.md/ }),
	).toBeVisible();
	await expect(
		page.getByRole("option", { name: /GEMINI\.md.*Not created/ }),
	).toBeVisible();
	await expect(page.getByText("Disabled", { exact: true })).toHaveCount(0);
});

test("opens saved rule versions and restores one through the editor", async ({
	page,
}) => {
	await page.getByRole("option", { name: /CLAUDE\.md/ }).click();
	await page.getByRole("button", { name: "Version history" }).click();

	const dialog = page.getByRole("dialog", { name: "Version history" });
	await expect(dialog.getByText("# Previous rules")).toBeVisible();
	await dialog.getByRole("button", { name: "Use this version" }).click();

	await expect(page.getByRole("textbox", { name: "CLAUDE.md" })).toHaveValue(
		"# Previous rules\n",
	);
	await expect(dialog).toBeHidden();
});

test("rule editor fills its content area without native resizing", async ({
	page,
}) => {
	await page.getByRole("option", { name: /CLAUDE\.md/ }).click();
	const editor = page.getByRole("textbox", { name: "CLAUDE.md" });

	const layout = await editor.evaluate((element) => {
		const parent = element.parentElement;
		if (!parent) throw new Error("Rule editor has no content container");

		const parentStyle = getComputedStyle(parent);
		return {
			availableWidth:
				parent.clientWidth -
				Number.parseFloat(parentStyle.paddingLeft) -
				Number.parseFloat(parentStyle.paddingRight),
			editorWidth: element.getBoundingClientRect().width,
			resize: getComputedStyle(element).resize,
		};
	});

	expect(layout.editorWidth).toBeGreaterThanOrEqual(
		layout.availableWidth - 1,
	);
	expect(layout.resize).toBe("none");
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

test("external edits preserve the draft until the user resolves the conflict", async ({
	page,
}) => {
	await page.getByRole("option", { name: /CLAUDE\.md/ }).click();
	const editor = page.getByRole("textbox", { name: "CLAUDE.md" });
	await editor.fill("# Stale draft\n");
	mocks.setRuleContent("~/.claude/CLAUDE.md", "# External edit\n");

	await page.getByRole("button", { name: "Save" }).click();
	await expect(
		page.getByText("This file changed outside aghub", { exact: false }),
	).toBeVisible();
	await expect(editor).toHaveValue("# Stale draft\n");
	expect(mocks.getRuleContent("~/.claude/CLAUDE.md")).toBe(
		"# External edit\n",
	);

	await page.getByRole("button", { name: "Reload from disk" }).click();
	await expect(editor).toHaveValue("# External edit\n");

	await editor.fill("# Draft to keep\n");
	mocks.setRuleContent("~/.claude/CLAUDE.md", "# Second external edit\n");
	await page.getByRole("button", { name: "Save" }).click();
	await page.getByRole("button", { name: "Overwrite disk file" }).click();

	await expect(page.getByText("Rule file saved")).toBeVisible();
	expect(mocks.getRuleContent("~/.claude/CLAUDE.md")).toBe(
		"# Draft to keep\n",
	);
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
		.getByRole("combobox", {
			name: "Search agents, skills, MCP servers, sub-agents, prompts, rules, and library",
		})
		.fill("CLAUDE");
	const results = page.getByRole("listbox", {
		name: "Search agents, skills, MCP servers, sub-agents, prompts, rules, and library",
	});
	await results.getByRole("option", { name: /CLAUDE\.md/ }).click();

	await expect(page).toHaveURL(/\/rules\?rule=/);
	await expect(
		page.getByRole("heading", { name: "CLAUDE.md" }),
	).toBeVisible();
});

test("settings keep prompt data and rule versions together", async ({
	page,
}) => {
	await page.goto("/settings?tab=prompts");

	await expect(
		page.getByRole("tab", { name: "Prompts & Rules" }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Local prompt library" }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Rule version history" }),
	).toBeVisible();
	await expect(
		page.getByText(
			"C:\\Users\\demo\\AppData\\Roaming\\aghub\\rule-versions.json",
		),
	).toBeVisible();
	await expect(page.getByText("20 versions per rule file")).toBeVisible();

	await page.getByRole("button", { name: "Clear version history" }).click();
	const dialog = page.getByRole("alertdialog", {
		name: "Clear rule version history?",
	});
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "Clear history" }).click();
	await expect(page.getByText("Rule version history cleared")).toBeVisible();
	expect(mocks.getClearedRuleVersionCount()).toBe(1);
});
