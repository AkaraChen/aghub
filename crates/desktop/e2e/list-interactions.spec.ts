import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

/**
 * dnd-kit rides pointer events (PointerSensor, 8px activation), so drive
 * a real Playwright mouse: press the source, cross the activation
 * threshold, then move to the target and release. The target is resolved
 * after activation because drag-only targets (the new-group zone, the
 * drop board) only render once a drag is underway.
 */
async function dragOptionTo(
	page: Page,
	optionText: string,
	targetTestId: string,
) {
	// A just-closed dialog's backdrop lingers for its exit animation and
	// would swallow the pointer-down; wait it out before pressing.
	await expect(page.locator(".modal__backdrop")).toHaveCount(0);

	const source = page.getByRole("option", { name: optionText });
	const s = await source.boundingBox();
	if (!s) throw new Error("drag source missing");
	const sx = s.x + s.width / 2;
	const sy = s.y + s.height / 2;

	await page.mouse.move(sx, sy);
	await page.mouse.down();
	await page.mouse.move(sx + 12, sy + 12, { steps: 3 });

	const target = page.getByTestId(targetTestId);
	await target.waitFor();
	const t = await target.boundingBox();
	if (!t) throw new Error("drag target missing");
	const tx = t.x + t.width / 2;
	const ty = t.y + t.height / 2;
	await page.mouse.move(tx, ty, { steps: 10 });
	// A distinct final move so dnd-kit registers the over-target before drop
	await page.mouse.move(tx + 1, ty + 1);
	await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
	await installMocks(page);
	await page.goto("/skills");
	await expect(
		page.getByRole("option", { name: "solo-skill" }),
	).toBeVisible();
});

test("renders source group as a section and ungrouped items", async ({
	page,
}) => {
	await expect(
		page.getByRole("button", {
			name: "Select all in github/AkaraChen/web-dev",
		}),
	).toBeVisible();
	await expect(page.getByRole("option", { name: "react-pro" })).toBeVisible();
	await expect(
		page.getByRole("option", { name: "solo-skill" }),
	).toBeVisible();
});

test("multi-select via modifier click opens the bulk actions panel", async ({
	page,
}) => {
	await page.getByRole("option", { name: "solo-skill" }).click();
	await page
		.getByRole("option", { name: "react-pro" })
		.click({ modifiers: ["ControlOrMeta"] });

	await expect(page.getByText("2 items selected")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Add to Agent" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Copy", exact: true }),
	).toBeVisible();
	// No groups yet, so the panel offers "New group" instead of the
	// "Move to group" picker
	await expect(page.getByRole("button", { name: "New group" })).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Delete", exact: true }),
	).toBeVisible();
});

test("the chevron toggles expansion without selecting the group", async ({
	page,
}) => {
	await expect(
		page.getByRole("option", { name: "css-wizard" }),
	).toBeVisible();

	// The chevron's accessible name is the bare group title, distinct
	// from the row's "Select all in …" label
	await page
		.getByRole("button", {
			name: "github/AkaraChen/web-dev",
			exact: true,
		})
		.click();

	// Members collapse, and no selection was made
	await expect(page.getByRole("option", { name: "css-wizard" })).toBeHidden();
	await expect(page.getByText("2 items selected")).toBeHidden();
});

test("deselecting a multi-selection down to one item shows that item's detail", async ({
	page,
}) => {
	await page.getByRole("option", { name: "solo-skill" }).click();
	await page
		.getByRole("option", { name: "react-pro" })
		.click({ modifiers: ["ControlOrMeta"] });
	await expect(page.getByText("2 items selected")).toBeVisible();

	// Drop solo-skill from the selection, leaving only react-pro
	await page
		.getByRole("option", { name: "solo-skill" })
		.click({ modifiers: ["ControlOrMeta"] });

	// The detail follows the remaining single selection instead of
	// lingering on the previously active item
	await expect(
		page.getByRole("heading", { name: "react-pro" }),
	).toBeVisible();
});

