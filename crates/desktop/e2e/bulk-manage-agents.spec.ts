import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

/**
 * Bulk "Add to Agent" with heterogeneous coverage: react-pro is installed
 * on claude AND cursor, solo-skill on claude only. The dialog must seed
 * cursor as INDETERMINATE (macOS-style tri-state) and Apply must leave it
 * untouched — the old plan (removed = installed − selected) seeded it
 * unchecked and silently uninstalled react-pro from cursor.
 */

async function selectHeterogeneousPair(page: Page) {
	// Two skills with heterogeneous agent installs
	await page.getByRole("option", { name: "solo-skill" }).click();
	await page
		.getByRole("option", { name: "react-pro" })
		.click({ modifiers: ["ControlOrMeta"] });
	await expect(page.getByText("2 items selected")).toBeVisible();
}

async function openBulkManageDialog(page: Page): Promise<Locator> {
	// Open the manage dialog from the selection's context menu
	await page
		.getByRole("option", { name: "react-pro" })
		.click({ button: "right" });
	await page
		.getByRole("menu", { name: "Resource actions" })
		.getByRole("menuitem", { name: "Add to Agent" })
		.click();

	const dialog = page.getByRole("dialog", { name: "Manage Agents" });
	await expect(dialog).toBeVisible();
	return dialog;
}

const agentCheckbox = (dialog: Locator, name: string) =>
	dialog.getByRole("checkbox", { name: new RegExp(`^${name}\\b`) });
const agentRow = (dialog: Locator, name: string) =>
	agentCheckbox(dialog, name).locator(
		'xpath=ancestor::*[@data-slot="checkbox"][1]',
	);

test.beforeEach(async ({ page }) => {
	await installMocks(page);
	await page.goto("/skills");
	await expect(
		page.getByRole("option", { name: "solo-skill" }),
	).toBeVisible();
});

test("bulk add to a new agent leaves a partially installed agent untouched", async ({
	page,
}) => {
	// Baseline coverage of the selection: claude 2/2, cursor 1/2, gemini 0/2
	await selectHeterogeneousPair(page);
	await expect(page.getByTestId("matrix-row-claude")).toContainText("2/2");
	await expect(page.getByTestId("matrix-row-cursor")).toContainText("1/2");
	await expect(page.getByTestId("matrix-row-gemini")).toContainText("0/2");

	const dialog = await openBulkManageDialog(page);

	// claude (on every item) seeds checked; cursor (a strict subset) seeds
	// INDETERMINATE, not unchecked — unchecked would mean "remove"
	await expect(agentCheckbox(dialog, "Claude")).toBeChecked();
	await expect(agentCheckbox(dialog, "Cursor")).toHaveJSProperty(
		"indeterminate",
		true,
	);
	await expect(agentCheckbox(dialog, "Cursor")).not.toBeChecked();
	await expect(agentCheckbox(dialog, "Gemini")).not.toBeChecked();

	// The untouched tri-state is not a diff: nothing to apply yet
	await expect(
		dialog.getByRole("button", { name: "Apply changes" }),
	).toBeDisabled();

	// Check gemini and apply
	await agentRow(dialog, "Gemini").click();
	await expect(agentCheckbox(dialog, "Gemini")).toBeChecked();
	await dialog.getByRole("button", { name: "Apply changes" }).click();
	await expect(dialog).toBeHidden();

	// gemini gained both items — and cursor STILL has react-pro. Under the
	// old plan this read 0/2: cursor was uninstalled from react-pro.
	await expect(page.getByTestId("matrix-row-gemini")).toContainText("2/2");
	await expect(page.getByTestId("matrix-row-cursor")).toContainText("1/2");
	await expect(page.getByTestId("matrix-row-claude")).toContainText("2/2");
});

test("an indeterminate agent cycles to checked, then toggles like the rest", async ({
	page,
}) => {
	await selectHeterogeneousPair(page);
	const dialog = await openBulkManageDialog(page);
	const cursor = agentCheckbox(dialog, "Cursor");

	await expect(cursor).toHaveJSProperty("indeterminate", true);

	// First click: indeterminate -> checked ("install on the items missing
	// it"), shown as an addition
	await agentRow(dialog, "Cursor").click();
	await expect(cursor).toBeChecked();
	await expect(cursor).toHaveJSProperty("indeterminate", false);
	await expect(agentRow(dialog, "Cursor")).toContainText("Adding");

	// Second click: checked -> unchecked ("remove from the items having
	// it") — an explicit removal, never a silent one
	await agentRow(dialog, "Cursor").click();
	await expect(cursor).not.toBeChecked();
	await expect(cursor).toHaveJSProperty("indeterminate", false);
	await expect(agentRow(dialog, "Cursor")).toContainText("Removing");
	await expect(
		dialog.getByRole("button", { name: "Apply changes" }),
	).toBeEnabled();
});
