import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

/**
 * React Aria's desktop drag and drop rides native HTML5 drag events,
 * which CDP mouse input does not reliably synthesize — so fire the
 * DragEvent sequence directly with a shared DataTransfer.
 */
async function dragOptionTo(
	page: Page,
	optionText: string,
	targetTestId: string,
) {
	await page.evaluate(
		async ({ optionText, targetTestId }) => {
			const source = [
				...document.querySelectorAll('[role="option"]'),
			].find((el) => el.textContent?.includes(optionText));
			if (!source) throw new Error("drag source missing");

			const dataTransfer = new DataTransfer();
			const fire = (el: Element, type: string) => {
				const r = el.getBoundingClientRect();
				el.dispatchEvent(
					new DragEvent(type, {
						bubbles: true,
						cancelable: true,
						composed: true,
						clientX: r.x + 20,
						clientY: r.y + 10,
						dataTransfer,
					}),
				);
			};

			fire(source, "dragstart");
			// Give React a frame to render drag-only drop targets
			await new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(resolve)),
			);
			const target = document.querySelector(
				`[data-testid="${targetTestId}"]`,
			);
			if (!target) throw new Error("drag target missing");
			fire(target, "dragenter");
			fire(target, "dragover");
			fire(target, "drop");
			fire(source, "dragend");
		},
		{ optionText, targetTestId },
	);
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
	await expect(
		page.getByRole("button", { name: "Move to group" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Delete", exact: true }),
	).toBeVisible();
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
