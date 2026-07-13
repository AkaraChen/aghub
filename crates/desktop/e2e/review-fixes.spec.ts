import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

/**
 * Regressions for the review fixes: select-all scoped to visible rows,
 * keyboard selection not replaying stale click modifiers, and the
 * context menu not stealing focus on pointer dismissal.
 */

test.beforeEach(async ({ page }) => {
	await installMocks(page);
	await page.goto("/skills");
	await expect(
		page.getByRole("option", { name: "solo-skill" }),
	).toBeVisible();
});

test("Cmd+A while searching selects only the visible rows", async ({
	page,
}) => {
	// Narrow the list to one skill, then move scope back to the list —
	// Cmd+A is deliberately inert while an editable field has focus.
	const searchField = page.getByPlaceholder("Search skills...");
	await searchField.fill("solo-skill");
	await expect(page.getByRole("option", { name: "react-pro" })).toBeHidden();
	await searchField.blur();
	const solo = page.getByRole("option", { name: "solo-skill" });
	await solo.hover();
	await page.keyboard.press("ControlOrMeta+a");

	// One visible row selected — the detail shows; the bulk panel (which
	// a pre-search sweep of all 5 skills would open) must not.
	await expect(
		page.getByRole("heading", { name: "solo-skill" }),
	).toBeVisible();
	await expect(page.getByText("items selected")).toBeHidden();

	// Clearing the search restores the full sweep.
	await searchField.fill("");
	await expect(page.getByRole("option", { name: "react-pro" })).toBeVisible();
	await searchField.blur();
	await solo.hover();
	await page.keyboard.press("ControlOrMeta+a");
	await expect(page.getByText("5 items selected")).toBeVisible();
});

test("the blank-area Select All respects the active search", async ({
	page,
}) => {
	await page.getByPlaceholder("Search skills...").fill("solo-skill");
	await expect(page.getByRole("option", { name: "react-pro" })).toBeHidden();

	// Right-click the blank strip under the rows for the page menu.
	const list = page.getByRole("option", { name: "solo-skill" });
	const box = await list.boundingBox();
	if (!box) throw new Error("row missing");
	await page.mouse.click(box.x + box.width / 2, box.y + box.height + 80, {
		button: "right",
	});
	await page.getByRole("menuitem", { name: "Select All" }).click();

	await expect(
		page.getByRole("heading", { name: "solo-skill" }),
	).toBeVisible();
	await expect(page.getByText("items selected")).toBeHidden();
});

test("keyboard selection does not replay the last click's shift", async ({
	page,
}) => {
	// web-dev holds the seeded react-pro, so its section starts expanded
	// with css-wizard and react-pro in one ListBox.
	await page.getByRole("option", { name: "css-wizard" }).click();
	await page
		.getByRole("option", { name: "react-pro" })
		.click({ modifiers: ["Shift"] });
	await expect(page.getByText("2 items selected")).toBeVisible();

	// Shift is up now. Focus back to css-wizard and toggle it off with
	// Space: react-pro must remain selected. A stale shift snapshot would
	// rerun the range from the css-wizard anchor instead, collapsing the
	// selection to css-wizard alone.
	await page.keyboard.press("ArrowUp");
	await page.keyboard.press("Space");
	await expect(page.getByText("2 items selected")).toBeHidden();
	await expect(
		page.getByRole("heading", { name: "react-pro" }),
	).toBeVisible();
});

test("dismissing the context menu by clicking a field keeps its focus", async ({
	page,
}) => {
	await page
		.getByRole("option", { name: "solo-skill" })
		.click({ button: "right" });
	await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();

	// Clicking into the search field closes the menu; focus belongs to
	// the field the user just clicked, not the pre-menu element.
	const search = page.getByPlaceholder("Search skills...");
	await search.click();
	await expect(page.getByRole("menuitem", { name: "Delete" })).toBeHidden();
	await expect(search).toBeFocused();
	await page.keyboard.type("wiz");
	await expect(search).toHaveValue("wiz");
});
