import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

async function readRenderedTextMetrics(locator: Locator) {
	return locator.evaluate((element) => {
		const range = document.createRange();
		range.selectNodeContents(element);
		const text = range.getBoundingClientRect();
		const box = element.getBoundingClientRect();
		return {
			boxLeft: box.left,
			textLeft: text.left,
			textAlign: getComputedStyle(element).textAlign,
		};
	});
}

async function readResourceRowGeometry(row: Locator, label: string) {
	const icon = await row.locator("svg").first().boundingBox();
	if (!icon) throw new Error(`${label} icon geometry missing`);
	const text = await readRenderedTextMetrics(
		row.getByText(label, { exact: true }),
	);
	return {
		iconLeft: icon.x,
		textLeft: text.textLeft,
		textBoxLeft: text.boxLeft,
		textAlign: text.textAlign,
		gap: text.textLeft - (icon.x + icon.width),
	};
}

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

test("renders source clusters as rows and ungrouped items", async ({
	page,
}) => {
	// The cluster row is named by its source; there is no click-to-select-all
	// affordance on it (that moved to right-click and meta-click)
	await expect(
		page.getByRole("button", {
			name: "github/AkaraChen/web-dev",
			exact: true,
		}),
	).toBeVisible();
	await expect(
		page.getByRole("button", {
			name: "Select all in github/AkaraChen/web-dev",
		}),
	).toHaveCount(0);
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
	await expect(page.getByText("Agent coverage")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Copy", exact: true }),
	).toBeVisible();
	// No groups yet, so the panel offers "New group" instead of the
	// "Move to group" picker
	await expect(page.getByRole("button", { name: "New group" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Delete 2" })).toBeVisible();
});

test("the bulk roster removes one item from the selection", async ({
	page,
}) => {
	await page.getByRole("option", { name: "css-wizard" }).click();
	await page
		.getByRole("option", { name: "solo-skill" })
		.click({ modifiers: ["ControlOrMeta"] });
	await expect(page.getByText("2 items selected")).toBeVisible();

	// Removing a roster tag drops it from the selection; down to one item
	// the panel returns to the detail view
	await page
		.getByRole("button", { name: "Remove css-wizard from selection" })
		.click();
	await expect(page.getByText("2 items selected")).toBeHidden();
	// css-wizard was the first roster tag; solo-skill remains and shows
	await expect(
		page.getByRole("heading", { name: "solo-skill" }),
	).toBeVisible();
});

test("only the chevron toggles a cluster's expansion; the row never does", async ({
	page,
}) => {
	await expect(
		page.getByRole("option", { name: "css-wizard" }),
	).toBeVisible();

	// The row body is a navigation surface (library page), not a toggle:
	// clicking it must leave the members visible and select nothing
	await page
		.getByRole("button", {
			name: "github/AkaraChen/web-dev",
			exact: true,
		})
		.click();
	await expect(
		page.getByRole("option", { name: "css-wizard" }),
	).toBeVisible();
	await expect(page.getByText("2 items selected")).toBeHidden();

	// The trailing chevron alone collapses the cluster — and expands it back
	const chevron = page.getByRole("button", {
		name: "Expand or collapse github/AkaraChen/web-dev",
	});
	await chevron.click();
	await expect(page.getByRole("option", { name: "css-wizard" })).toBeHidden();
	await chevron.click();
	await expect(
		page.getByRole("option", { name: "css-wizard" }),
	).toBeVisible();
});

test("source cluster actions share one row hover surface", async ({ page }) => {
	const section = page.getByTestId("group-section-github/AkaraChen/web-dev");
	const header = section.locator('[data-slot="group-header"]');
	const row = section.getByRole("button", {
		name: "github/AkaraChen/web-dev",
		exact: true,
	});
	const chevron = section.getByRole("button", {
		name: "Expand or collapse github/AkaraChen/web-dev",
	});

	await expect(row.locator("button")).toHaveCount(0);
	const restingBackground = await header.evaluate(
		(element) => getComputedStyle(element).backgroundColor,
	);
	await chevron.hover();
	await expect
		.poll(() =>
			header.evaluate(
				(element) => getComputedStyle(element).backgroundColor,
			),
		)
		.not.toBe(restingBackground);
	expect(
		await chevron.evaluate(
			(element) => getComputedStyle(element).backgroundColor,
		),
	).toBe("rgba(0, 0, 0, 0)");
	await row.hover();
	await expect
		.poll(() =>
			header.evaluate(
				(element) => getComputedStyle(element).backgroundColor,
			),
		)
		.not.toBe(restingBackground);
	expect(
		await row.evaluate(
			(element) => getComputedStyle(element).backgroundColor,
		),
	).toBe("rgba(0, 0, 0, 0)");
	const rowBox = await row.boundingBox();
	if (!rowBox) throw new Error("source cluster row missing");
	await page.mouse.move(
		rowBox.x + rowBox.width / 2,
		rowBox.y + rowBox.height / 2,
	);
	await page.mouse.down();
	await expect
		.poll(() =>
			row.evaluate((element) => getComputedStyle(element).transform),
		)
		.toBe("none");
	await page.mouse.move(rowBox.x, rowBox.y + rowBox.height + 4);
	await page.mouse.up();
});

test("custom group header stays left aligned without hover feedback", async ({
	page,
}) => {
	await page.getByRole("button", { name: "Add skill" }).click();
	await page.getByRole("menuitem", { name: "New group" }).click();
	const dialog = page.getByRole("dialog", { name: "New group" });
	await dialog.getByRole("textbox").fill("Frontend");
	await dialog.getByRole("button", { name: "Save" }).click();

	const section = page.getByTestId("group-section-Frontend");
	const row = section.getByRole("button", {
		name: "Select all in Frontend",
	});
	const toggle = section.getByRole("button", {
		name: "Expand or collapse Frontend",
	});
	const label = row.getByText("Frontend", { exact: true });
	const labelMetrics = await readRenderedTextMetrics(label);

	expect(["left", "start"]).toContain(labelMetrics.textAlign);
	expect(labelMetrics.textLeft).toBeCloseTo(labelMetrics.boxLeft, 1);
	await expect(row.locator("button")).toHaveCount(0);
	await expect(section.getByRole("button")).toHaveCount(2);

	const header = section.locator('[data-slot="group-header"]');
	const restingBackground = await header.evaluate(
		(element) => getComputedStyle(element).backgroundColor,
	);
	await toggle.hover();
	await page.waitForTimeout(200);
	expect(
		await header.evaluate(
			(element) => getComputedStyle(element).backgroundColor,
		),
	).toBe(restingBackground);
	expect(
		await toggle.evaluate(
			(element) => getComputedStyle(element).backgroundColor,
		),
	).toBe("rgba(0, 0, 0, 0)");
	await row.hover();
	await page.waitForTimeout(200);
	expect(
		await header.evaluate(
			(element) => getComputedStyle(element).backgroundColor,
		),
	).toBe(restingBackground);
	expect(
		await row.evaluate(
			(element) => getComputedStyle(element).backgroundColor,
		),
	).toBe("rgba(0, 0, 0, 0)");
});

test("source clusters and their members align with peer skills", async ({
	page,
}) => {
	const sourceRow = page.getByRole("button", {
		name: "github/AkaraChen/web-dev",
		exact: true,
	});
	const skillRow = page.getByRole("option", { name: "solo-skill" });
	const memberRow = page.getByRole("option", { name: "react-pro" });
	const [source, skill, member] = await Promise.all([
		readResourceRowGeometry(sourceRow, "github/AkaraChen/web-dev"),
		readResourceRowGeometry(skillRow, "solo-skill"),
		readResourceRowGeometry(memberRow, "react-pro"),
	]);

	expect(source.iconLeft).toBeCloseTo(skill.iconLeft, 1);
	expect(member.iconLeft).toBeCloseTo(source.iconLeft, 1);
	expect(["left", "start"]).toContain(source.textAlign);
	expect(["left", "start"]).toContain(skill.textAlign);
	expect(["left", "start"]).toContain(member.textAlign);
	expect(source.textLeft).toBeCloseTo(source.textBoxLeft, 1);
	expect(source.textLeft).toBeCloseTo(skill.textLeft, 1);
	expect(member.textLeft).toBeCloseTo(source.textLeft, 1);
	expect(source.gap).toBeCloseTo(skill.gap, 1);
	expect(member.gap).toBeCloseTo(skill.gap, 1);
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

test("the cluster row stays pressed while all its members are selected", async ({
	page,
}) => {
	const header = (pressed: boolean) =>
		page.getByRole("button", {
			name: "github/AkaraChen/web-dev",
			exact: true,
			pressed,
		});

	// Right-clicking the cluster selects every member (and opens the menu)
	await header(false).click({ button: "right" });
	await page.keyboard.press("Escape");
	await expect(header(true)).toBeVisible();

	// Adding an unrelated item keeps the row pressed — every member is
	// still in the selection
	await page
		.getByRole("option", { name: "solo-skill" })
		.click({ modifiers: ["ControlOrMeta"] });
	await expect(header(true)).toBeVisible();

	// Deselecting a member clears it
	await page
		.getByRole("option", { name: "react-pro" })
		.click({ modifiers: ["ControlOrMeta"] });
	await expect(header(false)).toBeVisible();
});

test("right-clicking a source cluster selects the whole library", async ({
	page,
}) => {
	await page
		.getByRole("button", { name: "github/AkaraChen/web-dev", exact: true })
		.click({ button: "right" });
	await page.keyboard.press("Escape");

	// The count is the headline; both members land in the roster
	await expect(
		page.getByRole("heading", { name: "2 items selected" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Remove react-pro from selection" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Remove css-wizard from selection" }),
	).toBeVisible();
});

test("meta-clicking a cluster row toggles the whole library in and out", async ({
	page,
}) => {
	const header = page.getByRole("button", {
		name: "github/AkaraChen/web-dev",
		exact: true,
	});

	// Meta-click pulls every member into the selection (react-pro was the
	// seed, css-wizard joins it)
	await header.click({ modifiers: ["ControlOrMeta"] });
	await expect(page.getByText("2 items selected")).toBeVisible();

	// Meta-click again removes the whole cluster -> empty placeholder
	await header.click({ modifiers: ["ControlOrMeta"] });
	await expect(page.getByText("2 items selected")).toBeHidden();
	await expect(
		page.getByText("Select a skill to view details"),
	).toBeVisible();
});

test("a drag dims the source clusters that cannot take the drop", async ({
	page,
}) => {
	const source = page.getByRole("option", { name: "solo-skill" });
	const s = await source.boundingBox();
	if (!s) throw new Error("no source");
	await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
	await page.mouse.down();
	await page.mouse.move(s.x + 20, s.y + 20, { steps: 3 });

	await expect(
		page.getByRole("button", {
			name: "github/AkaraChen/alpha-pack",
			exact: true,
		}),
	).toHaveCSS("opacity", "0.5");

	await page.keyboard.press("Escape");
	await page.mouse.up();
});

test("the roster labels custom-group members with the group name", async ({
	page,
}) => {
	// A custom group with two members: one from a source library
	// (css-wizard, github/AkaraChen/web-dev) and one loose (solo-skill).
	// The bulk roster must file both under the group's card — the custom
	// group outranks the source library, and neither member is "Ungrouped".
	await page.getByRole("button", { name: "Add skill" }).click();
	await page.getByRole("menuitem", { name: "New group" }).click();
	const dialog = page.getByRole("dialog", { name: "New group" });
	await dialog.getByRole("textbox").fill("Mine");
	await dialog.getByRole("button", { name: "Save" }).click();
	await dragOptionTo(page, "solo-skill", "group-section-Mine");
	await dragOptionTo(page, "css-wizard", "group-section-Mine");

	await page.getByRole("button", { name: "Select all in Mine" }).click();
	await expect(page.getByText("2 items selected")).toBeVisible();

	// One roster section titled by the group; no Ungrouped section, and
	// the source library never appears even though css-wizard belongs to
	// one
	const rosterSection = page.locator("section").filter({
		has: page.getByRole("button", {
			name: "Remove css-wizard from selection",
		}),
	});
	await expect(rosterSection).toContainText("Mine");
	await expect(rosterSection).toContainText("solo-skill");
	await expect(page.getByText("Ungrouped", { exact: true })).toBeHidden();
	await expect(page.getByText("web-dev")).toBeHidden();
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

	// The drag can leave the moved item selected; normalize to an empty
	// selection so the header-click genuinely selects (then re-clicking
	// cancels) rather than starting already-selected
	await page.keyboard.press("Escape");
	await expect(
		page.getByText("Select a skill to view details"),
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

test("moving a source cluster into a custom group preserves the cluster", async ({
	page,
}) => {
	await page.getByRole("button", { name: "Add skill" }).click();
	await page.getByRole("menuitem", { name: "New group" }).click();
	const dialog = page.getByRole("dialog", { name: "New group" });
	await dialog.getByRole("textbox").fill("Design");
	await dialog.getByRole("button", { name: "Save" }).click();

	await page
		.getByRole("button", {
			name: "github/AkaraChen/web-dev",
			exact: true,
		})
		.click({ button: "right" });
	await page
		.getByRole("menu", { name: "Resource actions" })
		.getByRole("menuitem", { name: "Design" })
		.click();

	const customGroup = page.getByTestId("group-section-Design");
	const sourceCluster = customGroup.getByTestId(
		"group-section-github/AkaraChen/web-dev",
	);
	const sourceRow = sourceCluster.getByRole("button", {
		name: "github/AkaraChen/web-dev",
		exact: true,
	});
	await expect(sourceRow).toBeVisible();
	const customHeader = customGroup
		.locator('[data-slot="group-header"]')
		.first();
	const sourceHeader = sourceCluster
		.locator('[data-slot="group-header"]')
		.first();
	const [customHeaderBox, sourceHeaderBox] = await Promise.all([
		customHeader.boundingBox(),
		sourceHeader.boundingBox(),
	]);
	if (!customHeaderBox || !sourceHeaderBox) {
		throw new Error("nested source cluster header geometry missing");
	}
	expect(
		sourceHeaderBox.y - (customHeaderBox.y + customHeaderBox.height),
	).toBe(8);
	await sourceCluster
		.getByRole("button", {
			name: "Expand or collapse github/AkaraChen/web-dev",
		})
		.click();
	await expect(
		sourceCluster.getByRole("option", { name: "react-pro" }),
	).toBeVisible();
	await expect(
		sourceCluster.getByRole("option", { name: "css-wizard" }),
	).toBeVisible();

	await page
		.getByRole("option", { name: "solo-skill" })
		.click({ button: "right" });
	await page
		.getByRole("menu", { name: "Resource actions" })
		.getByRole("menuitem", { name: "Design" })
		.click();

	const skillRow = customGroup.getByRole("option", { name: "solo-skill" });
	const memberRow = sourceCluster.getByRole("option", {
		name: "react-pro",
	});
	const sourceMemberRows = sourceCluster.getByRole("option");
	const firstMemberRow = sourceMemberRows.nth(0);
	const secondMemberRow = sourceMemberRows.nth(1);
	const [source, skill, member] = await Promise.all([
		readResourceRowGeometry(sourceRow, "github/AkaraChen/web-dev"),
		readResourceRowGeometry(skillRow, "solo-skill"),
		readResourceRowGeometry(memberRow, "react-pro"),
	]);

	expect(source.iconLeft).toBeCloseTo(skill.iconLeft, 1);
	expect(member.iconLeft).toBeCloseTo(source.iconLeft, 1);
	expect(source.textLeft).toBeCloseTo(skill.textLeft, 1);
	expect(member.textLeft).toBeCloseTo(source.textLeft, 1);
	expect(source.gap).toBeCloseTo(skill.gap, 1);
	expect(member.gap).toBeCloseTo(skill.gap, 1);

	const [currentSourceHeaderBox, memberBox, secondMemberBox] =
		await Promise.all([
			sourceHeader.boundingBox(),
			firstMemberRow.boundingBox(),
			secondMemberRow.boundingBox(),
		]);
	if (!currentSourceHeaderBox || !memberBox || !secondMemberBox) {
		throw new Error("nested source cluster geometry missing");
	}
	expect(
		memberBox.y -
			(currentSourceHeaderBox.y + currentSourceHeaderBox.height),
	).toBe(8);
	expect(secondMemberBox.y - (memberBox.y + memberBox.height)).toBe(4);
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

test("cmd+a selects all, escape clears", async ({ page }) => {
	// Hover the list so the shortcuts are in scope
	await page.getByRole("option", { name: "solo-skill" }).hover();

	await page.keyboard.press("ControlOrMeta+a");
	await expect(page.getByText("5 items selected")).toBeVisible();

	await page.keyboard.press("Escape");
	await expect(page.getByText("5 items selected")).toBeHidden();
	await expect(
		page.getByText("Select a skill to view details"),
	).toBeVisible();
});

test("delete opens the delete confirmation for the selection", async ({
	page,
}) => {
	await page.getByRole("option", { name: "solo-skill" }).click();
	await page.getByRole("option", { name: "solo-skill" }).hover();
	await page.keyboard.press("Delete");
	await expect(page.getByRole("dialog")).toBeVisible();
});

test("list shortcuts are ignored while the search field is focused", async ({
	page,
}) => {
	await page.getByRole("option", { name: "css-wizard" }).click();
	await page.getByRole("searchbox", { name: "Search skills" }).focus();
	await page.keyboard.press("Delete");
	// The keypress belongs to the field, not the list — no delete dialog
	await expect(page.getByRole("dialog")).toBeHidden();
});

test("the agent matrix shows coverage and installs the missing", async ({
	page,
}) => {
	// Two skills, both installed on claude only
	await page.getByRole("option", { name: "css-wizard" }).click();
	await page
		.getByRole("option", { name: "solo-skill" })
		.click({ modifiers: ["ControlOrMeta"] });
	await expect(page.getByText("2 items selected")).toBeVisible();

	await expect(page.getByTestId("matrix-row-claude")).toContainText("2/2");
	await expect(page.getByTestId("matrix-row-cursor")).toContainText("0/2");

	// Coverage is a summary; use the explicit tri-state manager to edit it.
	await page.getByTestId("matrix-row-cursor").click();
	const manageDialog = page.getByRole("dialog", {
		name: "Manage Agents",
	});
	await manageDialog.locator("label").filter({ hasText: "Cursor" }).click();
	await manageDialog.getByRole("button", { name: "Apply changes" }).click();
	await expect(page.getByTestId("matrix-row-cursor")).toContainText("2/2");
});

test("bulk and source details use the same agent coverage rows", async ({
	page,
}) => {
	await page
		.getByRole("button", { name: "github/AkaraChen/web-dev", exact: true })
		.click();
	const sourceRow = page.getByTestId("matrix-row-claude");
	const sourceRowClass = await sourceRow.getAttribute("class");
	await expect(
		page.getByText("Click to install where missing; a full row uninstalls"),
	).toBeVisible();

	await page.getByRole("option", { name: "css-wizard" }).click();
	await page
		.getByRole("option", { name: "solo-skill" })
		.click({ modifiers: ["ControlOrMeta"] });
	const bulkRow = page.getByTestId("matrix-row-claude");
	await expect(bulkRow).toHaveAttribute("class", sourceRowClass ?? "");
	await expect(
		page.getByText(
			"Coverage across the selected items. Click an agent to manage it.",
		),
	).toBeVisible();
});

test("a fully covered matrix row asks before uninstalling", async ({
	page,
}) => {
	await page.getByRole("option", { name: "css-wizard" }).click();
	await page
		.getByRole("option", { name: "solo-skill" })
		.click({ modifiers: ["ControlOrMeta"] });

	await page.getByTestId("matrix-row-claude").click();
	const dialog = page.getByRole("dialog", { name: "Manage Agents" });
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText("Claude");

	// Cancelling leaves coverage untouched
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByTestId("matrix-row-claude")).toContainText("2/2");
});

test("hovering a collapsed group while dragging springs it open", async ({
	page,
}) => {
	// A custom group with one member (only custom groups accept drops, so
	// only they spring open)
	await page.getByRole("button", { name: "Add skill" }).click();
	await page.getByRole("menuitem", { name: "New group" }).click();
	const dialog = page.getByRole("dialog", { name: "New group" });
	await dialog.getByRole("textbox").fill("Spring");
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(page.locator(".modal__backdrop")).toHaveCount(0);
	await dragOptionTo(page, "solo-skill", "group-section-Spring");
	await expect(
		page
			.getByTestId("group-section-Spring")
			.getByRole("option", { name: "solo-skill" }),
	).toBeVisible();

	// Collapse it, then hold another drag over its header
	await page
		.getByRole("button", { name: "Expand or collapse Spring" })
		.click();
	await expect(page.getByRole("option", { name: "solo-skill" })).toBeHidden();
	// Human pacing between the click and the next press — a synthetic
	// press within ~50ms of the previous click can lose the sensor
	// activation, which no real pointer sequence reproduces.
	await page.waitForTimeout(300);

	const source = page.getByRole("option", { name: "css-wizard" });
	const s = await source.boundingBox();
	if (!s) throw new Error("no source");
	await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
	await page.mouse.down();
	await page.mouse.move(s.x + 20, s.y + 20, { steps: 3 });

	const header = page.getByRole("button", {
		name: "Select all in Spring",
	});
	const h = await header.boundingBox();
	if (!h) throw new Error("no header");
	await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2, { steps: 5 });
	await page.mouse.move(h.x + h.width / 2 + 1, h.y + h.height / 2 + 1);

	// Spring-loading pops the group open after ~600ms of hovering
	await expect(
		page.getByRole("option", { name: "solo-skill" }),
	).toBeVisible();

	await page.keyboard.press("Escape");
	await page.mouse.up();
});

test("dropping below a spring-opened group still hits the right target", async ({
	page,
}) => {
	// Two stacked custom groups: hovering the first mid-drag pops it open,
	// which pushes the second one down. The drop must land where the
	// second group now is, not where its rect was cached at drag start.
	await page.getByRole("button", { name: "Add skill" }).click();
	await page.getByRole("menuitem", { name: "New group" }).click();
	let dialog = page.getByRole("dialog", { name: "New group" });
	await dialog.getByRole("textbox").fill("Upper");
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(page.locator(".modal__backdrop")).toHaveCount(0);
	await page.getByRole("button", { name: "Add skill" }).click();
	await page.getByRole("menuitem", { name: "New group" }).click();
	dialog = page.getByRole("dialog", { name: "New group" });
	await dialog.getByRole("textbox").fill("Lower");
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(page.locator(".modal__backdrop")).toHaveCount(0);

	await dragOptionTo(page, "solo-skill", "group-section-Upper");
	await expect(
		page
			.getByTestId("group-section-Upper")
			.getByRole("option", { name: "solo-skill" }),
	).toBeVisible();

	// Collapse Upper so the spring-load has something to pop open
	await page
		.getByRole("button", { name: "Expand or collapse Upper" })
		.click();
	await expect(page.getByRole("option", { name: "solo-skill" })).toBeHidden();
	await page.waitForTimeout(300);

	const source = page.getByRole("option", { name: "css-wizard" });
	const s = await source.boundingBox();
	if (!s) throw new Error("no source");
	await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
	await page.mouse.down();
	await page.mouse.move(s.x + 20, s.y + 20, { steps: 3 });

	// Hover Upper's header until it springs open
	const upper = page.getByRole("button", { name: "Select all in Upper" });
	const u = await upper.boundingBox();
	if (!u) throw new Error("no Upper header");
	await page.mouse.move(u.x + u.width / 2, u.y + u.height / 2, { steps: 5 });
	await page.mouse.move(u.x + u.width / 2 + 1, u.y + u.height / 2 + 1);
	await expect(
		page.getByRole("option", { name: "solo-skill" }),
	).toBeVisible();

	// Lower has been pushed down; aim at its CURRENT header position
	const lower = page.getByRole("button", { name: "Select all in Lower" });
	const l = await lower.boundingBox();
	if (!l) throw new Error("no Lower header");
	await page.mouse.move(l.x + l.width / 2, l.y + l.height / 2, { steps: 10 });
	await page.mouse.move(l.x + l.width / 2 + 1, l.y + l.height / 2 + 1);
	await page.mouse.up();

	await expect(
		page
			.getByTestId("group-section-Lower")
			.getByRole("option", { name: "css-wizard" }),
	).toBeVisible();
});

test("right-clicking blank list space offers the page actions", async ({
	page,
}) => {
	// react-pro is the last row (the source cluster sorts to the bottom);
	// well below it is blank space inside the list panel
	const panel = page.getByRole("option", { name: "react-pro" });
	const box = await panel.boundingBox();
	if (!box) throw new Error("no list");
	await page.mouse.click(box.x + box.width / 2, box.y + box.height + 120, {
		button: "right",
	});

	const menu = page.getByRole("menu", { name: "Resource actions" });
	await expect(menu).toBeVisible();
	await expect(
		menu.getByRole("menuitem", { name: "Select All" }),
	).toBeVisible();
	await expect(
		menu.getByRole("menuitem", { name: "New group" }),
	).toBeVisible();

	// Select All from the menu selects everything
	await menu.getByRole("menuitem", { name: "Select All" }).click();
	await expect(page.getByText("5 items selected")).toBeVisible();
});

test("clicking blank list space clears the selection", async ({ page }) => {
	await page.getByRole("option", { name: "solo-skill" }).click();
	await expect(
		page.getByRole("heading", { name: "solo-skill" }),
	).toBeVisible();

	// react-pro is the last row; click well below it in blank panel space
	const row = page.getByRole("option", { name: "react-pro" });
	const box = await row.boundingBox();
	if (!box) throw new Error("no list");
	await page.mouse.click(box.x + box.width / 2, box.y + box.height + 120);

	await expect(
		page.getByText("Select a skill to view details"),
	).toBeVisible();
});

test("the custom group header menu operates on its members", async ({
	page,
}) => {
	await page.getByRole("button", { name: "Add skill" }).click();
	await page.getByRole("menuitem", { name: "New group" }).click();
	const dialog = page.getByRole("dialog", { name: "New group" });
	await dialog.getByRole("textbox").fill("Ops");
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(page.locator(".modal__backdrop")).toHaveCount(0);
	await dragOptionTo(page, "solo-skill", "group-section-Ops");

	// Favorite all members via the header menu
	await page
		.getByRole("button", { name: "Select all in Ops" })
		.click({ button: "right" });
	const menu = page.getByRole("menu", { name: "Resource actions" });
	await expect(
		menu.getByRole("menuitem", { name: "Select all in Ops" }),
	).toBeVisible();
	await menu.getByRole("menuitem", { name: "Favorite all" }).click();
	// Starring re-sorts the list (starred float up); wait for the star to
	// land so the follow-up right-click resolves the row's NEW position
	await expect(
		page.locator('[data-key="solo-skill"] .text-warning'),
	).toBeVisible();

	// The member is now starred: its item menu offers Unfavorite
	await page
		.getByRole("option", { name: "solo-skill" })
		.click({ button: "right" });
	await expect(
		page
			.getByRole("menu", { name: "Resource actions" })
			.getByRole("menuitem", { name: "Unfavorite" }),
	).toBeVisible();
});

test("F2 on a focused custom group header opens rename", async ({ page }) => {
	await page.getByRole("button", { name: "Add skill" }).click();
	await page.getByRole("menuitem", { name: "New group" }).click();
	const dialog = page.getByRole("dialog", { name: "New group" });
	await dialog.getByRole("textbox").fill("Keys");
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(page.locator(".modal__backdrop")).toHaveCount(0);

	await page.getByRole("button", { name: "Select all in Keys" }).focus();
	await page.keyboard.press("F2");
	await expect(
		page.getByRole("dialog", { name: "Rename group" }),
	).toBeVisible();
});

async function sectionTop(page: Page, source: string): Promise<number> {
	const box = await page.getByTestId(`group-section-${source}`).boundingBox();
	if (!box) throw new Error(`no section ${source}`);
	return box.y;
}

test("starring a member floats its whole source cluster up", async ({
	page,
}) => {
	// Baseline: alpha-pack sorts above web-dev by name
	expect(await sectionTop(page, "github/AkaraChen/alpha-pack")).toBeLessThan(
		await sectionTop(page, "github/AkaraChen/web-dev"),
	);

	// Star react-pro, a member of web-dev, via its context menu
	await page
		.getByRole("option", { name: "react-pro" })
		.click({ button: "right" });
	await page
		.getByRole("menu", { name: "Resource actions" })
		.getByRole("menuitem", { name: "Favorite" })
		.click();
	await expect(
		page
			.getByTestId("group-section-github/AkaraChen/web-dev")
			.locator('[data-slot="source-favorite-indicator"]'),
	).toBeVisible();
	await expect(
		page.getByRole("button", {
			name: "github/AkaraChen/web-dev",
			exact: true,
		}),
	).toHaveAccessibleDescription("Contains a favorite skill");

	// web-dev now carries a starred skill, so its whole cluster floats to the
	// top of the loose list — above the unstarred alpha-pack cluster AND the
	// unstarred ungrouped skill, since clusters and skills are one level
	await expect(async () => {
		const web = await sectionTop(page, "github/AkaraChen/web-dev");
		expect(web).toBeLessThan(
			await sectionTop(page, "github/AkaraChen/alpha-pack"),
		);
		const solo = await page
			.getByRole("option", { name: "solo-skill" })
			.boundingBox();
		if (!solo) throw new Error("no solo-skill");
		expect(web).toBeLessThan(solo.y);
	}).toPass();
});

test("source clusters collapse by default except the selected one", async ({
	page,
}) => {
	// web-dev holds the seeded selection, so it starts open; alpha-pack
	// starts collapsed
	await expect(page.getByRole("option", { name: "react-pro" })).toBeVisible();
	await expect(page.getByRole("option", { name: "api-forge" })).toBeHidden();

	// The chevron expands the collapsed cluster
	await page
		.getByRole("button", {
			name: "Expand or collapse github/AkaraChen/alpha-pack",
		})
		.click();
	await expect(page.getByRole("option", { name: "api-forge" })).toBeVisible();
});

test("shift range sweeps a collapsed section it crosses", async ({ page }) => {
	// Two custom groups so a COLLAPSED section sits between the shift
	// anchor and the target
	for (const name of ["G1", "G2"]) {
		await page.getByRole("button", { name: "Add skill" }).click();
		await page.getByRole("menuitem", { name: "New group" }).click();
		const dialog = page.getByRole("dialog", { name: "New group" });
		await dialog.getByRole("textbox").fill(name);
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(page.locator(".modal__backdrop")).toHaveCount(0);
	}
	const moveTo = async (skill: string, group: string) => {
		await page
			.getByRole("option", { name: skill })
			.click({ button: "right" });
		await page
			.getByRole("menu", { name: "Resource actions" })
			.getByRole("menuitem", { name: group })
			.click();
	};
	await moveTo("css-wizard", "G1");
	await moveTo("react-pro", "G2");

	// Collapse G2 — its member react-pro now sits hidden between G1 and
	// the loose rows
	await page.getByRole("button", { name: "Expand or collapse G2" }).click();
	await expect(page.getByRole("option", { name: "react-pro" })).toBeHidden();

	// Anchor on css-wizard, shift-click solo-skill: BOTH collapsed
	// sections inside the range (G2 and the alpha-pack cluster) join the
	// selection wholesale
	await page.getByRole("option", { name: "css-wizard" }).click();
	await page
		.getByRole("option", { name: "solo-skill" })
		.click({ modifiers: ["Shift"] });

	await expect(page.getByText("5 items selected")).toBeVisible();
	// react-pro shows in the roster even though its row is collapsed away
	await expect(
		page.getByRole("button", { name: "Remove react-pro from selection" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Remove api-forge from selection" }),
	).toBeVisible();
});

test("clicking a cluster row opens its library page", async ({ page }) => {
	// Clicking the collapsed alpha-pack row shows the library page on the
	// right — no selection is made, and the cluster stays collapsed
	// (expansion belongs to the chevron alone)
	await page
		.getByRole("button", {
			name: "github/AkaraChen/alpha-pack",
			exact: true,
		})
		.click();
	await expect(page.getByRole("option", { name: "api-forge" })).toBeHidden();
	await expect(page.getByText("items selected")).toBeHidden();
	await expect(
		page.getByRole("heading", { name: "github/AkaraChen/alpha-pack" }),
	).toBeVisible();
	await expect(page.getByText("2 members")).toBeVisible();
	// The page carries the agent coverage matrix for the library
	await expect(page.getByText("Agent coverage")).toBeVisible();

	// Selecting the whole library from its page opens the batch inspector
	await page.getByRole("button", { name: "Select All", exact: true }).click();
	await expect(page.getByText("2 items selected")).toBeVisible();
});

test("the library agent matrix explains direct edits and reports success", async ({
	page,
}) => {
	await page
		.getByRole("button", {
			name: "github/AkaraChen/alpha-pack",
			exact: true,
		})
		.click();

	await expect(
		page.getByText(
			"Click to install where missing; a full row uninstalls",
			{ exact: true },
		),
	).toBeVisible();
	await page.getByTestId("matrix-row-cursor").click();
	await expect(page.getByText("2 succeeded · 0 failed")).toBeVisible();
	await expect(page.getByTestId("matrix-row-cursor")).toContainText("2/2");
});

test("the library agent matrix reports business failures", async ({ page }) => {
	await page.route(
		"http://localhost:45999/api/v1/skills/reconcile",
		(route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					success_count: 0,
					failed_count: 1,
					results: [],
				}),
			}),
	);
	await page
		.getByRole("button", {
			name: "github/AkaraChen/alpha-pack",
			exact: true,
		})
		.click();

	await page.getByTestId("matrix-row-cursor").click();
	await expect(page.getByText("0 succeeded · 2 failed")).toBeVisible();
});

test("multi-select mode: clicking a cluster row toggles the library", async ({
	page,
}) => {
	// Pick one item, then arm multi-select from the toolbar
	await page.getByRole("option", { name: "solo-skill" }).click();
	await page
		.getByRole("button", { name: "Multi-select mode" })
		.first()
		.click();

	// Clicking the collapsed alpha-pack row now selects its members
	// wholesale instead of opening the library page
	await page
		.getByRole("button", {
			name: "github/AkaraChen/alpha-pack",
			exact: true,
		})
		.click();
	await expect(page.getByText("3 items selected")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Remove arch-lint from selection" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Remove api-forge from selection" }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "github/AkaraChen/alpha-pack" }),
	).toBeHidden();

	// Clicking it again drops the whole library from the selection
	await page
		.getByRole("button", {
			name: "github/AkaraChen/alpha-pack",
			exact: true,
		})
		.click();
	await expect(page.getByText("items selected")).toBeHidden();
	await expect(
		page.getByRole("heading", { name: "solo-skill" }),
	).toBeVisible();
});

test("the library page jumps to a member's detail", async ({ page }) => {
	await page
		.getByRole("button", {
			name: "github/AkaraChen/alpha-pack",
			exact: true,
		})
		.click();
	await expect(
		page.getByRole("heading", { name: "github/AkaraChen/alpha-pack" }),
	).toBeVisible();

	// Clicking a member on the library page selects it — its skill detail
	// replaces the library page
	await page.getByRole("button", { name: "api-forge", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "api-forge" }),
	).toBeVisible();
	await expect(
		page.getByRole("option", { name: "api-forge", selected: true }),
	).toBeVisible();
});

test("escape clears the selection from the detail panel too", async ({
	page,
}) => {
	await page.getByRole("option", { name: "css-wizard" }).click();
	await page
		.getByRole("option", { name: "solo-skill" })
		.click({ modifiers: ["ControlOrMeta"] });
	await expect(page.getByText("2 items selected")).toBeVisible();

	// Hover the right panel (not the list) and press Escape — the
	// shortcut is page-scoped, not list-column-scoped
	await page.getByText("Agent coverage").hover();
	await page.keyboard.press("Escape");
	await expect(page.getByText("2 items selected")).toBeHidden();
	await expect(
		page.getByText("Select a skill to view details"),
	).toBeVisible();
});

test("the seeded first item commits on first click instead of cancelling", async ({
	page,
}) => {
	// react-pro is the seeded selection; the very first click on it
	// commits it (the seed has no click history) — the detail must stay
	await page.getByRole("option", { name: "react-pro" }).click();
	await expect(
		page.getByRole("heading", { name: "react-pro" }),
	).toBeVisible();
	// The second click is a real cancel
	await page.getByRole("option", { name: "react-pro" }).click();
	await expect(
		page.getByText("Select a skill to view details"),
	).toBeVisible();
});

test("shift-clicking an already-selected row shrinks the range", async ({
	page,
}) => {
	// Display order: alpha-pack (collapsed), solo-skill, css-wizard, react-pro
	await page.getByRole("option", { name: "solo-skill" }).click();
	await page
		.getByRole("option", { name: "react-pro" })
		.click({ modifiers: ["Shift"] });
	await expect(page.getByText("3 items selected")).toBeVisible();

	// css-wizard is inside the range and already selected; react-stately
	// swallows that click, so the pointerdown fallback must shrink the
	// range to anchor..css-wizard
	await page
		.getByRole("option", { name: "css-wizard" })
		.click({ modifiers: ["Shift"] });
	await expect(page.getByText("2 items selected")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Remove react-pro from selection" }),
	).toBeHidden();
});

test("right-clicking a fully selected cluster keeps the selection", async ({
	page,
}) => {
	await page.getByRole("option", { name: "solo-skill" }).click();
	await page
		.getByRole("button", { name: "Multi-select mode" })
		.first()
		.click();
	await page
		.getByRole("button", {
			name: "github/AkaraChen/alpha-pack",
			exact: true,
		})
		.click();
	await expect(page.getByText("3 items selected")).toBeVisible();

	// Finder semantics: the menu acts on the current selection — the
	// right-click must never toggle the cluster back out
	await page
		.getByRole("button", {
			name: "github/AkaraChen/alpha-pack",
			exact: true,
		})
		.click({ button: "right" });
	await expect(
		page.getByRole("menu", { name: "Resource actions" }),
	).toBeVisible();
	await expect(page.getByText("3 items selected")).toBeVisible();
	await page.keyboard.press("Escape");
});

test("an in-page ?skill= navigation switches the detail", async ({ page }) => {
	await page.getByRole("option", { name: "solo-skill" }).click();
	await expect(
		page.getByRole("heading", { name: "solo-skill" }),
	).toBeVisible();

	// Global search navigates in-page via history.pushState (nuqs patches
	// it); the page must adopt the new deep link without a remount
	await page.evaluate(() => {
		window.history.pushState(null, "", "/skills?skill=css-wizard");
		window.dispatchEvent(new PopStateEvent("popstate"));
	});
	await expect(
		page.getByRole("heading", { name: "css-wizard" }),
	).toBeVisible();
});

test("escape closes the create panel before clearing the selection", async ({
	page,
}) => {
	await page.getByRole("button", { name: "Add skill" }).click();
	await page.getByRole("menuitem", { name: "Create Custom Skill" }).click();
	await expect(
		page.getByRole("heading", { name: "Create Custom Skill" }),
	).toBeVisible();

	// A blank-area click must not silently discard the open form
	const anchorRow = page.getByRole("option", { name: "react-pro" });
	const box = await anchorRow.boundingBox();
	if (!box) throw new Error("no list");
	await page.mouse.click(box.x + box.width / 2, box.y + box.height + 120);
	await expect(
		page.getByRole("heading", { name: "Create Custom Skill" }),
	).toBeVisible();

	// Escape closes the panel even from inside its form (layered above
	// clearing the selection)
	await page
		.getByRole("heading", { name: "Create Custom Skill" })
		.locator("xpath=ancestor::div[contains(@class,'card')]")
		.getByRole("textbox")
		.first()
		.click();
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("heading", { name: "Create Custom Skill" }),
	).toBeHidden();
});

test("opening the create panel resets multi-select mode", async ({ page }) => {
	await page.getByRole("option", { name: "css-wizard" }).click();
	await page
		.getByRole("option", { name: "solo-skill" })
		.click({ modifiers: ["ControlOrMeta"] });
	await expect(page.getByText("2 items selected")).toBeVisible();

	await page.getByRole("button", { name: "Add skill" }).click();
	await page.getByRole("menuitem", { name: "Create Custom Skill" }).click();
	await page
		.getByRole("heading", { name: "Create Custom Skill" })
		.locator("xpath=ancestor::div[contains(@class,'card')]")
		.getByRole("textbox")
		.first()
		.click();
	await page.keyboard.press("Escape");

	// Multi-select mode left with the selection: two plain clicks now
	// behave single-select instead of accumulating
	await page.getByRole("option", { name: "css-wizard" }).click();
	await page.getByRole("option", { name: "solo-skill" }).click();
	await expect(page.getByText("items selected")).toBeHidden();
	await expect(
		page.getByRole("heading", { name: "solo-skill" }),
	).toBeVisible();
});

test("a fully covered matrix cell uninstalls after confirmation", async ({
	page,
}) => {
	// Select the whole alpha-pack (2 members, both on Claude only)
	await page.getByRole("option", { name: "solo-skill" }).click();
	await page
		.getByRole("button", { name: "Multi-select mode" })
		.first()
		.click();
	await page
		.getByRole("button", {
			name: "github/AkaraChen/alpha-pack",
			exact: true,
		})
		.click();
	await expect(page.getByText("3 items selected")).toBeVisible();

	// Clicking a member pill inside a multi-member source card drops just
	// that item from the selection
	await page
		.getByRole("button", { name: "Remove arch-lint from selection" })
		.click();
	await expect(page.getByText("2 items selected")).toBeVisible();

	// Claude is fully covered — explicitly uncheck it in the tri-state manager
	// and apply (the reconcile mock mutates state).
	await page.getByTestId("matrix-row-claude").click();
	const dialog = page.getByRole("dialog", { name: "Manage Agents" });
	await dialog.locator("label").filter({ hasText: "Claude" }).click();
	await dialog.getByRole("button", { name: "Apply changes" }).click();
	await expect(page.getByRole("option", { name: "api-forge" })).toBeHidden();
	await expect(page.getByRole("option", { name: "solo-skill" })).toBeHidden();
	// arch-lint was dropped from the selection, not uninstalled
	await expect(page.getByRole("option", { name: "arch-lint" })).toBeVisible();
});

test("right-clicking an unselected item resets the selection to it", async ({
	page,
}) => {
	await page.getByRole("option", { name: "solo-skill" }).click();
	await expect(
		page.getByRole("heading", { name: "solo-skill" }),
	).toBeVisible();

	// Finder semantics, other half: hitting an item OUTSIDE the selection
	// resets the selection to that item before the menu opens
	await page
		.getByRole("option", { name: "css-wizard" })
		.click({ button: "right" });
	await expect(
		page.getByRole("menu", { name: "Resource actions" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("heading", { name: "css-wizard" }),
	).toBeVisible();
	await expect(
		page.getByRole("option", { name: "css-wizard" }),
	).toHaveAttribute("aria-selected", "true");
});

test("searching force-expands the collapsed clusters", async ({ page }) => {
	// alpha-pack starts collapsed; its member is not rendered
	await expect(page.getByRole("option", { name: "arch-lint" })).toBeHidden();

	await page.getByRole("searchbox", { name: "Search skills" }).fill("arch");
	await expect(page.getByRole("option", { name: "arch-lint" })).toBeVisible();

	// Clearing the search collapses it again
	await page.getByRole("searchbox", { name: "Search skills" }).fill("");
	await expect(page.getByRole("option", { name: "arch-lint" })).toBeHidden();
});

test("updating a library re-imports from its source", async ({ page }) => {
	await page
		.getByRole("button", {
			name: "github/AkaraChen/alpha-pack",
			exact: true,
		})
		.click();
	await expect(
		page.getByRole("heading", { name: "github/AkaraChen/alpha-pack" }),
	).toBeVisible();
	await expect(page.getByText("2 members")).toBeVisible();

	// Update opens the git import panel pre-filled with the library URL
	await page.getByRole("button", { name: "Update from source" }).click();
	await expect(
		page.getByRole("heading", { name: "Import Remote Source" }),
	).toBeVisible();
	await expect(page.getByLabel("Repository URL")).toHaveValue(
		"https://github.com/AkaraChen/alpha-pack",
	);

	// Scan lists the repo content (all selected by default), install
	// skips the two existing members and adds fresh-skill + its lock
	await page.getByRole("button", { name: "Scan", exact: true }).click();
	await expect(page.getByText("fresh-skill description")).toBeVisible();
	await page.getByRole("button", { name: "Install Selected" }).click();
	await page.getByRole("button", { name: "Done", exact: true }).click();

	// Back on the library page: the new member is clustered in — expand
	// the cluster (chevron only) and find its row inside the section
	await expect(page.getByText("3 members")).toBeVisible();
	await page
		.getByRole("button", {
			name: "Expand or collapse github/AkaraChen/alpha-pack",
		})
		.click();
	await expect(
		page
			.getByTestId("group-section-github/AkaraChen/alpha-pack")
			.getByRole("option", { name: "fresh-skill" }),
	).toBeVisible();
});
