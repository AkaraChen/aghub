import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { e2eApiUrl, installMocks } from "./mocks";

/**
 * Store-integrity regressions: group assignments must not outlive the
 * resources they point at, transfers must not run concurrently against
 * the same destination config, and action affordances must carry a real
 * translation instead of the raw i18n key.
 */

// Same pointer-driven drag as list-interactions.spec.ts: dnd-kit rides
// pointer events (8px activation), so press, cross the threshold, then
// resolve the drag-only target and drop on it.
async function dragOptionTo(
	page: Page,
	optionText: string,
	targetTestId: string,
) {
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
	await page.mouse.move(tx + 1, ty + 1);
	await page.mouse.up();
}

async function createGroup(page: Page, name: string) {
	await page.getByRole("button", { name: "Add skill" }).click();
	await page.getByRole("menuitem", { name: "New group" }).click();
	const dialog = page.getByRole("dialog", { name: "New group" });
	await dialog.getByRole("textbox").fill(name);
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(page.getByTestId(`group-section-${name}`)).toBeVisible();
}

test("deleting a skill prunes its group assignment so a reinstall lands ungrouped", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	await page.goto("/skills");
	await expect(
		page.getByRole("option", { name: "solo-skill" }),
	).toBeVisible();

	// Put solo-skill into a custom group
	await createGroup(page, "Keep");
	await dragOptionTo(page, "solo-skill", "group-section-Keep");
	const section = page.getByTestId("group-section-Keep");
	await expect(
		section.getByRole("option", { name: "solo-skill" }),
	).toBeVisible();

	// Delete it through the context menu -> bulk delete dialog
	await section.getByRole("option", { name: "solo-skill" }).click();
	await section
		.getByRole("option", { name: "solo-skill" })
		.click({ button: "right" });
	await page
		.getByRole("menu", { name: "Resource actions" })
		.getByRole("menuitem", { name: "Delete" })
		.click();
	await page.getByRole("button", { name: "Delete Selected" }).click();
	await expect(page.getByRole("option", { name: "solo-skill" })).toHaveCount(
		0,
	);

	// Reinstall a same-named skill (mock mutation + refetch). Without the
	// assignment prune, the stale memberKey -> groupId record resurrects
	// the old placement and the skill re-renders inside "Keep".
	mocks.addSkill("solo-skill");
	await page.getByRole("button", { name: "Refresh skills" }).click();
	await expect(
		page.getByRole("option", { name: "solo-skill" }),
	).toBeVisible();
	await expect(
		section.getByRole("option", { name: "solo-skill" }),
	).toHaveCount(0);
});

test("bulk transfers run sequentially, never in parallel", async ({ page }) => {
	await installMocks(page);

	// Registered after installMocks so it wins over the catch-all route.
	// Tracks in-flight concurrency with an artificial service delay: with
	// parallel transfers all three overlap; sequential keeps the max at 1.
	let inFlight = 0;
	let maxInFlight = 0;
	await page.route(e2eApiUrl("/skills/transfer"), async (route) => {
		inFlight += 1;
		maxInFlight = Math.max(maxInFlight, inFlight);
		await new Promise((resolve) => setTimeout(resolve, 150));
		inFlight -= 1;
		const body = JSON.parse(route.request().postData() ?? "{}");
		const results = (
			(body.destinations ?? []) as Array<{ agent: string }>
		).map((destination) => ({
			name: body.source?.name ?? "",
			agent: destination.agent,
			success: true,
			error: null,
		}));
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				success_count: results.length,
				failed_count: 0,
				results,
			}),
		});
	});

	await page.goto("/skills");
	await expect(
		page.getByRole("option", { name: "solo-skill" }),
	).toBeVisible();

	// Select three skills and open the transfer (Copy) dialog
	await page.getByRole("option", { name: "solo-skill" }).click();
	await page
		.getByRole("option", { name: "react-pro" })
		.click({ modifiers: ["ControlOrMeta"] });
	await page
		.getByRole("option", { name: "css-wizard" })
		.click({ modifiers: ["ControlOrMeta"] });
	await expect(page.getByText("3 items selected")).toBeVisible();
	await page.getByRole("button", { name: "Copy", exact: true }).click();

	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Select destination" }).click();
	await page.getByRole("option", { name: "demo-project" }).click();

	// Project-scoped transfers use the shared target exposed by agents that
	// read the universal Skill directory.
	await dialog
		.locator("label")
		.filter({ hasText: "Universal agents" })
		.click();
	await expect(
		dialog.getByRole("checkbox", { name: "Universal agents" }),
	).toBeChecked();
	await dialog.getByRole("button", { name: "Copy", exact: true }).click();

	// All three per-item transfers succeeded...
	await expect(page.getByText("Copied to 3 target(s)")).toBeVisible();
	// ...and never overlapped: each read-modify-writes the same
	// destination config file, so parallel writers would lose items.
	expect(maxInFlight).toBe(1);
});

test("action menus expose the translated 'Actions' label, not the raw key", async ({
	page,
}) => {
	await installMocks(page);
	await page.goto("/skills");
	await expect(
		page.getByRole("option", { name: "solo-skill" }),
	).toBeVisible();

	// The sidebar project row's overflow menu uses t("actions") as its
	// aria-label; with the key missing, i18next renders the raw key.
	// getByRole name matching with exact is case-sensitive, so "Actions"
	// only matches the real translation.
	await expect(
		page.getByRole("button", { name: "Actions", exact: true }).first(),
	).toBeAttached();
	await expect(
		page.getByRole("button", { name: "actions", exact: true }),
	).toHaveCount(0);
});