test("clicking the selected item again cancels the selection", async ({
	page,
}) => {
	// solo-skill is not the auto-selected first item, so the first click
	// selects it and shows its detail
	await page.getByRole("option", { name: "solo-skill" }).click();
	await expect(
		page.getByRole("heading", { name: "solo-skill" }),
	).toBeVisible();

	// Clicking it again toggles the selection off and the detail falls back
	// to the empty placeholder rather than the first skill
	await page.getByRole("option", { name: "solo-skill" }).click();
	await expect(
		page.getByText("Select a skill to view details"),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "solo-skill" }),
	).toBeHidden();
});

test("the first item is selected and shown on load", async ({ page }) => {
	// Selection is the single source of truth, seeded with the first item so
	// a detail shows on load (rather than an empty placeholder)
	await expect(
		page.getByRole("option", { name: "react-pro", selected: true }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "react-pro" }),
	).toBeVisible();
});

test("exiting multi-select keeps the current detail", async ({ page }) => {
	await page.getByRole("option", { name: "solo-skill" }).click();
	await expect(
		page.getByRole("heading", { name: "solo-skill" }),
	).toBeVisible();

	// Toggling multi-select mode on then off clears the selection set but
	// must not wipe the detail — the user never cancelled the item
	await page
		.getByRole("button", { name: "Multi-select mode" })
		.first()
		.click();
	await page
		.getByRole("button", { name: "Cancel", exact: true })
		.first()
		.click();

	await expect(
		page.getByRole("heading", { name: "solo-skill" }),
	).toBeVisible();
	await expect(page.getByText("Select a skill to view details")).toBeHidden();
});

test("the header stays selected while all its members are selected", async ({
	page,
}) => {
	const header = (pressed: boolean) =>
		page.getByRole("button", {
			name: "Select all in github/AkaraChen/web-dev",
			pressed,
		});

	// Selecting the whole group marks the header selected
	await header(false).click();
	await expect(header(true)).toBeVisible();

	// Adding an unrelated item keeps the header selected — every member
	// is still in the selection
	await page
		.getByRole("option", { name: "solo-skill" })
		.click({ modifiers: ["ControlOrMeta"] });
	await expect(header(true)).toBeVisible();

	// Deselecting a member clears the header
	await page
		.getByRole("option", { name: "react-pro" })
		.click({ modifiers: ["ControlOrMeta"] });
	await expect(header(false)).toBeVisible();
});

test("source group header click selects the whole library", async ({
	page,
}) => {
	await page
		.getByRole("button", { name: "Select all in github/AkaraChen/web-dev" })
		.click();

	// Library context header plus the bulk roster
	await expect(
		page.getByRole("heading", { name: "github/AkaraChen/web-dev" }),
	).toBeVisible();
	await expect(page.getByText("2 items selected")).toBeVisible();
});

test("clicking a selected source group header again cancels it", async ({
	page,
}) => {
	const header = (pressed: boolean) =>
		page.getByRole("button", {
			name: "Select all in github/AkaraChen/web-dev",
			pressed,
		});

	await header(false).click();
	await expect(page.getByText("2 items selected")).toBeVisible();

	// Clicking the header again cancels the whole group -> empty placeholder
	await header(true).click();
	await expect(page.getByText("2 items selected")).toBeHidden();
	await expect(header(false)).toBeVisible();
	await expect(
		page.getByText("Select a skill to view details"),
	).toBeVisible();
});

test("clicking a selected single-member group header again cancels it", async ({
	page,
}) => {
	// Create a custom group and drag solo-skill into it (a single member,
	// so selecting it stays out of multi-select mode and hits the plain
	// header-click path)
	await page.getByRole("button", { name: "Add skill" }).click();
	await page.getByRole("menuitem", { name: "New group" }).click();
	const dialog = page.getByRole("dialog", { name: "New group" });
	await dialog.getByRole("textbox").fill("Solo");
	await dialog.getByRole("button", { name: "Save" }).click();
	const section = page.getByTestId("group-section-Solo");
	await expect(section).toBeVisible();
	await dragOptionTo(page, "solo-skill", "group-section-Solo");
	await expect(
		section.getByRole("option", { name: "solo-skill" }),
	).toBeVisible();

	// Selecting the group via its header shows the sole member's detail
	await page.getByRole("button", { name: "Select all in Solo" }).click();
	await expect(
		page.getByRole("heading", { name: "solo-skill" }),
	).toBeVisible();

	// Clicking the header again cancels it -> empty placeholder
	await page.getByRole("button", { name: "Select all in Solo" }).click();
	await expect(
		page.getByText("Select a skill to view details"),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "solo-skill" }),
	).toBeHidden();
});

test("right click opens the context menu with the full action set", async ({
	page,
}) => {
	await page
		.getByRole("option", { name: "solo-skill" })
		.click({ button: "right" });

	const menu = page.getByRole("menu", { name: "Resource actions" });
	await expect(menu).toBeVisible();
	await expect(
		menu.getByRole("menuitem", { name: "Favorite" }),
	).toBeVisible();
	await expect(
		menu.getByRole("menuitem", { name: "Add to Agent" }),
	).toBeVisible();
	await expect(menu.getByRole("menuitem", { name: "Copy" })).toBeVisible();
	await expect(
		menu.getByRole("menuitem", { name: "New group" }),
	).toBeVisible();
	await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeVisible();

	// With no groups yet, the "Move to group" section is not shown —
	// only the top-level "New group" entry
	await expect(menu.getByText("Move to group")).toBeHidden();
});

test("the context menu closes after choosing an action", async ({ page }) => {
	await page
		.getByRole("option", { name: "solo-skill" })
		.click({ button: "right" });
	const menu = page.getByRole("menu", { name: "Resource actions" });
	await expect(menu).toBeVisible();

	// Choosing any item runs its action and closes the menu
	await menu.getByRole("menuitem", { name: "Favorite" }).click();
	await expect(menu).toBeHidden();
});

test("remove from group is disabled for an ungrouped selection", async ({
	page,
}) => {
	// A group must exist for the move-to-group section (which holds the
	// remove entry) to show
	await page.getByRole("button", { name: "Add skill" }).click();
	await page.getByRole("menuitem", { name: "New group" }).click();
	const dialog = page.getByRole("dialog", { name: "New group" });
	await dialog.getByRole("textbox").fill("My Group");
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(
		page.getByRole("button", { name: "Select all in My Group" }),
	).toBeVisible();

	// solo-skill is ungrouped, so "Remove from group" shows but is disabled
	// (present-but-disabled keeps the menu structure stable)
	await page
		.getByRole("option", { name: "solo-skill" })
		.click({ button: "right" });
	const item = page
		.getByRole("menu", { name: "Resource actions" })
		.getByRole("menuitem", { name: "Remove from group" });
	await expect(item).toBeVisible();
	await expect(item).toHaveAttribute("aria-disabled", "true");
});

test("reduced motion collapses transitions to instant", async ({ page }) => {
	// Playwright forces prefers-reduced-motion: reduce and the app honors
	// it, so animation never participates in assertions
	const duration = await page
		.getByRole("option", { name: "react-pro" })
		.evaluate((el) => getComputedStyle(el).transitionDuration);
	expect(Number.parseFloat(duration)).toBeLessThan(1);
});

test("right-clicking within a multi-selection keeps the whole selection", async ({
	page,
}) => {
	await page.getByRole("option", { name: "css-wizard" }).click();
	await page
		.getByRole("option", { name: "solo-skill" })
		.click({ modifiers: ["ControlOrMeta"] });
	await expect(page.getByText("2 items selected")).toBeVisible();

	// Right-clicking one of the selected items keeps the selection so
	// the menu acts on all of them
	await page
		.getByRole("option", { name: "css-wizard" })
		.click({ button: "right" });
	await expect(
		page.getByRole("menu", { name: "Resource actions" }),
	).toBeVisible();
	await expect(page.getByText("2 items selected")).toBeVisible();
});

test("the move-to-group section appears once a group exists", async ({
	page,
}) => {
	await page.getByRole("button", { name: "Add skill" }).click();
	await page.getByRole("menuitem", { name: "New group" }).click();
	const dialog = page.getByRole("dialog", { name: "New group" });
	await dialog.getByRole("textbox").fill("My Group");
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(
		page.getByRole("button", { name: "Select all in My Group" }),
	).toBeVisible();

	await page
		.getByRole("option", { name: "solo-skill" })
		.click({ button: "right" });
	const menu = page.getByRole("menu", { name: "Resource actions" });
	await expect(menu.getByText("Move to group")).toBeVisible();
	await expect(
		menu.getByRole("menuitem", { name: "My Group" }),
	).toBeVisible();
});

test("toolbar creates a group and context menu moves a skill into it", async ({
	page,
}) => {
	// Create an empty group from the page toolbar add menu
	await page.getByRole("button", { name: "Add skill" }).click();
	await page.getByRole("menuitem", { name: "New group" }).click();
	const dialog = page.getByRole("dialog", { name: "New group" });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("textbox").fill("My Group");
	await dialog.getByRole("button", { name: "Save" }).click();

	await expect(
		page.getByRole("button", { name: "Select all in My Group" }),
	).toBeVisible();

	// Move solo-skill into it via the context menu
	await page
		.getByRole("option", { name: "solo-skill" })
		.click({ button: "right" });
	await page
		.getByRole("menu", { name: "Resource actions" })
		.getByRole("menuitem", { name: "My Group" })
		.click();

	// The group section now contains the skill; ungrouped label shows
	const section = page.getByTestId("group-section-My Group");
	await expect(
		section.getByRole("option", { name: "solo-skill" }),
	).toBeVisible();
	await expect(section.getByText("1", { exact: true })).toBeVisible();
});

test("dragging a skill onto a group section assigns it", async ({ page }) => {
	// Create the target group first
	await page.getByRole("button", { name: "Add skill" }).click();
	await page.getByRole("menuitem", { name: "New group" }).click();
	const dialog = page.getByRole("dialog", { name: "New group" });
	await dialog.getByRole("textbox").fill("Drag Target");
	await dialog.getByRole("button", { name: "Save" }).click();
	const section = page.getByTestId("group-section-Drag Target");
	await expect(section).toBeVisible();

	await dragOptionTo(page, "solo-skill", "group-section-Drag Target");

	await expect(
		section.getByRole("option", { name: "solo-skill" }),
	).toBeVisible();
});

test("dragging onto the drop-to-create zone creates a group with the item", async ({
	page,
}) => {
	await dragOptionTo(page, "solo-skill", "new-group-dropzone");

	const dialog = page.getByRole("dialog", { name: "New group" });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("textbox").fill("Dropped Group");
	await dialog.getByRole("button", { name: "Save" }).click();

	const section = page.getByTestId("group-section-Dropped Group");
	await expect(
		section.getByRole("option", { name: "solo-skill" }),
	).toBeVisible();
});

test("dragging a selected item carries the whole selection", async ({
	page,
}) => {
	await page.getByRole("button", { name: "Add skill" }).click();
	await page.getByRole("menuitem", { name: "New group" }).click();
	const dialog = page.getByRole("dialog", { name: "New group" });
	await dialog.getByRole("textbox").fill("Multi");
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(page.locator(".modal__backdrop")).toHaveCount(0);

	// Select two items, then drag one — the drag carries both
	await page.getByRole("option", { name: "css-wizard" }).click();
	await page
		.getByRole("option", { name: "solo-skill" })
		.click({ modifiers: ["ControlOrMeta"] });
	await expect(page.getByText("2 items selected")).toBeVisible();

	await dragOptionTo(page, "css-wizard", "group-section-Multi");

	const section = page.getByTestId("group-section-Multi");
	await expect(
		section.getByRole("option", { name: "css-wizard" }),
	).toBeVisible();
	await expect(
		section.getByRole("option", { name: "solo-skill" }),
	).toBeVisible();
});

test("the drop board replaces the detail while dragging and assigns on drop", async ({
	page,
}) => {
	await page.getByRole("button", { name: "Add skill" }).click();
	await page.getByRole("menuitem", { name: "New group" }).click();
	const dialog = page.getByRole("dialog", { name: "New group" });
	await dialog.getByRole("textbox").fill("Board Target");
	await dialog.getByRole("button", { name: "Save" }).click();

	// Dropping onto the board's group card assigns the item; the board card
	// only exists while a drag is underway, so dragOptionTo resolves it then
	await dragOptionTo(page, "solo-skill", "board-card-Board Target");

	const section = page.getByTestId("group-section-Board Target");
	await expect(
		section.getByRole("option", { name: "solo-skill" }),
	).toBeVisible();
});
